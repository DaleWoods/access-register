"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CaptureMethod, VendorCategory } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, requireVendorEdit } from "@/lib/auth/guards";
import {
  actorFrom,
  newCorrelationId,
  recordCreate,
  recordDiff,
  type AuditContext,
} from "@/lib/audit";
import { refreshFlagsForRecords } from "@/lib/flags";

const VENDOR_FIELDS = [
  "name",
  "category",
  "description",
  "ownerUserId",
  "captureMethod",
  "exposesLastLogin",
  "exposesPasswordExpiry",
  "exposesAccountExpiry",
  "exposesAccountCreated",
  "reviewFrequencyMonths",
  "notes",
  "isArchived",
];

function contextFor(user: { id: string; fullName: string; email: string }): AuditContext {
  return { actor: actorFrom(user), source: "MANUAL", correlationId: newCorrelationId() };
}

function readVendorFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    category: (String(formData.get("category") ?? "OTHER") || "OTHER") as VendorCategory,
    description: String(formData.get("description") ?? "").trim(),
    ownerUserId: String(formData.get("ownerUserId") ?? "") || null,
    captureMethod: (String(formData.get("captureMethod") ?? "CSV_EXPORT") ||
      "CSV_EXPORT") as CaptureMethod,
    exposesLastLogin: formData.get("exposesLastLogin") === "on",
    exposesPasswordExpiry: formData.get("exposesPasswordExpiry") === "on",
    exposesAccountExpiry: formData.get("exposesAccountExpiry") === "on",
    exposesAccountCreated: formData.get("exposesAccountCreated") === "on",
    reviewFrequencyMonths: Math.max(
      1,
      Number.parseInt(String(formData.get("reviewFrequencyMonths") ?? "3"), 10) || 3,
    ),
    notes: String(formData.get("notes") ?? "").trim(),
  };
}

export async function createVendor(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const context = contextFor(user);
  const fields = readVendorFields(formData);
  if (!fields.name) throw new Error("Enter a vendor name");

  const vendor = await prisma.vendor.create({ data: fields });
  await recordCreate({
    entityType: "Vendor",
    entityId: vendor.id,
    context,
    summary: `vendor created: ${vendor.name}`,
  });

  revalidatePath("/vendors");
  redirect(`/vendors/${vendor.id}`);
}

export async function updateVendor(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const user = await requireVendorEdit(id);
  const context = contextFor(user);

  const before = await prisma.vendor.findUniqueOrThrow({ where: { id } });
  const fields = readVendorFields(formData);
  if (!fields.name) throw new Error("Enter a vendor name");

  // Only an admin may reassign ownership or change the vendor's name.
  const data = user.role === "ADMIN" ? fields : { ...fields, name: before.name, ownerUserId: before.ownerUserId };

  const after = await prisma.vendor.update({ where: { id }, data });
  await recordDiff({
    entityType: "Vendor",
    entityId: id,
    context,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    fields: VENDOR_FIELDS,
  });

  // Changing what a vendor exposes changes what "N/A" means for its accounts,
  // and therefore whether they are unverifiable or merely uncaptured.
  const exposureChanged =
    before.exposesLastLogin !== after.exposesLastLogin ||
    before.exposesPasswordExpiry !== after.exposesPasswordExpiry ||
    before.exposesAccountExpiry !== after.exposesAccountExpiry ||
    before.exposesAccountCreated !== after.exposesAccountCreated;

  if (exposureChanged) {
    await applyExposureToRecords(id, after, context);
  } else if (before.reviewFrequencyMonths !== after.reviewFrequencyMonths) {
    const records = await prisma.accessRecord.findMany({ where: { vendorId: id }, select: { id: true } });
    await refreshFlagsForRecords(records.map((r) => r.id));
  }

  revalidatePath(`/vendors/${id}`);
  revalidatePath("/vendors");
}

/**
 * Push a vendor's exposure settings onto its accounts.
 *
 * Turning a field off marks it "N/A - not exposed" everywhere. Turning it back
 * on demotes N/A to blank — outstanding work — rather than inventing a value.
 * Every one of those transitions is audited.
 */
async function applyExposureToRecords(
  vendorId: string,
  vendor: {
    exposesLastLogin: boolean;
    exposesPasswordExpiry: boolean;
    exposesAccountExpiry: boolean;
    exposesAccountCreated: boolean;
  },
  context: AuditContext,
): Promise<void> {
  const pairs: [keyof typeof vendor, string, string][] = [
    ["exposesLastLogin", "lastLoginState", "lastLogin"],
    ["exposesPasswordExpiry", "passwordExpiryState", "passwordExpiry"],
    ["exposesAccountExpiry", "accountExpiryState", "accountExpiry"],
    ["exposesAccountCreated", "accountCreatedState", "accountCreated"],
  ];

  const records = await prisma.accessRecord.findMany({ where: { vendorId } });

  for (const record of records) {
    const data: Record<string, unknown> = {};
    const changes: { field: string; oldValue: string | null; newValue: string | null }[] = [];

    for (const [flag, stateColumn, valueColumn] of pairs) {
      const current = record[stateColumn as keyof typeof record] as string;
      const value = record[valueColumn as keyof typeof record];

      const next = vendor[flag]
        ? current === "NOT_EXPOSED"
          ? value
            ? "CAPTURED"
            : "BLANK"
          : current
        : "NOT_EXPOSED";

      if (next !== current) {
        data[stateColumn] = next;
        changes.push({ field: stateColumn, oldValue: current, newValue: next });
      }
    }

    if (!changes.length) continue;
    await prisma.accessRecord.update({ where: { id: record.id }, data });
    await prisma.auditEvent.createMany({
      data: changes.map((c) => ({
        entityType: "AccessRecord",
        entityId: record.id,
        field: c.field,
        oldValue: c.oldValue,
        newValue: c.newValue,
        changedById: context.actor.id,
        changedByLabel: context.actor.label,
        changeSource: context.source,
        correlationId: context.correlationId ?? null,
      })),
    });
  }

  await refreshFlagsForRecords(records.map((r) => r.id));
}

export async function createInstance(formData: FormData): Promise<void> {
  const vendorId = String(formData.get("vendorId") ?? "");
  const user = await requireVendorEdit(vendorId);
  const context = contextFor(user);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Enter an instance name");

  const instance = await prisma.vendorInstance.create({
    data: { vendorId, name, notes: String(formData.get("notes") ?? "").trim() },
  });
  await recordCreate({
    entityType: "VendorInstance",
    entityId: instance.id,
    context,
    summary: `instance created: ${name}`,
  });

  revalidatePath(`/vendors/${vendorId}`);
}

export async function archiveInstance(formData: FormData): Promise<void> {
  const instanceId = String(formData.get("instanceId") ?? "");
  const instance = await prisma.vendorInstance.findUniqueOrThrow({ where: { id: instanceId } });
  const user = await requireVendorEdit(instance.vendorId);
  const context = contextFor(user);

  const updated = await prisma.vendorInstance.update({
    where: { id: instanceId },
    data: { isArchived: !instance.isArchived },
  });
  await recordDiff({
    entityType: "VendorInstance",
    entityId: instanceId,
    context,
    before: instance as unknown as Record<string, unknown>,
    after: updated as unknown as Record<string, unknown>,
    fields: ["isArchived"],
  });

  revalidatePath(`/vendors/${instance.vendorId}`);
}

export async function archiveVendor(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const context = contextFor(user);
  const id = String(formData.get("id") ?? "");

  const before = await prisma.vendor.findUniqueOrThrow({ where: { id } });
  const after = await prisma.vendor.update({
    where: { id },
    data: { isArchived: !before.isArchived },
  });

  await recordDiff({
    entityType: "Vendor",
    entityId: id,
    context,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    fields: ["isArchived"],
  });

  revalidatePath("/vendors");
  revalidatePath(`/vendors/${id}`);
}

export async function deleteColumnMapping(formData: FormData): Promise<void> {
  const mappingId = String(formData.get("mappingId") ?? "");
  const mapping = await prisma.columnMapping.findUniqueOrThrow({ where: { id: mappingId } });
  await requireVendorEdit(mapping.vendorId);

  await prisma.columnMapping.delete({ where: { id: mappingId } });
  revalidatePath(`/vendors/${mapping.vendorId}`);
}
