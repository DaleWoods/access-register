-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationLog_entityType_kind_idx" ON "NotificationLog"("entityType", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_entityType_entityId_kind_key" ON "NotificationLog"("entityType", "entityId", "kind");
