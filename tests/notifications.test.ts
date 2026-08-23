import { beforeEach, describe, expect, it } from "vitest";
import { runDailyDigest } from "@/lib/notifications/digest";
import type { EmailMessage } from "@/lib/notifications/email";
import { makeVendor, prisma, resetDatabase } from "./helpers";

/**
 * The one rule that matters here: a condition is emailed once, the day it
 * starts being true, never repeated for as long as it stays true. Every test
 * below is really testing that dedup, one alert kind at a time.
 */

async function makeOwner(email = "owner@wosg.example") {
  return prisma.appUser.create({
    data: { email, fullName: "Vendor Owner", role: "VENDOR_OWNER", passwordHash: "x" },
  });
}

function collectingSend() {
  const sent: EmailMessage[] = [];
  return { sent, send: async (message: EmailMessage) => void sent.push(message) };
}

beforeEach(resetDatabase);

describe("daily digest — new dormant / leaver / expiring alerts", () => {
  it("emails once for a newly dormant account, then never again while it stays dormant", async () => {
    const owner = await makeOwner();
    const vendor = await makeVendor({ ownerUserId: owner.id, exposesLastLogin: true });

    const longAgo = new Date();
    longAgo.setFullYear(longAgo.getFullYear() - 2);

    await prisma.accessRecord.create({
      data: {
        vendorId: vendor.id,
        matchKey: "dormant-account",
        rawUsername: "d.ormant",
        lastLogin: longAgo,
        lastLoginState: "CAPTURED",
      },
    });

    const first = collectingSend();
    const firstSummary = await runDailyDigest(first.send);
    expect(firstSummary.recordAlertsSent).toBe(1);
    expect(first.sent).toHaveLength(1);
    expect(first.sent[0].to).toBe("owner@wosg.example");
    expect(first.sent[0].html).toContain("d.ormant");

    const second = collectingSend();
    const secondSummary = await runDailyDigest(second.send);
    expect(secondSummary.recordAlertsSent).toBe(0);
    expect(second.sent).toHaveLength(0);
  });

  it("notifies again if a resolved condition comes back", async () => {
    const owner = await makeOwner();
    const vendor = await makeVendor({ ownerUserId: owner.id, exposesLastLogin: true });

    const longAgo = new Date();
    longAgo.setFullYear(longAgo.getFullYear() - 2);

    const record = await prisma.accessRecord.create({
      data: {
        vendorId: vendor.id,
        matchKey: "recurs",
        lastLogin: longAgo,
        lastLoginState: "CAPTURED",
      },
    });

    await runDailyDigest(collectingSend().send);
    expect(await prisma.notificationLog.count()).toBe(1);

    // Resolved: confirm the account, clearing dormant.
    await prisma.accessRecord.update({ where: { id: record.id }, data: { lastLogin: new Date() } });
    await runDailyDigest(collectingSend().send);
    expect(await prisma.notificationLog.count()).toBe(0);

    // Dormant again — this time it must re-alert.
    await prisma.accessRecord.update({ where: { id: record.id }, data: { lastLogin: longAgo } });
    const third = collectingSend();
    const summary = await runDailyDigest(third.send);
    expect(summary.recordAlertsSent).toBe(1);
    expect(third.sent).toHaveLength(1);
  });

  it("does not mark an alert as notified if sending the email fails", async () => {
    const owner = await makeOwner();
    const vendor = await makeVendor({ ownerUserId: owner.id, exposesLastLogin: true });
    const longAgo = new Date();
    longAgo.setFullYear(longAgo.getFullYear() - 2);

    await prisma.accessRecord.create({
      data: { vendorId: vendor.id, matchKey: "flaky-send", lastLogin: longAgo, lastLoginState: "CAPTURED" },
    });

    const failing = await runDailyDigest(async () => {
      throw new Error("Resend is down");
    });
    expect(failing.recordAlertsSent).toBe(1);
    expect(failing.emailsSent).toBe(0);
    expect(failing.emailErrors).toBe(1);
    // Nothing was actually delivered, so nothing should be marked as handled.
    expect(await prisma.notificationLog.count()).toBe(0);

    // A working send afterwards must still pick this alert up.
    const retry = collectingSend();
    const retrySummary = await runDailyDigest(retry.send);
    expect(retrySummary.recordAlertsSent).toBe(1);
    expect(retry.sent).toHaveLength(1);
    expect(await prisma.notificationLog.count()).toBe(1);
  });

  it("skips vendors with no owner rather than failing the whole run", async () => {
    const vendor = await makeVendor({ exposesLastLogin: true });
    const longAgo = new Date();
    longAgo.setFullYear(longAgo.getFullYear() - 2);

    await prisma.accessRecord.create({
      data: { vendorId: vendor.id, matchKey: "unowned", lastLogin: longAgo, lastLoginState: "CAPTURED" },
    });

    const { sent, send } = collectingSend();
    const summary = await runDailyDigest(send);
    expect(summary.recordAlertsSent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("combines several new alerts for the same owner into one email", async () => {
    const owner = await makeOwner();
    const vendor = await makeVendor({ ownerUserId: owner.id, exposesLastLogin: true });
    const longAgo = new Date();
    longAgo.setFullYear(longAgo.getFullYear() - 2);

    await prisma.accessRecord.createMany({
      data: [
        { vendorId: vendor.id, matchKey: "one", lastLogin: longAgo, lastLoginState: "CAPTURED" },
        { vendorId: vendor.id, matchKey: "two", lastLogin: longAgo, lastLoginState: "CAPTURED" },
      ],
    });

    const { sent, send } = collectingSend();
    const summary = await runDailyDigest(send);
    expect(summary.recordAlertsSent).toBe(2);
    expect(sent).toHaveLength(1);
  });
});

describe("daily digest — review cycle reminders", () => {
  async function openCycle(ownerId: string, vendorId: string, dueAt: Date) {
    const record = await prisma.accessRecord.create({
      data: { vendorId, matchKey: `review-${Math.random()}` },
    });
    const cycle = await prisma.reviewCycle.create({
      data: { name: "Q1 2026", type: "QUARTERLY", dueAt },
    });
    await prisma.reviewItem.create({
      data: { cycleId: cycle.id, accessRecordId: record.id, reviewerUserId: ownerId },
    });
    return cycle;
  }

  it("alerts once when a cycle becomes overdue", async () => {
    const owner = await makeOwner();
    const vendor = await makeVendor({ ownerUserId: owner.id });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await openCycle(owner.id, vendor.id, yesterday);

    const first = collectingSend();
    const firstSummary = await runDailyDigest(first.send);
    expect(firstSummary.cycleAlertsSent).toBe(1);
    expect(first.sent).toHaveLength(1);
    expect(first.sent[0].html).toContain("overdue");

    const second = collectingSend();
    const secondSummary = await runDailyDigest(second.send);
    expect(secondSummary.cycleAlertsSent).toBe(0);
    expect(second.sent).toHaveLength(0);
  });

  it("does not alert on a cycle with nothing outstanding", async () => {
    const owner = await makeOwner();
    const vendor = await makeVendor({ ownerUserId: owner.id });
    const record = await prisma.accessRecord.create({
      data: { vendorId: vendor.id, matchKey: "reviewed-already" },
    });
    const cycle = await prisma.reviewCycle.create({
      data: { name: "Fully reviewed", type: "QUARTERLY", dueAt: new Date(Date.now() - 86_400_000) },
    });
    await prisma.reviewItem.create({
      data: {
        cycleId: cycle.id,
        accessRecordId: record.id,
        reviewerUserId: owner.id,
        outcome: "KEEP",
        reviewedAt: new Date(),
      },
    });

    const { sent, send } = collectingSend();
    const summary = await runDailyDigest(send);
    expect(summary.cycleAlertsSent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("does not alert on a cycle that is not due soon yet", async () => {
    const owner = await makeOwner();
    const vendor = await makeVendor({ ownerUserId: owner.id });
    const farAway = new Date();
    farAway.setDate(farAway.getDate() + 60);
    await openCycle(owner.id, vendor.id, farAway);

    const { sent, send } = collectingSend();
    const summary = await runDailyDigest(send);
    expect(summary.cycleAlertsSent).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
