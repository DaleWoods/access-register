"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EmployeeStatus, PersonType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireWriter } from "@/lib/auth/guards";
import {
  actorFrom,
  newCorrelationId,
  recordCreate,
  recordDiff,
  recordEvent,
  type AuditContext,
} from "@/lib/audit";
import { refreshFlagsForRecords } from "@/lib/flags";
import { normaliseEmail } from "@/lib/matching";

const PERSON_FIELDS = [
  "fullName",
  "primaryEmail",
  "alternateEmails",
  "personType",
  "employeeStatus",
  "department",
  "lineManager",
  "hrReference",
  "startDate",
  "leaveDate",
  "notes",
];

function contextFor(user: { id: string; fullName: string; email: string }): AuditContext {
  return { actor: actorFrom(user), source: "MANUAL", correlationId: newCorrelationId() };
}

function readDate(formData: FormData, key: string): Date | null {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readPersonFields(formData: FormData) {
  const alternates = String(formData.get("alternateEmails") ?? "")
    .split(/[\n,;]+/)
    .map((e) => normaliseEmail(e))
    .filter(Boolean);

  return {
    fullName: String(formData.get("fullName") ?? "").trim(),
    primaryEmail: normaliseEmail(String(formData.get("primaryEmail") ?? "")) || null,
    alternateEmails: [...new Set(alternates)],
    personType: (String(formData.get("personType") ?? "EMPLOYEE") || "EMPLOYEE") as PersonType,
    employeeStatus: (String(formData.get("employeeStatus") ?? "UNKNOWN") || "UNKNOWN") as EmployeeStatus,
    department: String(formData.get("department") ?? "").trim() || null,
    lineManager: String(formData.get("lineManager") ?? "").trim() || null,
    hrReference: String(formData.get("hrReference") ?? "").trim() || null,
    startDate: readDate(formData, "startDate"),
    leaveDate: readDate(formData, "leaveDate"),
    notes: String(formData.get("notes") ?? "").trim(),
  };
}

export async function createPerson(formData: FormData): Promise<void> {
  const user = await requireWriter();
  const context = contextFor(user);
  const fields = readPersonFields(formData);
  if (!fields.fullName) throw new Error("Enter a full name");

  const person = await prisma.person.create({ data: fields });
  await recordCreate({
    entityType: "Person",
    entityId: person.id,
    context,
    summary: `created manually: ${person.fullName}`,
  });

  revalidatePath("/people");
  redirect(`/people/${person.id}`);
}

export async function updatePerson(formData: FormData): Promise<void> {
  const user = await requireWriter();
  const context = contextFor(user);
  const id = String(formData.get("id") ?? "");

  const before = await prisma.person.findUniqueOrThrow({ where: { id } });
  const fields = readPersonFields(formData);
  if (!fields.fullName) throw new Error("Enter a full name");

  const after = await prisma.person.update({ where: { id }, data: fields });

  await recordDiff({
    entityType: "Person",
    entityId: id,
    context,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    fields: PERSON_FIELDS,
  });

  // Employee status feeds the leaver-with-access flag on every account.
  if (before.employeeStatus !== after.employeeStatus) {
    const records = await prisma.accessRecord.findMany({
      where: { personId: id },
      select: { id: true },
    });
    await refreshFlagsForRecords(records.map((r) => r.id));
  }

  revalidatePath(`/people/${id}`);
  revalidatePath("/people");
}

/**
 * Merge one person into another. Matching is never perfect, so this is the
 * escape hatch — and it is recorded rather than destructive: the losing record
 * is retained and points at the survivor.
 */
export async function mergePeople(formData: FormData): Promise<void> {
  const user = await requireWriter();
  const context = contextFor(user);

  const survivorId = String(formData.get("survivorId") ?? "");
  const mergedId = String(formData.get("mergedId") ?? "");
  if (!survivorId || !mergedId || survivorId === mergedId) {
    throw new Error("Choose two different people to merge");
  }

  const [survivor, merged] = await Promise.all([
    prisma.person.findUniqueOrThrow({ where: { id: survivorId } }),
    prisma.person.findUniqueOrThrow({ where: { id: mergedId } }),
  ]);

  const movedRecords = await prisma.accessRecord.findMany({
    where: { personId: mergedId },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    // Every account the losing person held moves across.
    for (const record of movedRecords) {
      await tx.accessRecord.update({ where: { id: record.id }, data: { personId: survivorId } });
      await tx.auditEvent.create({
        data: {
          entityType: "AccessRecord",
          entityId: record.id,
          field: "personId",
          oldValue: mergedId,
          newValue: survivorId,
          changedById: context.actor.id,
          changedByLabel: context.actor.label,
          changeSource: "MANUAL",
          correlationId: context.correlationId,
        },
      });
    }

    // Keep every address we knew about, so future imports still match.
    const emails = new Set([
      ...survivor.alternateEmails,
      ...merged.alternateEmails,
      ...(merged.primaryEmail ? [merged.primaryEmail] : []),
    ]);
    emails.delete(survivor.primaryEmail ?? "");

    await tx.person.update({
      where: { id: survivorId },
      data: { alternateEmails: [...emails].filter(Boolean) },
    });

    // The losing record is tombstoned, never deleted: its history must resolve.
    await tx.person.update({
      where: { id: mergedId },
      data: { mergedIntoId: survivorId, primaryEmail: null },
    });

    await recordEvent({
      db: tx,
      entityType: "Person",
      entityId: mergedId,
      context,
      field: "mergedIntoId",
      newValue: `merged into ${survivor.fullName} (${survivorId})`,
    });
    await recordEvent({
      db: tx,
      entityType: "Person",
      entityId: survivorId,
      context,
      newValue: `absorbed ${merged.fullName}, moving ${movedRecords.length} account(s)`,
    });
  });

  await refreshFlagsForRecords(movedRecords.map((r) => r.id));

  revalidatePath("/people");
  redirect(`/people/${survivorId}`);
}

/**
 * Split an account back out of a person — the other half of "matching is never
 * perfect". The account becomes unmatched, or moves to a newly created person.
 */
export async function splitAccountFromPerson(formData: FormData): Promise<void> {
  const user = await requireWriter();
  const context = contextFor(user);

  const recordId = String(formData.get("recordId") ?? "");
  const newName = String(formData.get("newPersonName") ?? "").trim();

  const record = await prisma.accessRecord.findUniqueOrThrow({ where: { id: recordId } });
  let personId: string | null = null;

  if (newName) {
    const person = await prisma.person.create({
      data: {
        fullName: newName,
        primaryEmail: record.rawEmail || null,
        personType: "EMPLOYEE",
        employeeStatus: "UNKNOWN",
      },
    });
    await recordCreate({
      entityType: "Person",
      entityId: person.id,
      context,
      summary: `split out from an existing person while correcting a match`,
    });
    personId = person.id;
  }

  await prisma.accessRecord.update({ where: { id: recordId }, data: { personId } });
  await recordDiff({
    entityType: "AccessRecord",
    entityId: recordId,
    context,
    before: record as unknown as Record<string, unknown>,
    after: { ...record, personId } as unknown as Record<string, unknown>,
    fields: ["personId"],
  });
  await refreshFlagsForRecords([recordId]);

  revalidatePath("/people");
  revalidatePath(`/register/${recordId}`);
}
