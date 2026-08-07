import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export const TEST_USER = {
  id: "",
  fullName: "Test Runner",
  email: "test-runner@wosg.example",
};

/**
 * Wipe and rebuild a minimal fixture. AuditEvent cannot be deleted row by row
 * (the append-only trigger blocks DELETE), so the tests TRUNCATE instead —
 * which is a schema-level operation, not a row-level one.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "EvidenceFile", "LeaverAction", "LeaverCase",
      "ReviewItem", "ReviewCycle",
      "DisappearedCandidate", "StagedRow", "ImportBatch", "ColumnMapping",
      "AccessRecord", "Person", "VendorInstance", "VendorGrant", "Vendor",
      "SavedView", "AuditEvent", "AppUser", "AppSetting"
    RESTART IDENTITY CASCADE
  `);

  const user = await prisma.appUser.create({
    data: {
      email: TEST_USER.email,
      fullName: TEST_USER.fullName,
      role: "ADMIN",
      passwordHash: "x",
    },
  });
  TEST_USER.id = user.id;
}

export async function makeVendor(
  overrides: Partial<{
    name: string;
    exposesLastLogin: boolean;
    exposesPasswordExpiry: boolean;
    reviewFrequencyMonths: number;
  }> = {},
) {
  return prisma.vendor.create({
    data: {
      name: overrides.name ?? `Vendor ${Math.random().toString(36).slice(2, 8)}`,
      category: "OTHER",
      captureMethod: "CSV_EXPORT",
      exposesLastLogin: overrides.exposesLastLogin ?? true,
      exposesPasswordExpiry: overrides.exposesPasswordExpiry ?? false,
      reviewFrequencyMonths: overrides.reviewFrequencyMonths ?? 3,
    },
  });
}

export const STANDARD_MAPPING = {
  username: "rawUsername",
  email: "rawEmail",
  name: "fullName",
  role: "role",
  status: "accountStatus",
  last_login: "lastLogin",
};

export const CSV_V1 = `username,email,name,role,status,last_login
dwoods,dale.woods@wosg.example,Dale Woods,Admin,Active,2026-08-01
pshah,priya.shah@wosg.example,Priya Shah,Support,Active,2026-07-20
treeves,tom.reeves@wosg.example,Tom Reeves,Admin,Active,2026-03-02
`;
