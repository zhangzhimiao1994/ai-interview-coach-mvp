ALTER TABLE "DigitalHumanMediaAsset" ADD COLUMN "cleanupClaimToken" TEXT;
ALTER TABLE "DigitalHumanMediaAsset" ADD COLUMN "cleanupClaimedAt" DATETIME;
ALTER TABLE "DigitalHumanMediaAsset" ADD COLUMN "cleanupClaimExpiresAt" DATETIME;

CREATE INDEX "DigitalHumanMediaAsset_cleanupStatus_cleanupClaimExpiresAt_idx"
ON "DigitalHumanMediaAsset"("cleanupStatus", "cleanupClaimExpiresAt");
