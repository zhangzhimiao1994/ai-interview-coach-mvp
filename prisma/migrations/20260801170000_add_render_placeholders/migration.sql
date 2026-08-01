CREATE TABLE "DigitalHumanRenderPlaceholder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trainingSessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionHash" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "behaviorSignalsJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "renderJobId" TEXT,
    "audioAssetId" TEXT,
    "runtimeSettingsJson" TEXT,
    "renderCreatedAt" DATETIME,
    "deadlineAt" DATETIME,
    "claimToken" TEXT,
    "claimExpiresAt" DATETIME,
    "fallbackReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DigitalHumanRenderPlaceholder_trainingSessionId_fkey" FOREIGN KEY ("trainingSessionId") REFERENCES "TrainingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DigitalHumanRenderPlaceholder_renderJobId_fkey" FOREIGN KEY ("renderJobId") REFERENCES "DigitalHumanRenderJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DigitalHumanRenderPlaceholder_audioAssetId_fkey" FOREIGN KEY ("audioAssetId") REFERENCES "DigitalHumanMediaAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DigitalHumanRenderPlaceholder_renderJobId_key" ON "DigitalHumanRenderPlaceholder"("renderJobId");
CREATE UNIQUE INDEX "DigitalHumanRenderPlaceholder_trainingSessionId_questionId_cacheKey_key" ON "DigitalHumanRenderPlaceholder"("trainingSessionId", "questionId", "cacheKey");
CREATE INDEX "DigitalHumanRenderPlaceholder_trainingSessionId_status_idx" ON "DigitalHumanRenderPlaceholder"("trainingSessionId", "status");
CREATE INDEX "DigitalHumanRenderPlaceholder_claimExpiresAt_idx" ON "DigitalHumanRenderPlaceholder"("claimExpiresAt");
CREATE INDEX "DigitalHumanRenderPlaceholder_audioAssetId_idx" ON "DigitalHumanRenderPlaceholder"("audioAssetId");
