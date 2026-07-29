-- CreateTable
CREATE TABLE "MediaStorageConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "providerKind" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "region" TEXT,
    "credentialsCiphertext" TEXT,
    "credentialsIv" TEXT,
    "credentialsTag" TEXT,
    "credentialsPreviewJson" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DigitalHumanMediaAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storageConfigId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "cleanupStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "cleanedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("storageConfigId") REFERENCES "MediaStorageConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InterviewerAvatarProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "voice" TEXT NOT NULL,
    "styleJson" TEXT NOT NULL DEFAULT '{}',
    "portraitAssetId" TEXT,
    "lingmouMappingJson" TEXT NOT NULL DEFAULT '{}',
    "emoMappingJson" TEXT NOT NULL DEFAULT '{}',
    "providerRole" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("portraitAssetId") REFERENCES "DigitalHumanMediaAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DigitalHumanRenderJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trainingSessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionHash" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "interviewerProfileId" TEXT NOT NULL,
    "deadlineAt" DATETIME NOT NULL,
    "winnerAttemptId" TEXT,
    "fallbackReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" DATETIME,
    "expiredAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("trainingSessionId") REFERENCES "TrainingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("interviewerProfileId") REFERENCES "InterviewerAvatarProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DigitalHumanRenderAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "renderJobId" TEXT NOT NULL,
    "providerKind" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "interviewerName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "upstreamTaskId" TEXT,
    "traceId" TEXT,
    "nextPollAt" DATETIME,
    "submittedAt" DATETIME,
    "firstQueriedAt" DATETIME,
    "completedAt" DATETIME,
    "outputAssetId" TEXT,
    "outputUrlCiphertext" TEXT,
    "outputUrlIv" TEXT,
    "outputUrlTag" TEXT,
    "safeErrorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("renderJobId") REFERENCES "DigitalHumanRenderJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("outputAssetId") REFERENCES "DigitalHumanMediaAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaStorageConfig_providerKind_displayName_key" ON "MediaStorageConfig"("providerKind", "displayName");

-- CreateIndex
CREATE INDEX "MediaStorageConfig_enabled_idx" ON "MediaStorageConfig"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "DigitalHumanMediaAsset_objectKey_key" ON "DigitalHumanMediaAsset"("objectKey");

-- CreateIndex
CREATE INDEX "DigitalHumanMediaAsset_storageConfigId_idx" ON "DigitalHumanMediaAsset"("storageConfigId");

-- CreateIndex
CREATE INDEX "DigitalHumanMediaAsset_cleanupStatus_expiresAt_idx" ON "DigitalHumanMediaAsset"("cleanupStatus", "expiresAt");

-- CreateIndex
CREATE INDEX "InterviewerAvatarProfile_enabled_idx" ON "InterviewerAvatarProfile"("enabled");

-- CreateIndex
CREATE INDEX "InterviewerAvatarProfile_providerRole_idx" ON "InterviewerAvatarProfile"("providerRole");

-- CreateIndex
CREATE UNIQUE INDEX "DigitalHumanRenderJob_trainingSessionId_questionId_cacheKey_key" ON "DigitalHumanRenderJob"("trainingSessionId", "questionId", "cacheKey");

-- CreateIndex
CREATE INDEX "DigitalHumanRenderJob_status_deadlineAt_idx" ON "DigitalHumanRenderJob"("status", "deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "DigitalHumanRenderAttempt_renderJobId_providerKind_key" ON "DigitalHumanRenderAttempt"("renderJobId", "providerKind");

-- CreateIndex
CREATE INDEX "DigitalHumanRenderAttempt_status_nextPollAt_idx" ON "DigitalHumanRenderAttempt"("status", "nextPollAt");

-- Preserve historical sessions and logs while retiring the legacy DUIX integration.
UPDATE "AiServiceProvider" SET "enabled" = 0 WHERE "providerType" = 'DUIX';

UPDATE "AiModelConfig" SET "enabled" = 0, "isDefault" = 0, "isSelected" = 0
WHERE "providerId" IN (
    SELECT "id" FROM "AiServiceProvider" WHERE "providerType" = 'DUIX'
);
