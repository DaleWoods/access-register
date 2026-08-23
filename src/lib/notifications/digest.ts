import "server-only";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { refreshAllFlags } from "@/lib/flags";
import { sendEmail, type EmailMessage } from "@/lib/notifications/email";

/**
 * The daily email digest: tells each vendor owner about accounts that just
 * became dormant, just became a leaver-with-access, are about to expire, or
 * belong to a review cycle that is due soon or overdue.
 *
 * The one rule that matters: every condition here is notified once, the day
 * it starts being true, not once a day for as long as it stays true. See
 * NotificationLog in schema.prisma. Recalculating a flag that was already
 * true changes nothing; only the transition into a flagged state is news.
 *
 * Notification rows are only written for an owner once that owner's email has
 * actually sent. Writing them the moment an alert is *found* would mean a
 * Resend outage or a bad API key silently and permanently swallows the
 * alert — the condition would never be retried, because the log would
 * already claim it was handled.
 */

const RECORD_KINDS = ["dormant", "leaver_with_access", "expiring_soon"] as const;
type RecordKind = (typeof RECORD_KINDS)[number];

const KIND_LABELS: Record<RecordKind, string> = {
  dormant: "Newly dormant",
  leaver_with_access: "Leaver still has access",
  expiring_soon: "Expiring soon",
};

export type DigestSummary = {
  recordAlertsSent: number;
  cycleAlertsSent: number;
  emailsSent: number;
  emailErrors: number;
};

type Send = (message: EmailMessage) => Promise<void>;

type PendingLog = { entityType: string; entityId: string; kind: string };

type OwnerDigest = {
  email: string;
  fullName: string;
  recordSections: Map<RecordKind, string[]>;
  cycleLines: string[];
  pendingLogs: PendingLog[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ownerBucket(owners: Map<string, OwnerDigest>, id: string, email: string, fullName: string): OwnerDigest {
  let bucket = owners.get(id);
  if (!bucket) {
    bucket = { email, fullName, recordSections: new Map(), cycleLines: [], pendingLogs: [] };
    owners.set(id, bucket);
  }
  return bucket;
}

function renderEmail(owner: OwnerDigest): string {
  const parts: string[] = [
    `<p>Hi ${escapeHtml(owner.fullName)},</p>`,
    `<p>The access register has new items that need your attention:</p>`,
  ];

  for (const kind of RECORD_KINDS) {
    const lines = owner.recordSections.get(kind);
    if (!lines || lines.length === 0) continue;
    parts.push(`<h3>${escapeHtml(KIND_LABELS[kind])} (${lines.length})</h3><ul>`);
    for (const line of lines) parts.push(`<li>${line}</li>`);
    parts.push("</ul>");
  }

  if (owner.cycleLines.length) {
    parts.push("<h3>Reviews</h3><ul>");
    for (const line of owner.cycleLines) parts.push(`<li>${line}</li>`);
    parts.push("</ul>");
  }

  parts.push("<p>Open the Access Register to act on these.</p>");
  return parts.join("\n");
}

/**
 * New-flag alerts for AccessRecord rows: dormant, leaver_with_access,
 * expiring_soon. Resolves stale log rows unconditionally (that part is safe
 * regardless of whether any email sends this run) and stages new ones onto
 * each owner's bucket, to be committed only once that owner's send succeeds.
 */
async function collectRecordAlerts(owners: Map<string, OwnerDigest>): Promise<number> {
  const candidates = await prisma.accessRecord.findMany({
    where: { flags: { hasSome: [...RECORD_KINDS] }, accountStatus: { not: "REMOVED" } },
    select: {
      id: true,
      flags: true,
      rawUsername: true,
      rawEmail: true,
      vendor: { select: { name: true, ownerUserId: true, owner: { select: { email: true, fullName: true } } } },
      person: { select: { fullName: true } },
    },
  });

  const existingLogs = await prisma.notificationLog.findMany({
    where: { entityType: "AccessRecord", kind: { in: [...RECORD_KINDS] } },
    select: { id: true, entityId: true, kind: true },
  });
  const alreadyNotified = new Set(existingLogs.map((l) => `${l.entityId}:${l.kind}`));

  // Resolved: a log row exists for a kind the record no longer carries. Safe
  // to clear immediately — there is nothing left to (re-)send about it.
  const currentByRecord = new Map(candidates.map((r) => [r.id, new Set(r.flags)]));
  const toResolve = existingLogs
    .filter((log) => !(currentByRecord.get(log.entityId)?.has(log.kind) ?? false))
    .map((log) => log.id);
  if (toResolve.length) {
    await prisma.notificationLog.deleteMany({ where: { id: { in: toResolve } } });
  }

  let newAlerts = 0;

  for (const record of candidates) {
    if (!record.vendor.ownerUserId || !record.vendor.owner) continue; // nothing to email
    for (const kind of RECORD_KINDS) {
      if (!record.flags.includes(kind)) continue;
      if (alreadyNotified.has(`${record.id}:${kind}`)) continue;

      const who = record.person?.fullName ?? (record.rawUsername || record.rawEmail || "unmatched account");
      const bucket = ownerBucket(
        owners,
        record.vendor.ownerUserId,
        record.vendor.owner.email,
        record.vendor.owner.fullName,
      );
      const section = bucket.recordSections.get(kind) ?? [];
      section.push(`${escapeHtml(record.vendor.name)} — ${escapeHtml(who)}`);
      bucket.recordSections.set(kind, section);
      bucket.pendingLogs.push({ entityType: "AccessRecord", entityId: record.id, kind });

      newAlerts += 1;
    }
  }

  return newAlerts;
}

/**
 * Due-soon / overdue alerts for open review cycles, once per (cycle, kind,
 * owner). The owner is part of the dedup key — not just the cycle — so one
 * owner's failed send never blocks another owner's alert on the same cycle.
 */
async function collectCycleAlerts(owners: Map<string, OwnerDigest>, reviewDueSoonDays: number): Promise<number> {
  const now = new Date();
  const dueSoonHorizon = new Date(now.getTime() + reviewDueSoonDays * 24 * 60 * 60 * 1000);

  const cycles = await prisma.reviewCycle.findMany({
    where: { status: "OPEN" },
    select: {
      id: true,
      name: true,
      dueAt: true,
      items: {
        where: { outcome: null },
        select: {
          reviewerUserId: true,
          reviewer: { select: { email: true, fullName: true } },
        },
      },
    },
  });

  const kindByCycle = new Map<string, "review_overdue" | "review_due_soon">();
  for (const cycle of cycles) {
    if (cycle.items.length === 0) continue; // fully reviewed, nothing outstanding
    if (cycle.dueAt < now) kindByCycle.set(cycle.id, "review_overdue");
    else if (cycle.dueAt <= dueSoonHorizon) kindByCycle.set(cycle.id, "review_due_soon");
  }
  if (kindByCycle.size === 0) return 0;

  // entityId is "cycleId:ownerId" (see below), so this cannot be filtered by
  // cycle id with a plain `in` — fetch the (small) table of cycle logs whole.
  const existingLogs = await prisma.notificationLog.findMany({
    where: { entityType: "ReviewCycle" },
    select: { entityId: true, kind: true },
  });
  const alreadyNotified = new Set(existingLogs.map((l) => `${l.entityId}:${l.kind}`));

  let newAlerts = 0;

  for (const cycle of cycles) {
    const kind = kindByCycle.get(cycle.id);
    if (!kind) continue;

    const byOwner = new Map<string, { email: string; fullName: string; count: number }>();
    for (const item of cycle.items) {
      if (!item.reviewerUserId || !item.reviewer) continue;
      const entry = byOwner.get(item.reviewerUserId) ?? {
        email: item.reviewer.email,
        fullName: item.reviewer.fullName,
        count: 0,
      };
      entry.count += 1;
      byOwner.set(item.reviewerUserId, entry);
    }

    const verb = kind === "review_overdue" ? "overdue" : "due soon";
    for (const [ownerId, entry] of byOwner) {
      const entityId = `${cycle.id}:${ownerId}`;
      if (alreadyNotified.has(`${entityId}:${kind}`)) continue;

      const bucket = ownerBucket(owners, ownerId, entry.email, entry.fullName);
      bucket.cycleLines.push(
        `"${escapeHtml(cycle.name)}" is ${verb} — ${entry.count} account(s) still need your outcome`,
      );
      bucket.pendingLogs.push({ entityType: "ReviewCycle", entityId, kind });
      newAlerts += 1;
    }
  }

  return newAlerts;
}

export async function runDailyDigest(send: Send = sendEmail): Promise<DigestSummary> {
  // Self-healing: a digest run is also a fine time to make sure flags are
  // fresh, in case something upstream missed a recalculation.
  await refreshAllFlags();

  const settings = await getSettings();
  const owners = new Map<string, OwnerDigest>();

  const recordAlertsSent = await collectRecordAlerts(owners);
  const cycleAlertsSent = await collectCycleAlerts(owners, settings.reviewDueSoonDays);

  let emailsSent = 0;
  let emailErrors = 0;

  for (const owner of owners.values()) {
    try {
      await send({
        to: owner.email,
        subject: "Access register: items need your attention",
        html: renderEmail(owner),
      });
      emailsSent += 1;
      // Only mark these alerts as handled now that the email actually sent.
      if (owner.pendingLogs.length) {
        await prisma.notificationLog.createMany({ data: owner.pendingLogs, skipDuplicates: true });
      }
    } catch {
      emailErrors += 1;
      // Leave pendingLogs uncommitted so this owner's alerts are reconsidered
      // — and re-sent — on the next run.
    }
  }

  return { recordAlertsSent, cycleAlertsSent, emailsSent, emailErrors };
}
