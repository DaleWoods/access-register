import { beforeEach, describe, expect, it } from "vitest";
import { stageImport } from "@/lib/import/stage";
import { commitImport } from "@/lib/import/commit";
import { computeFlags } from "@/lib/flags";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { canWrite, canEditVendor, canViewVendor, vendorScope } from "@/lib/auth/policy";
import {
  CSV_V1,
  STANDARD_MAPPING,
  TEST_USER,
  makeVendor,
  prisma,
  resetDatabase,
} from "./helpers";

/**
 * These map one-to-one onto section 7 of the requirements. Each test is named
 * after the acceptance criterion it proves.
 */

async function stageAndCommit(
  vendorId: string,
  text: string,
  opts: {
    createPeople?: boolean;
    confirmRemovals?: boolean;
    mapping?: Record<string, string>;
  } = {},
) {
  const staged = await stageImport({
    vendorId,
    instanceId: null,
    sourceFilename: "export.csv",
    text,
    mapping: opts.mapping ?? STANDARD_MAPPING,
    userId: TEST_USER.id,
  });
  if (!staged.ok) throw new Error(staged.errors.join("; "));

  if (opts.createPeople) {
    await prisma.stagedRow.updateMany({
      where: { batchId: staged.batchId, decidedPersonId: null, diff: { not: "INVALID" } },
      data: { createPerson: true },
    });
  }
  if (opts.confirmRemovals) {
    await prisma.disappearedCandidate.updateMany({
      where: { batchId: staged.batchId },
      data: { confirmRemove: true },
    });
  }

  const result = await commitImport({ batchId: staged.batchId, user: TEST_USER });
  return { staged, result };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("AC1 — importing the same CSV twice produces zero changes", () => {
  it("second import reports nothing new, changed or disappeared", async () => {
    const vendor = await makeVendor();

    const first = await stageAndCommit(vendor.id, CSV_V1, { createPeople: true });
    expect(first.result.created).toBe(3);
    expect(first.result.personsCreated).toBe(3);

    const auditAfterFirst = await prisma.auditEvent.count({
      where: { entityType: "AccessRecord" },
    });

    const second = await stageAndCommit(vendor.id, CSV_V1);

    expect(second.staged.ok).toBe(true);
    if (!second.staged.ok) return;
    expect(second.staged.summary.new).toBe(0);
    expect(second.staged.summary.changed).toBe(0);
    expect(second.staged.summary.disappeared).toBe(0);
    expect(second.staged.summary.unchanged).toBe(3);

    expect(second.result.created).toBe(0);
    expect(second.result.updated).toBe(0);
    expect(second.result.unchanged).toBe(3);

    // No new per-record audit events: nothing about the register changed.
    const auditAfterSecond = await prisma.auditEvent.count({
      where: { entityType: "AccessRecord" },
    });
    expect(auditAfterSecond).toBe(auditAfterFirst);

    // Still exactly three accounts and three people — no duplicates.
    expect(await prisma.accessRecord.count()).toBe(3);
    expect(await prisma.person.count()).toBe(3);
  });
});

describe("AC2 — a missing account is surfaced as disappeared, never auto-removed", () => {
  it("keeps the account Active when removal is not confirmed", async () => {
    const vendor = await makeVendor();
    await stageAndCommit(vendor.id, CSV_V1, { createPeople: true });

    const withoutTom = CSV_V1.split("\n").filter((l) => !l.startsWith("treeves")).join("\n");

    const staged = await stageImport({
      vendorId: vendor.id,
      instanceId: null,
      sourceFilename: "export-2.csv",
      text: withoutTom,
      mapping: STANDARD_MAPPING,
      userId: TEST_USER.id,
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;

    expect(staged.summary.disappeared).toBe(1);

    const candidates = await prisma.disappearedCandidate.findMany({
      where: { batchId: staged.batchId },
    });
    expect(candidates).toHaveLength(1);
    // Crucially, not pre-ticked.
    expect(candidates[0].confirmRemove).toBe(false);

    await commitImport({ batchId: staged.batchId, user: TEST_USER });

    const tom = await prisma.accessRecord.findFirst({ where: { matchKey: "u:treeves" } });
    expect(tom?.accountStatus).toBe("ACTIVE");
  });

  it("marks it Removed only once a human confirms", async () => {
    const vendor = await makeVendor();
    await stageAndCommit(vendor.id, CSV_V1, { createPeople: true });

    const withoutTom = CSV_V1.split("\n").filter((l) => !l.startsWith("treeves")).join("\n");
    const { result } = await stageAndCommit(vendor.id, withoutTom, { confirmRemovals: true });

    expect(result.removed).toBe(1);
    const tom = await prisma.accessRecord.findFirst({ where: { matchKey: "u:treeves" } });
    expect(tom?.accountStatus).toBe("REMOVED");

    const events = await prisma.auditEvent.findMany({
      where: { entityId: tom!.id, field: "accountStatus" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].newValue).toBe("REMOVED");
  });
});

describe("AC3 — a person shows 100% of their accounts across all vendors", () => {
  it("collects accounts from every vendor for one human", async () => {
    const adyen = await makeVendor({ name: "Adyen" });
    const jira = await makeVendor({ name: "Jira" });
    const dpd = await makeVendor({ name: "DPD", exposesLastLogin: false });

    await stageAndCommit(adyen.id, CSV_V1, { createPeople: true });

    // Same human, different username and a known alternate address.
    const dale = await prisma.person.findFirst({ where: { fullName: "Dale Woods" } });
    await prisma.person.update({
      where: { id: dale!.id },
      data: { alternateEmails: ["d.woods@wosg.example"] },
    });

    await stageAndCommit(
      jira.id,
      `username,email,name,role,status,last_login
dale.woods,d.woods@wosg.example,Dale Woods,Developer,Active,2026-08-04
`,
      { createPeople: true },
    );

    await stageAndCommit(
      dpd.id,
      `username,email,name,role,status,last_login
dwoods,dale.woods@wosg.example,Dale Woods,Booker,Active,
`,
      { createPeople: true },
    );

    const accounts = await prisma.accessRecord.findMany({
      where: { personId: dale!.id },
      include: { vendor: true },
    });

    expect(accounts).toHaveLength(3);
    expect(accounts.map((a) => a.vendor.name).sort()).toEqual(["Adyen", "DPD", "Jira"]);
    // The alternate-email row matched the same person rather than creating a second one.
    expect(await prisma.person.count({ where: { fullName: "Dale Woods" } })).toBe(1);
  });
});

describe("AC4 — no last_login means unverifiable, never dormant", () => {
  it("flags accounts of a non-exposing vendor as unverifiable", async () => {
    const dpd = await makeVendor({ name: "DPD", exposesLastLogin: false });

    // This vendor's export genuinely has no last-login column.
    const { last_login: _omitted, ...mappingWithoutLastLogin } = STANDARD_MAPPING;

    await stageAndCommit(
      dpd.id,
      `username,email,name,role,status
warehouse01,,Warehouse One,Booker,Active
dwoods,dale.woods@wosg.example,Dale Woods,Booker,Active
`,
      { createPeople: true, mapping: mappingWithoutLastLogin },
    );

    const records = await prisma.accessRecord.findMany({ where: { vendorId: dpd.id } });
    expect(records).toHaveLength(2);

    for (const record of records) {
      expect(record.lastLoginState).toBe("NOT_EXPOSED");
      expect(record.flags).toContain("unverifiable");
      expect(record.flags).not.toContain("dormant");
    }
  });

  it("is decided by the rule engine, not by the absence of a value", () => {
    const base = {
      accountStatus: "ACTIVE" as const,
      personId: "p1",
      personEmployeeStatus: "ACTIVE" as const,
      accountExpiry: null,
      accountExpiryState: "BLANK" as const,
      passwordExpiry: null,
      passwordExpiryState: "BLANK" as const,
      justification: "needed",
      lastConfirmed: new Date(),
      lastReviewedAt: new Date(),
      reviewFrequencyMonths: 3,
    };
    const now = new Date("2026-08-07");

    const notExposed = computeFlags(
      { ...base, lastLogin: null, lastLoginState: "NOT_EXPOSED" },
      DEFAULT_SETTINGS,
      now,
    );
    expect(notExposed).toContain("unverifiable");
    expect(notExposed).not.toContain("dormant");

    const stale = computeFlags(
      { ...base, lastLogin: new Date("2024-01-01"), lastLoginState: "CAPTURED" },
      DEFAULT_SETTINGS,
      now,
    );
    expect(stale).toContain("dormant");
    expect(stale).not.toContain("unverifiable");

    // Exposed but never captured is outstanding work, not a dormancy verdict.
    const blank = computeFlags(
      { ...base, lastLogin: null, lastLoginState: "BLANK" },
      DEFAULT_SETTINGS,
      now,
    );
    expect(blank).toContain("last_login_missing");
    expect(blank).not.toContain("dormant");
    expect(blank).not.toContain("unverifiable");
  });
});

describe("AC5 — every field change is retrievable with who, when and source", () => {
  it("records old and new values against the record", async () => {
    const vendor = await makeVendor();
    await stageAndCommit(vendor.id, CSV_V1, { createPeople: true });

    const changed = CSV_V1.replace("dwoods,dale.woods@wosg.example,Dale Woods,Admin", "dwoods,dale.woods@wosg.example,Dale Woods,Read Only");
    const { result } = await stageAndCommit(vendor.id, changed);
    expect(result.updated).toBe(1);

    const record = await prisma.accessRecord.findFirst({ where: { matchKey: "u:dwoods" } });
    const history = await prisma.auditEvent.findMany({
      where: { entityType: "AccessRecord", entityId: record!.id, field: "role" },
      orderBy: { changedAt: "asc" },
    });

    expect(history).toHaveLength(1);
    expect(history[0].oldValue).toBe("Admin");
    expect(history[0].newValue).toBe("Read Only");
    expect(history[0].changeSource).toBe("IMPORT");
    expect(history[0].changedByLabel).toContain(TEST_USER.email);
    expect(history[0].changedAt).toBeInstanceOf(Date);
  });

  it("refuses to let audit history be edited or deleted", async () => {
    const vendor = await makeVendor();
    await stageAndCommit(vendor.id, CSV_V1, { createPeople: true });

    const event = await prisma.auditEvent.findFirst();
    expect(event).not.toBeNull();

    await expect(
      prisma.auditEvent.update({ where: { id: event!.id }, data: { newValue: "tampered" } }),
    ).rejects.toThrow(/append-only/i);

    await expect(
      prisma.auditEvent.delete({ where: { id: event!.id } }),
    ).rejects.toThrow(/append-only/i);
  });
});

describe("AC6 — an auditor can view and export everything, and change nothing", () => {
  it("denies every write path to the auditor role", () => {
    const auditor = { id: "u1", role: "AUDITOR" as const, vendorIds: [] };
    const admin = { id: "u2", role: "ADMIN" as const, vendorIds: [] };
    const owner = { id: "u3", role: "VENDOR_OWNER" as const, vendorIds: ["v1"] };

    expect(canWrite("AUDITOR")).toBe(false);
    expect(canWrite("ADMIN")).toBe(true);
    expect(canWrite("VENDOR_OWNER")).toBe(true);

    // Auditors see everything…
    expect(canViewVendor(auditor, "v1")).toBe(true);
    expect(canViewVendor(auditor, "v-other")).toBe(true);
    expect(vendorScope(auditor)).toBeNull();
    // …and can edit nothing.
    expect(canEditVendor(auditor, "v1")).toBe(false);
    expect(canEditVendor(auditor, "v-other")).toBe(false);

    // Vendor owners are confined to their own vendors on record screens.
    expect(canViewVendor(owner, "v1")).toBe(true);
    expect(canViewVendor(owner, "v-other")).toBe(false);
    expect(canEditVendor(owner, "v-other")).toBe(false);
    expect(vendorScope(owner)).toEqual(["v1"]);

    expect(canEditVendor(admin, "anything")).toBe(true);
  });
});

describe("AC7 — a leaver produces one report of every account with action and evidence", () => {
  it("opens a case covering every account the person holds", async () => {
    const { openLeaverCase, recordLeaverAction, buildLeaverReport } = await import(
      "@/lib/leaver"
    );

    const adyen = await makeVendor({ name: "Adyen" });
    const jira = await makeVendor({ name: "Jira" });

    await stageAndCommit(adyen.id, CSV_V1, { createPeople: true });
    await stageAndCommit(
      jira.id,
      `username,email,name,role,status,last_login
treeves,tom.reeves@wosg.example,Tom Reeves,Developer,Active,2026-03-01
`,
      { createPeople: true },
    );

    const tom = await prisma.person.findFirst({ where: { fullName: "Tom Reeves" } });
    const leaverCase = await openLeaverCase({ personId: tom!.id, user: TEST_USER });

    const actions = await prisma.leaverAction.findMany({ where: { caseId: leaverCase.id } });
    expect(actions).toHaveLength(2);
    expect(actions.every((a) => a.action === "PENDING")).toBe(true);

    for (const action of actions) {
      await recordLeaverAction({
        actionId: action.id,
        action: "REMOVED",
        evidenceNote: "Removed via vendor console, ref CHG-10422",
        user: TEST_USER,
      });
    }

    const report = await buildLeaverReport(leaverCase.id);
    expect(report.person.fullName).toBe("Tom Reeves");
    expect(report.lines).toHaveLength(2);
    expect(report.lines.map((l) => l.vendorName).sort()).toEqual(["Adyen", "Jira"]);
    for (const line of report.lines) {
      expect(line.action).toBe("REMOVED");
      expect(line.evidenceNote).toContain("CHG-10422");
      expect(line.actionedAt).toBeTruthy();
      expect(line.accountStatus).toBe("REMOVED");
    }

    // The person is marked as left, and their accounts are flagged accordingly.
    const refreshed = await prisma.person.findUnique({ where: { id: tom!.id } });
    expect(refreshed?.employeeStatus).toBe("LEFT");
  });
});
