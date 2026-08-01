ALTER TABLE "DigitalHumanRenderJob" ADD COLUMN "audioAssetId" TEXT;

ALTER TABLE "DigitalHumanRenderAttempt" ADD COLUMN "interviewerProfileId" TEXT;
ALTER TABLE "DigitalHumanRenderAttempt" ADD COLUMN "portraitAssetId" TEXT;
ALTER TABLE "DigitalHumanRenderAttempt" ADD COLUMN "successObservedAt" DATETIME;
ALTER TABLE "DigitalHumanRenderAttempt" ADD COLUMN "claimOperation" TEXT;
ALTER TABLE "DigitalHumanRenderAttempt" ADD COLUMN "claimToken" TEXT;
ALTER TABLE "DigitalHumanRenderAttempt" ADD COLUMN "claimExpiresAt" DATETIME;

CREATE INDEX "DigitalHumanRenderAttempt_claimOperation_claimExpiresAt_idx"
ON "DigitalHumanRenderAttempt"("claimOperation", "claimExpiresAt");
