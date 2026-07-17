-- CreateTable
CREATE TABLE "DigitalHumanSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trainingSessionId" TEXT NOT NULL,
    "providerId" TEXT,
    "modelId" TEXT,
    "adapter" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "providerSessionId" TEXT,
    "instanceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONNECTING',
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "stopReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("trainingSessionId") REFERENCES "TrainingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DigitalHumanSession_trainingSessionId_idx" ON "DigitalHumanSession"("trainingSessionId" ASC);

-- CreateIndex
CREATE INDEX "DigitalHumanSession_status_lastActivityAt_idx" ON "DigitalHumanSession"("status" ASC, "lastActivityAt" ASC);

-- CreateIndex
CREATE INDEX "DigitalHumanSession_providerSessionId_idx" ON "DigitalHumanSession"("providerSessionId" ASC);
