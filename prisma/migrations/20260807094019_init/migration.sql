-- CreateEnum
CREATE TYPE "AppRole" AS ENUM ('ADMIN', 'VENDOR_OWNER', 'AUDITOR');

-- CreateEnum
CREATE TYPE "VendorCategory" AS ENUM ('PAYMENTS', 'COURIER', 'DEV_TOOLING', 'ANALYTICS', 'BRAND_PARTNER', 'HOSTING', 'OTHER');

-- CreateEnum
CREATE TYPE "CaptureMethod" AS ENUM ('CSV_EXPORT', 'API', 'MANUAL_READ');

-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('EMPLOYEE', 'CONTRACTOR', 'PARTNER', 'SERVICE_ACCOUNT');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'LEFT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DISABLED', 'REMOVED');

-- CreateEnum
CREATE TYPE "FieldState" AS ENUM ('CAPTURED', 'BLANK', 'NOT_EXPOSED');

-- CreateEnum
CREATE TYPE "ChangeSource" AS ENUM ('MANUAL', 'IMPORT', 'LEAVER_PROCESS', 'REVIEW', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('STAGED', 'COMMITTED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "StagedRowDiff" AS ENUM ('NEW', 'CHANGED', 'UNCHANGED', 'INVALID');

-- CreateEnum
CREATE TYPE "ReviewCycleType" AS ENUM ('QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "ReviewCycleStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReviewOutcome" AS ENUM ('KEEP', 'DOWNGRADE', 'REMOVE');

-- CreateEnum
CREATE TYPE "LeaverCaseStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "LeaverActionType" AS ENUM ('PENDING', 'REMOVED', 'RETAINED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "SavedViewScope" AS ENUM ('PERSONAL', 'SHARED');

-- CreateTable
CREATE TABLE "AppUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "AppRole" NOT NULL DEFAULT 'AUDITOR',
    "passwordHash" TEXT,
    "entraOid" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "canEdit" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "VendorGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "VendorCategory" NOT NULL DEFAULT 'OTHER',
    "description" TEXT NOT NULL DEFAULT '',
    "ownerUserId" TEXT,
    "captureMethod" "CaptureMethod" NOT NULL DEFAULT 'CSV_EXPORT',
    "exposesLastLogin" BOOLEAN NOT NULL DEFAULT true,
    "exposesPasswordExpiry" BOOLEAN NOT NULL DEFAULT false,
    "exposesAccountExpiry" BOOLEAN NOT NULL DEFAULT false,
    "exposesAccountCreated" BOOLEAN NOT NULL DEFAULT false,
    "reviewFrequencyMonths" INTEGER NOT NULL DEFAULT 3,
    "notes" TEXT NOT NULL DEFAULT '',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorInstance" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "VendorInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "primaryEmail" TEXT,
    "alternateEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "personType" "PersonType" NOT NULL DEFAULT 'EMPLOYEE',
    "employeeStatus" "EmployeeStatus" NOT NULL DEFAULT 'UNKNOWN',
    "department" TEXT,
    "lineManager" TEXT,
    "hrReference" TEXT,
    "startDate" TIMESTAMP(3),
    "leaveDate" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRecord" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "instanceId" TEXT,
    "personId" TEXT,
    "matchKey" TEXT NOT NULL,
    "instanceKey" TEXT NOT NULL DEFAULT '',
    "rawUsername" TEXT NOT NULL DEFAULT '',
    "rawEmail" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "permissionLevel" TEXT NOT NULL DEFAULT '',
    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "accountCreated" TIMESTAMP(3),
    "accountCreatedState" "FieldState" NOT NULL DEFAULT 'BLANK',
    "accountExpiry" TIMESTAMP(3),
    "accountExpiryState" "FieldState" NOT NULL DEFAULT 'BLANK',
    "passwordExpiry" TIMESTAMP(3),
    "passwordExpiryState" "FieldState" NOT NULL DEFAULT 'BLANK',
    "lastLogin" TIMESTAMP(3),
    "lastLoginState" "FieldState" NOT NULL DEFAULT 'BLANK',
    "justification" TEXT NOT NULL DEFAULT '',
    "source" "CaptureMethod" NOT NULL DEFAULT 'CSV_EXPORT',
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenInSource" TIMESTAMP(3),
    "lastConfirmed" TIMESTAMP(3),
    "lastReviewedAt" TIMESTAMP(3),
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "flagsSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColumnMapping" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "mapping" JSONB NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ColumnMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "instanceId" TEXT,
    "importedById" TEXT NOT NULL,
    "mappingId" TEXT,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'STAGED',
    "sourceFilename" TEXT NOT NULL DEFAULT 'pasted-data',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "payloadHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" TIMESTAMP(3),
    "discardedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StagedRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "canonical" JSONB NOT NULL,
    "diff" "StagedRowDiff" NOT NULL DEFAULT 'NEW',
    "changes" JSONB NOT NULL DEFAULT '[]',
    "errors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "matchedRecordId" TEXT,
    "matchedPersonId" TEXT,
    "suggestedPersonId" TEXT,
    "suggestedPersonScore" DOUBLE PRECISION,
    "decidedPersonId" TEXT,
    "createPerson" BOOLEAN NOT NULL DEFAULT false,
    "skip" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StagedRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisappearedCandidate" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "accessRecordId" TEXT NOT NULL,
    "confirmRemove" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DisappearedCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewCycle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ReviewCycleType" NOT NULL DEFAULT 'QUARTERLY',
    "status" "ReviewCycleStatus" NOT NULL DEFAULT 'OPEN',
    "openedById" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewItem" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "accessRecordId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "outcome" "ReviewOutcome",
    "notes" TEXT NOT NULL DEFAULT '',
    "challenges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaverCase" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "status" "LeaverCaseStatus" NOT NULL DEFAULT 'OPEN',
    "openedById" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "LeaverCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaverAction" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "accessRecordId" TEXT NOT NULL,
    "action" "LeaverActionType" NOT NULL DEFAULT 'PENDING',
    "evidenceNote" TEXT NOT NULL DEFAULT '',
    "actionedById" TEXT,
    "actionedAt" TIMESTAMP(3),

    CONSTRAINT "LeaverAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceFile" (
    "id" TEXT NOT NULL,
    "leaverActionId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedById" TEXT,
    "changedByLabel" TEXT NOT NULL DEFAULT 'system',
    "changeSource" "ChangeSource" NOT NULL DEFAULT 'MANUAL',
    "correlationId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entity" TEXT NOT NULL DEFAULT 'accessRecord',
    "ownerUserId" TEXT NOT NULL,
    "scope" "SavedViewScope" NOT NULL DEFAULT 'PERSONAL',
    "query" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_email_key" ON "AppUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_entraOid_key" ON "AppUser"("entraOid");

-- CreateIndex
CREATE INDEX "AppUser_role_idx" ON "AppUser"("role");

-- CreateIndex
CREATE INDEX "VendorGrant_vendorId_idx" ON "VendorGrant"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorGrant_userId_vendorId_key" ON "VendorGrant"("userId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_name_key" ON "Vendor"("name");

-- CreateIndex
CREATE INDEX "Vendor_ownerUserId_idx" ON "Vendor"("ownerUserId");

-- CreateIndex
CREATE INDEX "Vendor_category_idx" ON "Vendor"("category");

-- CreateIndex
CREATE INDEX "VendorInstance_vendorId_idx" ON "VendorInstance"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorInstance_vendorId_name_key" ON "VendorInstance"("vendorId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Person_primaryEmail_key" ON "Person"("primaryEmail");

-- CreateIndex
CREATE INDEX "Person_employeeStatus_idx" ON "Person"("employeeStatus");

-- CreateIndex
CREATE INDEX "Person_fullName_idx" ON "Person"("fullName");

-- CreateIndex
CREATE INDEX "Person_mergedIntoId_idx" ON "Person"("mergedIntoId");

-- CreateIndex
CREATE INDEX "AccessRecord_personId_idx" ON "AccessRecord"("personId");

-- CreateIndex
CREATE INDEX "AccessRecord_vendorId_accountStatus_idx" ON "AccessRecord"("vendorId", "accountStatus");

-- CreateIndex
CREATE INDEX "AccessRecord_accountStatus_idx" ON "AccessRecord"("accountStatus");

-- CreateIndex
CREATE INDEX "AccessRecord_lastLogin_idx" ON "AccessRecord"("lastLogin");

-- CreateIndex
CREATE INDEX "AccessRecord_flags_idx" ON "AccessRecord"("flags");

-- CreateIndex
CREATE UNIQUE INDEX "AccessRecord_vendorId_instanceKey_matchKey_key" ON "AccessRecord"("vendorId", "instanceKey", "matchKey");

-- CreateIndex
CREATE INDEX "ColumnMapping_vendorId_idx" ON "ColumnMapping"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "ColumnMapping_vendorId_name_key" ON "ColumnMapping"("vendorId", "name");

-- CreateIndex
CREATE INDEX "ImportBatch_vendorId_status_idx" ON "ImportBatch"("vendorId", "status");

-- CreateIndex
CREATE INDEX "ImportBatch_importedAt_idx" ON "ImportBatch"("importedAt");

-- CreateIndex
CREATE INDEX "StagedRow_batchId_diff_idx" ON "StagedRow"("batchId", "diff");

-- CreateIndex
CREATE UNIQUE INDEX "StagedRow_batchId_rowNumber_key" ON "StagedRow"("batchId", "rowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DisappearedCandidate_batchId_accessRecordId_key" ON "DisappearedCandidate"("batchId", "accessRecordId");

-- CreateIndex
CREATE INDEX "ReviewCycle_status_idx" ON "ReviewCycle"("status");

-- CreateIndex
CREATE INDEX "ReviewItem_reviewerUserId_idx" ON "ReviewItem"("reviewerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewItem_cycleId_accessRecordId_key" ON "ReviewItem"("cycleId", "accessRecordId");

-- CreateIndex
CREATE INDEX "LeaverCase_personId_idx" ON "LeaverCase"("personId");

-- CreateIndex
CREATE INDEX "LeaverCase_status_idx" ON "LeaverCase"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LeaverAction_caseId_accessRecordId_key" ON "LeaverAction"("caseId", "accessRecordId");

-- CreateIndex
CREATE INDEX "EvidenceFile_leaverActionId_idx" ON "EvidenceFile"("leaverActionId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_changedAt_idx" ON "AuditEvent"("entityType", "entityId", "changedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_changedAt_idx" ON "AuditEvent"("changedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");

-- CreateIndex
CREATE INDEX "SavedView_entity_scope_idx" ON "SavedView"("entity", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "SavedView_ownerUserId_entity_name_key" ON "SavedView"("ownerUserId", "entity", "name");

-- AddForeignKey
ALTER TABLE "VendorGrant" ADD CONSTRAINT "VendorGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorGrant" ADD CONSTRAINT "VendorGrant_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorInstance" ADD CONSTRAINT "VendorInstance_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRecord" ADD CONSTRAINT "AccessRecord_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRecord" ADD CONSTRAINT "AccessRecord_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "VendorInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRecord" ADD CONSTRAINT "AccessRecord_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ColumnMapping" ADD CONSTRAINT "ColumnMapping_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "VendorInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "ColumnMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedRow" ADD CONSTRAINT "StagedRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedRow" ADD CONSTRAINT "StagedRow_matchedRecordId_fkey" FOREIGN KEY ("matchedRecordId") REFERENCES "AccessRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisappearedCandidate" ADD CONSTRAINT "DisappearedCandidate_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisappearedCandidate" ADD CONSTRAINT "DisappearedCandidate_accessRecordId_fkey" FOREIGN KEY ("accessRecordId") REFERENCES "AccessRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCycle" ADD CONSTRAINT "ReviewCycle_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ReviewCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_accessRecordId_fkey" FOREIGN KEY ("accessRecordId") REFERENCES "AccessRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaverCase" ADD CONSTRAINT "LeaverCase_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaverCase" ADD CONSTRAINT "LeaverCase_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaverAction" ADD CONSTRAINT "LeaverAction_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LeaverCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaverAction" ADD CONSTRAINT "LeaverAction_accessRecordId_fkey" FOREIGN KEY ("accessRecordId") REFERENCES "AccessRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaverAction" ADD CONSTRAINT "LeaverAction_actionedById_fkey" FOREIGN KEY ("actionedById") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceFile" ADD CONSTRAINT "EvidenceFile_leaverActionId_fkey" FOREIGN KEY ("leaverActionId") REFERENCES "LeaverAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
