"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { AccountStatus, FieldState, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRecordEdit, requireVendorEdit, requireWriter } from "@/lib/auth/guards";
import {
  actorFrom,
  newCorrelationId,
  recordCreate,
  recordDiff,
  type AuditContext,
} from "@/lib/audit";
import { refreshFlagsForRecords } from "@/lib/flags";
import { buildMatchKey, normaliseEmail } from "@/lib/matching";

/**
 * Manual maintenance of register rows — the path for vendors with no export,
 * and for correcting anything an import got wrong. Every write is audited.
 */

const EDITABLE_FIELDS = [
  "rawUsername",
  "rawEmail",
  "role",
  "permissionLevel",
  "accountStatus",
  "accountCreated",
  "accountExpiry",
  "passwordExpiry",
  "lastLogin",
  "accountCreatedState",
  "accountExpiryState",
  "passwordExpiryState",
  "lastLoginState",
  "justification",
  "personId",
  "instanceId",
];

function contextFor(
  user: { id: string; fullName: string; email: string },
  source: AuditContext["source"] = "MANUAL",
): AuditContext {
  return { actor: actorFrom(user), source, correlationId: newCorrelationId() };
}

function readDate(formData: FormData, key: string): Date | null {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A date field's state follows its value, unless the operator has explicitly
 * marked it "N/A - not exposed". That distinction is the whole point, so it is
 * never inferred away.
 */
function readState(formData: FormData, key: string, value: Date | null): FieldState {
  const explicit = String(formData.get(`${key}State`) ?? "");
  if (explicit === "NOT_EXPOSED") return "NOT_EXPOSED";
  if (value) return "CAPTURED";
  return explicit === "CAPTURED" ? "CAPTURED" : "BLANK";
}

function readFields(formData: FormData) {
  const accountCreated = readDate(formData, "accountCreated");
  const accountExpiry = readDate(formData, "accountExpiry");
  const passwordExpiry = readDate(formData, "passwordExpiry");
  const lastLogin = readDate(formData, "lastLogin");

  return {
    rawUsername: String(formData.get("rawUsername") ?? "").trim(),
    rawEmail: normaliseEmail(String(formData.get("rawEmail") ?? "")),
    role: String(formData.get("role") ?? "").trim(),
    permissionLevel: String(formData.get("permissionLevel") ?? "").trim(),
    accountStatus: (String(formData.get("accountStatus") ?? "ACTIVE") || "ACTIVE") as AccountStatus,
    justification: String(formData.get("justification") ?? "").trim(),
    accountCreated,
    accountExpiry,
    passwordExpiry,
    lastLogin,
    accountCreatedState: readState(formData, "accountCreated", accountCreated),
    accountExpiryState: readState(formData, "accountExpiry", accountExpiry),
    passwordExpiryState: readState(formData, "passwordExpiry", passwordExpiry),
    lastLoginState: readState(formData, "lastLogin", lastLogin),
    personId: String(formData.get("personId") ?? "") || null,
    instanceId: String(formData.get("instanceId") ?? "") || null,
  };
}

export async function createRecord(formData: FormData): Promise<void> {
  const vendorId = String(formData.get("vendorId") ?? "");
  const user = await requireVendorEdit(vendorId);
  const context = contextFor(user);

  const fields = readFields(formData);
  const matchKey = buildMatchKey(fields.rawUsername, fields.rawEmail);
  if (!matchKey) throw new Error("Enter a username or an email address");

  const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: vendorId } });

  const created = await prisma.accessRecord.create({
    data: {
      ...fields,
      vendorId,
      instanceKey: fields.instanceId ?? "",
      matchKey,
      source: vendor.captureMethod,
      firstSeen: new Date(),
      lastConfirmed: new Date(),
    } as Prisma.AccessRecordUncheckedCreateInput,
  });

  await recordCreate({
    entityType: "AccessRecord",
    entityId: created.id,
    context,
    summary: `manually added to ${vendor.name}`,
  });
  await refreshFlagsForRecords([created.id]);

  revalidatePath("/register");
  redirect(`/register/${created.id}`);
}

export async function updateRecord(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const { user } = await requireRecordEdit(id);
  const context = contextFor(user);

  const before = await prisma.accessRecord.findUniqueOrThrow({ where: { id } });
  const fields = readFields(formData);
  const matchKey = buildMatchKey(fields.rawUsername, fields.rawEmail);
  if (!matchKey) throw new Error("Enter a username or an email address");

  const updated = await prisma.accessRecord.update({
    where: { id },
    data: {
      ...fields,
      matchKey,
      instanceKey: fields.instanceId ?? "",
      lastConfirmed: new Date(),
    } as Prisma.AccessRecordUncheckedUpdateInput,
  });

  await recordDiff({
    entityType: "AccessRecord",
    entityId: id,
    context,
    before: before as unknown as Record<string, unknown>,
    after: updated as unknown as Record<string, unknown>,
    fields: EDITABLE_FIELDS,
  });
  await refreshFlagsForRecords([id]);

  revalidatePath(`/register/${id}`);
  revalidatePath("/register");
}

/** "Yes, I have looked at this and it is correct." Drives review-overdue flags. */
export async function confirmRecord(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const { user } = await requireRecordEdit(id);
  const context = contextFor(user);

  const before = await prisma.accessRecord.findUniqueOrThrow({ where: { id } });
  const updated = await prisma.accessRecord.update({
    where: { id },
    data: { lastConfirmed: new Date() },
  });

  await recordDiff({
    entityType: "AccessRecord",
    entityId: id,
    context,
    before: before as unknown as Record<string, unknown>,
    after: updated as unknown as Record<string, unknown>,
    fields: ["lastConfirmed"],
  });
  await refreshFlagsForRecords([id]);
  revalidatePath(`/register/${id}`);
}

/**
 * Link an account to a person, or create a person for it.
 * There is no unlink-and-forget: the change is written to history like any other.
 */
export async function linkRecordToPerson(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const { user } = await requireRecordEdit(id);
  const context = contextFor(user);

  const before = await prisma.accessRecord.findUniqueOrThrow({ where: { id } });
  let personId = String(formData.get("personId") ?? "") || null;

  if (String(formData.get("mode")) === "create") {
    const fullName = String(formData.get("fullName") ?? "").trim();
    if (!fullName) throw new Error("Enter the person's name");
    const email = normaliseEmail(String(formData.get("primaryEmail") ?? "")) || null;

    const person = await prisma.person.create({
      data: { fullName, primaryEmail: email, personType: "EMPLOYEE", employeeStatus: "UNKNOWN" },
    });
    await recordCreate({
      entityType: "Person",
      entityId: person.id,
      context,
      summary: `created while matching ${before.rawUsername || before.rawEmail}`,
    });
    personId = person.id;
  }

  const updated = await prisma.accessRecord.update({ where: { id }, data: { personId } });
  await recordDiff({
    entityType: "AccessRecord",
    entityId: id,
    context,
    before: before as unknown as Record<string, unknown>,
    after: updated as unknown as Record<string, unknown>,
    fields: ["personId"],
  });
  await refreshFlagsForRecords([id]);

  revalidatePath(`/register/${id}`);
  revalidatePath("/people");
}

/**
 * Soft delete only. AccessRecords are never destroyed — status becomes REMOVED
 * and the history stays intact.
 */
export async function markRecordRemoved(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const { user } = await requireRecordEdit(id);
  const context = contextFor(user);

  const before = await prisma.accessRecord.findUniqueOrThrow({ where: { id } });
  const updated = await prisma.accessRecord.update({
    where: { id },
    data: { accountStatus: "REMOVED", lastConfirmed: new Date() },
  });

  await recordDiff({
    entityType: "AccessRecord",
    entityId: id,
    context,
    before: before as unknown as Record<string, unknown>,
    after: updated as unknown as Record<string, unknown>,
    fields: ["accountStatus"],
  });
  await refreshFlagsForRecords([id]);
  revalidatePath(`/register/${id}`);
}

export async function refreshFlags(): Promise<void> {
  await requireWriter();
  const { refreshAllFlags } = await import("@/lib/flags");
  await refreshAllFlags();
  revalidatePath("/register");
  revalidatePath("/");
}
