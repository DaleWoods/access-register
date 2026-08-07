import type { LeaverActionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  actorFrom,
  newCorrelationId,
  recordChanges,
  recordCreate,
  recordEvent,
  type AuditContext,
} from "@/lib/audit";
import { refreshFlagsForRecords } from "@/lib/flags";

/**
 * The leaver workflow.
 *
 * Opening a case snapshots every account the person holds across every vendor
 * into a checklist. Working the checklist records an action and evidence
 * against each one, and the closed case is the audit proof that the leaver was
 * dealt with completely.
 */

type Actor = { id: string; fullName: string; email: string };

function contextFor(user: Actor, correlationId?: string): AuditContext {
  return {
    actor: actorFrom(user),
    source: "LEAVER_PROCESS",
    correlationId: correlationId ?? newCorrelationId(),
  };
}

export async function openLeaverCase(args: {
  personId: string;
  user: Actor;
  notes?: string;
  markAsLeft?: boolean;
  leaveDate?: Date | null;
}) {
  const { personId, user } = args;
  const markAsLeft = args.markAsLeft ?? true;
  const context = contextFor(user);

  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) throw new Error("Person not found");

  const existingOpen = await prisma.leaverCase.findFirst({
    where: { personId, status: "OPEN" },
  });
  if (existingOpen) return existingOpen;

  // Every account, every vendor. Already-removed accounts are included so the
  // report is a complete picture, but they start as NOT_APPLICABLE.
  const records = await prisma.accessRecord.findMany({
    where: { personId },
    select: { id: true, accountStatus: true },
  });

  const leaverCase = await prisma.$transaction(async (tx) => {
    const created = await tx.leaverCase.create({
      data: {
        personId,
        openedById: user.id,
        notes: args.notes ?? "",
      },
    });

    if (records.length) {
      await tx.leaverAction.createMany({
        data: records.map((r) => ({
          caseId: created.id,
          accessRecordId: r.id,
          action: (r.accountStatus === "REMOVED" ? "NOT_APPLICABLE" : "PENDING") as LeaverActionType,
        })),
      });
    }

    if (markAsLeft && person.employeeStatus !== "LEFT") {
      await tx.person.update({
        where: { id: personId },
        data: {
          employeeStatus: "LEFT",
          leaveDate: args.leaveDate ?? person.leaveDate ?? new Date(),
        },
      });
      await recordChanges({
        db: tx,
        entityType: "Person",
        entityId: personId,
        context,
        changes: [
          {
            field: "employeeStatus",
            oldValue: person.employeeStatus,
            newValue: "LEFT",
          },
        ],
      });
    }

    await recordCreate({
      db: tx,
      entityType: "LeaverCase",
      entityId: created.id,
      context,
      summary: `leaver case opened for ${person.fullName} covering ${records.length} account(s)`,
    });

    return created;
  });

  await refreshFlagsForRecords(records.map((r) => r.id));
  return leaverCase;
}

export async function recordLeaverAction(args: {
  actionId: string;
  action: LeaverActionType;
  evidenceNote: string;
  user: Actor;
}) {
  const { actionId, action, evidenceNote, user } = args;
  const context = contextFor(user);

  const existing = await prisma.leaverAction.findUnique({
    where: { id: actionId },
    include: { accessRecord: true },
  });
  if (!existing) throw new Error("Leaver action not found");

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.leaverAction.update({
      where: { id: actionId },
      data: {
        action,
        evidenceNote,
        actionedById: user.id,
        actionedAt: action === "PENDING" ? null : now,
      },
    });

    // Marking the checklist item Removed is what actually removes the access.
    if (action === "REMOVED" && existing.accessRecord.accountStatus !== "REMOVED") {
      await tx.accessRecord.update({
        where: { id: existing.accessRecordId },
        data: { accountStatus: "REMOVED", lastConfirmed: now },
      });
      await recordChanges({
        db: tx,
        entityType: "AccessRecord",
        entityId: existing.accessRecordId,
        context,
        changes: [
          {
            field: "accountStatus",
            oldValue: existing.accessRecord.accountStatus,
            newValue: "REMOVED",
          },
        ],
      });
    }

    if (action === "RETAINED") {
      await tx.accessRecord.update({
        where: { id: existing.accessRecordId },
        data: { lastConfirmed: now },
      });
    }

    await recordEvent({
      db: tx,
      entityType: "AccessRecord",
      entityId: existing.accessRecordId,
      context,
      field: "leaver_action",
      newValue: `${action}${evidenceNote ? ` — evidence: ${evidenceNote}` : ""}`,
    });
  });

  await refreshFlagsForRecords([existing.accessRecordId]);
}

export async function closeLeaverCase(args: { caseId: string; user: Actor }) {
  const context = contextFor(args.user);
  const pending = await prisma.leaverAction.count({
    where: { caseId: args.caseId, action: "PENDING" },
  });
  if (pending > 0) {
    throw new Error(`${pending} account(s) still have no action recorded`);
  }

  const closed = await prisma.leaverCase.update({
    where: { id: args.caseId },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  await recordEvent({
    entityType: "LeaverCase",
    entityId: args.caseId,
    context,
    newValue: "leaver case closed — all accounts actioned",
  });
  return closed;
}

export type LeaverReportLine = {
  vendorName: string;
  instanceName: string | null;
  rawUsername: string;
  rawEmail: string;
  role: string;
  permissionLevel: string;
  accountStatus: string;
  action: LeaverActionType;
  evidenceNote: string;
  evidenceFiles: string[];
  actionedBy: string | null;
  actionedAt: Date | null;
};

export type LeaverReport = {
  caseId: string;
  status: string;
  openedAt: Date;
  closedAt: Date | null;
  openedBy: string | null;
  notes: string;
  person: {
    id: string;
    fullName: string;
    primaryEmail: string | null;
    department: string | null;
    lineManager: string | null;
    leaveDate: Date | null;
  };
  lines: LeaverReportLine[];
  outstanding: number;
};

/** The single audit artefact produced by the leaver process. */
export async function buildLeaverReport(caseId: string): Promise<LeaverReport> {
  const leaverCase = await prisma.leaverCase.findUnique({
    where: { id: caseId },
    include: {
      person: true,
      openedBy: true,
      actions: {
        include: {
          accessRecord: { include: { vendor: true, instance: true } },
          actionedBy: true,
          evidence: true,
        },
        orderBy: { accessRecord: { vendor: { name: "asc" } } },
      },
    },
  });
  if (!leaverCase) throw new Error("Leaver case not found");

  return {
    caseId: leaverCase.id,
    status: leaverCase.status,
    openedAt: leaverCase.openedAt,
    closedAt: leaverCase.closedAt,
    openedBy: leaverCase.openedBy?.fullName ?? null,
    notes: leaverCase.notes,
    person: {
      id: leaverCase.person.id,
      fullName: leaverCase.person.fullName,
      primaryEmail: leaverCase.person.primaryEmail,
      department: leaverCase.person.department,
      lineManager: leaverCase.person.lineManager,
      leaveDate: leaverCase.person.leaveDate,
    },
    lines: leaverCase.actions.map((action) => ({
      vendorName: action.accessRecord.vendor.name,
      instanceName: action.accessRecord.instance?.name ?? null,
      rawUsername: action.accessRecord.rawUsername,
      rawEmail: action.accessRecord.rawEmail,
      role: action.accessRecord.role,
      permissionLevel: action.accessRecord.permissionLevel,
      accountStatus: action.accessRecord.accountStatus,
      action: action.action,
      evidenceNote: action.evidenceNote,
      evidenceFiles: action.evidence.map((e) => e.filename),
      actionedBy: action.actionedBy?.fullName ?? null,
      actionedAt: action.actionedAt,
    })),
    outstanding: leaverCase.actions.filter((a) => a.action === "PENDING").length,
  };
}
