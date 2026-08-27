import "server-only";
import { prisma } from "@/lib/db";
import { FLAGS } from "@/lib/flags";

/**
 * Daily history of the register's headline counts.
 *
 * Flags are derived and recomputed in place, so without this the app has no
 * way to answer "was this getting better or worse?". Capture runs from the
 * same daily job as the email digest.
 *
 * Nothing here can be backfilled: a day the job did not run has no row, and
 * inventing one would be fabricating a measurement. Readers therefore take the
 * days that exist and plot those, rather than assuming a contiguous series.
 */

/** Midnight UTC for a given moment — the key one snapshot per day hangs on. */
export function dayKey(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export type SnapshotCounts = {
  activeAccounts: number;
  removedAccounts: number;
  flaggedAccounts: number;
  dormant: number;
  unverifiable: number;
  unmatched: number;
  neverReviewed: number;
  reviewOverdue: number;
  expiringSoon: number;
  expired: number;
  leaverAccounts: number;
  leaverPeople: number;
};

/** Count everything the snapshot records, estate-wide. */
export async function currentCounts(): Promise<SnapshotCounts> {
  const live = { accountStatus: { not: "REMOVED" } } as const;

  const [
    activeAccounts,
    removedAccounts,
    flaggedAccounts,
    dormant,
    unverifiable,
    unmatched,
    neverReviewed,
    reviewOverdue,
    expiringSoon,
    expired,
    leaverAccounts,
    leaverPeople,
  ] = await Promise.all([
    prisma.accessRecord.count({ where: { accountStatus: "ACTIVE" } }),
    prisma.accessRecord.count({ where: { accountStatus: "REMOVED" } }),
    prisma.accessRecord.count({ where: { ...live, NOT: { flags: { isEmpty: true } } } }),
    prisma.accessRecord.count({ where: { flags: { has: FLAGS.dormant } } }),
    prisma.accessRecord.count({ where: { flags: { has: FLAGS.unverifiable } } }),
    prisma.accessRecord.count({ where: { ...live, personId: null } }),
    prisma.accessRecord.count({ where: { flags: { has: FLAGS.neverReviewed } } }),
    prisma.accessRecord.count({ where: { flags: { has: FLAGS.reviewOverdue } } }),
    prisma.accessRecord.count({ where: { flags: { has: FLAGS.expiringSoon } } }),
    prisma.accessRecord.count({ where: { flags: { has: FLAGS.expired } } }),
    prisma.accessRecord.count({ where: { flags: { has: FLAGS.leaverWithAccess } } }),
    prisma.person.count({
      where: { employeeStatus: "LEFT", accessRecords: { some: live } },
    }),
  ]);

  return {
    activeAccounts,
    removedAccounts,
    flaggedAccounts,
    dormant,
    unverifiable,
    unmatched,
    neverReviewed,
    reviewOverdue,
    expiringSoon,
    expired,
    leaverAccounts,
    leaverPeople,
  };
}

/**
 * Record today's counts. Idempotent: running twice in one day overwrites that
 * day rather than adding a second row, so a manual run or a retried cron does
 * not distort the series.
 */
export async function captureSnapshot(now: Date = new Date()): Promise<SnapshotCounts> {
  const counts = await currentCounts();
  const day = dayKey(now);

  await prisma.registerSnapshot.upsert({
    where: { day },
    create: { day, ...counts },
    update: { ...counts, capturedAt: now },
  });

  return counts;
}

export type TrendPoint = SnapshotCounts & { day: Date };

/** The most recent `days` days of history, oldest first, gaps included as gaps. */
export async function recentSnapshots(days = 90): Promise<TrendPoint[]> {
  const from = dayKey();
  from.setUTCDate(from.getUTCDate() - days);

  const rows = await prisma.registerSnapshot.findMany({
    where: { day: { gte: from } },
    orderBy: { day: "asc" },
  });

  return rows.map(({ id: _id, capturedAt: _capturedAt, ...point }) => point);
}
