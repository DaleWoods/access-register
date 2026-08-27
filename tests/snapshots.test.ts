import { beforeEach, describe, expect, it } from "vitest";
import { captureSnapshot, dayKey, recentSnapshots } from "@/lib/snapshots";
import { refreshFlagsForRecords } from "@/lib/flags";
import { makeVendor, prisma, resetDatabase } from "./helpers";

/**
 * Snapshots are the only history of derived state, and they cannot be
 * backfilled — so the properties that matter are that a day is captured once,
 * re-running does not duplicate or distort it, and gaps stay gaps.
 */

beforeEach(resetDatabase);

async function dormantAccount(vendorId: string, matchKey: string) {
  const longAgo = new Date();
  longAgo.setFullYear(longAgo.getFullYear() - 2);
  const record = await prisma.accessRecord.create({
    data: { vendorId, matchKey, lastLogin: longAgo, lastLoginState: "CAPTURED" },
  });
  await refreshFlagsForRecords([record.id]);
  return record;
}

describe("daily snapshots", () => {
  it("records the register's headline counts", async () => {
    const vendor = await makeVendor({ exposesLastLogin: true });
    await dormantAccount(vendor.id, "one");
    await dormantAccount(vendor.id, "two");

    const counts = await captureSnapshot();

    expect(counts.activeAccounts).toBe(2);
    expect(counts.dormant).toBe(2);
    // Both are unmatched to a person as well, so they carry more than one flag.
    expect(counts.unmatched).toBe(2);
    expect(counts.flaggedAccounts).toBe(2);

    const stored = await prisma.registerSnapshot.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0].dormant).toBe(2);
  });

  it("is idempotent within a day — a second run updates rather than duplicating", async () => {
    const vendor = await makeVendor({ exposesLastLogin: true });
    await dormantAccount(vendor.id, "one");
    await captureSnapshot();

    await dormantAccount(vendor.id, "two");
    const second = await captureSnapshot();

    const stored = await prisma.registerSnapshot.findMany();
    expect(stored).toHaveLength(1);
    // The day reflects the latest run, not the first.
    expect(stored[0].dormant).toBe(2);
    expect(second.dormant).toBe(2);
  });

  it("keeps one row per day and returns them oldest first", async () => {
    const vendor = await makeVendor({ exposesLastLogin: true });
    await dormantAccount(vendor.id, "one");

    const today = dayKey();
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);

    await captureSnapshot();
    // Backdated rows stand in for earlier runs. Note the deliberate gap
    // between last week and yesterday — days the job did not run.
    for (const day of [yesterday, lastWeek]) {
      await prisma.registerSnapshot.create({
        data: {
          day,
          activeAccounts: 1,
          removedAccounts: 0,
          flaggedAccounts: 1,
          dormant: 1,
          unverifiable: 0,
          unmatched: 1,
          neverReviewed: 1,
          reviewOverdue: 0,
          expiringSoon: 0,
          expired: 0,
          leaverAccounts: 0,
          leaverPeople: 0,
        },
      });
    }

    const points = await recentSnapshots(90);
    expect(points).toHaveLength(3);
    expect(points.map((p) => p.day.getTime())).toEqual([
      lastWeek.getTime(),
      yesterday.getTime(),
      today.getTime(),
    ]);
  });

  it("excludes snapshots older than the requested window", async () => {
    const old = dayKey();
    old.setUTCDate(old.getUTCDate() - 100);

    await prisma.registerSnapshot.create({
      data: {
        day: old,
        activeAccounts: 5,
        removedAccounts: 0,
        flaggedAccounts: 0,
        dormant: 0,
        unverifiable: 0,
        unmatched: 0,
        neverReviewed: 0,
        reviewOverdue: 0,
        expiringSoon: 0,
        expired: 0,
        leaverAccounts: 0,
        leaverPeople: 0,
      },
    });
    await captureSnapshot();

    const points = await recentSnapshots(90);
    expect(points).toHaveLength(1);
    expect(points[0].day.getTime()).toBe(dayKey().getTime());
  });

  it("counts leavers as people as well as accounts", async () => {
    const vendor = await makeVendor();
    const person = await prisma.person.create({
      data: { fullName: "Gone Person", primaryEmail: "gone@wosg.example", employeeStatus: "LEFT" },
    });
    const records = await Promise.all([
      prisma.accessRecord.create({
        data: { vendorId: vendor.id, matchKey: "a", personId: person.id },
      }),
      prisma.accessRecord.create({
        data: { vendorId: vendor.id, matchKey: "b", personId: person.id },
      }),
    ]);
    await refreshFlagsForRecords(records.map((r) => r.id));

    const counts = await captureSnapshot();
    expect(counts.leaverAccounts).toBe(2);
    expect(counts.leaverPeople).toBe(1);
  });
});
