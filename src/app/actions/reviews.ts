"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ReviewCycleType, ReviewOutcome } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, requireWriter, toActor } from "@/lib/auth/guards";
import { canEditVendor } from "@/lib/auth/policy";
import {
  actorFrom,
  newCorrelationId,
  recordChanges,
  recordCreate,
  recordEvent,
  type AuditContext,
} from "@/lib/audit";
import { refreshFlagsForRecords } from "@/lib/flags";
import { challengesFor } from "@/lib/review-challenges";

/**
 * Review cycles. An admin opens a cycle; every live account becomes a
 * ReviewItem assigned to the vendor's owner, who records keep / downgrade /
 * remove with notes. Closing the cycle produces the exportable audit record.
 */

function contextFor(user: { id: string; fullName: string; email: string }): AuditContext {
  return { actor: actorFrom(user), source: "REVIEW", correlationId: newCorrelationId() };
}

export async function openReviewCycle(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const context = contextFor(admin);

  const name = String(formData.get("name") ?? "").trim();
  const type = (String(formData.get("type") ?? "QUARTERLY") || "QUARTERLY") as ReviewCycleType;
  const dueRaw = String(formData.get("dueAt") ?? "");
  if (!name) throw new Error("Give the cycle a name, for example \"Q1 2026\"");
  if (!dueRaw) throw new Error("Set a due date");

  // Everything still live is in scope. Removed accounts need no review.
  const records = await prisma.accessRecord.findMany({
    where: { accountStatus: { not: "REMOVED" }, vendor: { isArchived: false } },
    include: { vendor: { select: { ownerUserId: true } } },
  });

  const cycle = await prisma.$transaction(async (tx) => {
    const created = await tx.reviewCycle.create({
      data: {
        name,
        type,
        dueAt: new Date(`${dueRaw}T23:59:59.000Z`),
        openedById: admin.id,
      },
    });

    if (records.length) {
      await tx.reviewItem.createMany({
        data: records.map((record) => ({
          cycleId: created.id,
          accessRecordId: record.id,
          // Assigned to the vendor's accountable owner.
          reviewerUserId: record.vendor.ownerUserId,
          challenges: challengesFor(record),
        })),
      });
    }

    await recordCreate({
      db: tx,
      entityType: "ReviewCycle",
      entityId: created.id,
      context,
      summary: `review cycle "${name}" opened covering ${records.length} account(s)`,
    });
    return created;
  });

  revalidatePath("/reviews");
  redirect(`/reviews/${cycle.id}`);
}

export async function recordReviewOutcome(formData: FormData): Promise<void> {
  const user = await requireWriter();
  const context = contextFor(user);

  const itemId = String(formData.get("itemId") ?? "");
  const outcome = String(formData.get("outcome") ?? "") as ReviewOutcome;
  const notes = String(formData.get("notes") ?? "").trim();

  const item = await prisma.reviewItem.findUniqueOrThrow({
    where: { id: itemId },
    include: { accessRecord: true, cycle: true },
  });

  if (item.cycle.status === "CLOSED") throw new Error("That review cycle is closed");
  if (!canEditVendor(toActor(user), item.accessRecord.vendorId)) {
    throw new Error("You do not have edit access to this vendor");
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.reviewItem.update({
      where: { id: itemId },
      data: { outcome, notes, reviewerUserId: user.id, reviewedAt: now },
    });

    // A review is a human confirming the row, whatever the outcome.
    await tx.accessRecord.update({
      where: { id: item.accessRecordId },
      data: { lastReviewedAt: now, lastConfirmed: now },
    });

    if (outcome === "REMOVE" && item.accessRecord.accountStatus !== "REMOVED") {
      await tx.accessRecord.update({
        where: { id: item.accessRecordId },
        data: { accountStatus: "REMOVED" },
      });
      await recordChanges({
        db: tx,
        entityType: "AccessRecord",
        entityId: item.accessRecordId,
        context,
        changes: [
          {
            field: "accountStatus",
            oldValue: item.accessRecord.accountStatus,
            newValue: "REMOVED",
          },
        ],
      });
    }

    await recordEvent({
      db: tx,
      entityType: "AccessRecord",
      entityId: item.accessRecordId,
      context,
      field: "review_outcome",
      newValue: `${item.cycle.name}: ${outcome}${notes ? ` — ${notes}` : ""}`,
    });
  });

  await refreshFlagsForRecords([item.accessRecordId]);
  revalidatePath(`/reviews/${item.cycleId}`);
}

export async function closeReviewCycle(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const context = contextFor(admin);
  const cycleId = String(formData.get("cycleId") ?? "");

  const outstanding = await prisma.reviewItem.count({
    where: { cycleId, outcome: null },
  });
  const force = formData.get("force") === "1";
  if (outstanding > 0 && !force) {
    throw new Error(`${outstanding} account(s) have not been reviewed yet`);
  }

  await prisma.reviewCycle.update({
    where: { id: cycleId },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  await recordEvent({
    entityType: "ReviewCycle",
    entityId: cycleId,
    context,
    newValue:
      outstanding > 0
        ? `cycle closed with ${outstanding} account(s) unreviewed`
        : "cycle closed with every account reviewed",
  });

  revalidatePath(`/reviews/${cycleId}`);
  revalidatePath("/reviews");
}
