PRAGMA foreign_keys=OFF;

ALTER TABLE "DigitalHumanRenderAttempt" RENAME TO "_OldDigitalHumanRenderAttempt";
ALTER TABLE "DigitalHumanRenderJob" RENAME TO "_OldDigitalHumanRenderJob";

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
    "audioAssetId" TEXT,
    "planFingerprint" TEXT NOT NULL DEFAULT '',
    "deadlineAt" DATETIME NOT NULL,
    "winnerAttemptId" TEXT,
    "fallbackReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" DATETIME,
    "expiredAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("trainingSessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("interviewerProfileId") REFERENCES "InterviewerAvatarProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("audioAssetId") REFERENCES "DigitalHumanMediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "DigitalHumanRenderAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "renderJobId" TEXT NOT NULL,
    "providerKind" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "interviewerName" TEXT NOT NULL,
    "interviewerProfileId" TEXT,
    "portraitAssetId" TEXT,
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
    "failureKind" TEXT,
    "queryAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "cacheAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "successObservedAt" DATETIME,
    "claimOperation" TEXT,
    "claimToken" TEXT,
    "claimExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("renderJobId") REFERENCES "DigitalHumanRenderJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("interviewerProfileId") REFERENCES "InterviewerAvatarProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("portraitAssetId") REFERENCES "DigitalHumanMediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("outputAssetId") REFERENCES "DigitalHumanMediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "DigitalHumanRenderJob" SELECT
    "id", "trainingSessionId", "questionId", "questionHash", "cacheKey", "kind", "mode", "status",
    "interviewerProfileId", "audioAssetId", '', "deadlineAt", "winnerAttemptId", "fallbackReason", "createdAt",
    "readyAt", "expiredAt", "updatedAt"
FROM "_OldDigitalHumanRenderJob";

INSERT INTO "DigitalHumanRenderAttempt" (
    "id", "renderJobId", "providerKind", "providerId", "modelId", "interviewerName", "interviewerProfileId",
    "portraitAssetId", "status", "upstreamTaskId", "traceId", "nextPollAt", "submittedAt", "firstQueriedAt",
    "completedAt", "outputAssetId", "outputUrlCiphertext", "outputUrlIv", "outputUrlTag", "safeErrorCode",
    "successObservedAt", "claimOperation", "claimToken", "claimExpiresAt", "createdAt", "updatedAt"
)
SELECT
    "id", "renderJobId", "providerKind", "providerId", "modelId", "interviewerName", "interviewerProfileId",
    "portraitAssetId", "status", "upstreamTaskId", "traceId", "nextPollAt", "submittedAt", "firstQueriedAt",
    "completedAt", "outputAssetId", "outputUrlCiphertext", "outputUrlIv", "outputUrlTag", "safeErrorCode",
    "successObservedAt", "claimOperation", "claimToken", "claimExpiresAt", "createdAt", "updatedAt"
FROM "_OldDigitalHumanRenderAttempt";

DROP TABLE "_OldDigitalHumanRenderAttempt";
DROP TABLE "_OldDigitalHumanRenderJob";

CREATE UNIQUE INDEX "DigitalHumanRenderJob_trainingSessionId_questionId_cacheKey_key" ON "DigitalHumanRenderJob"("trainingSessionId", "questionId", "cacheKey");
CREATE INDEX "DigitalHumanRenderJob_status_deadlineAt_idx" ON "DigitalHumanRenderJob"("status", "deadlineAt");
CREATE UNIQUE INDEX "DigitalHumanRenderAttempt_renderJobId_providerKind_key" ON "DigitalHumanRenderAttempt"("renderJobId", "providerKind");
CREATE INDEX "DigitalHumanRenderAttempt_status_nextPollAt_idx" ON "DigitalHumanRenderAttempt"("status", "nextPollAt");
CREATE INDEX "DigitalHumanRenderAttempt_claimOperation_claimExpiresAt_idx" ON "DigitalHumanRenderAttempt"("claimOperation", "claimExpiresAt");

PRAGMA foreign_keys=ON;
