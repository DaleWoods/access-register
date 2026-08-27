-- CreateTable
CREATE TABLE "RegisterSnapshot" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "activeAccounts" INTEGER NOT NULL,
    "removedAccounts" INTEGER NOT NULL,
    "flaggedAccounts" INTEGER NOT NULL,
    "dormant" INTEGER NOT NULL,
    "unverifiable" INTEGER NOT NULL,
    "unmatched" INTEGER NOT NULL,
    "neverReviewed" INTEGER NOT NULL,
    "reviewOverdue" INTEGER NOT NULL,
    "expiringSoon" INTEGER NOT NULL,
    "expired" INTEGER NOT NULL,
    "leaverAccounts" INTEGER NOT NULL,
    "leaverPeople" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegisterSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegisterSnapshot_day_key" ON "RegisterSnapshot"("day");
