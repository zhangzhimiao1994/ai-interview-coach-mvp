-- Preserve the newest active storage row for each provider before enforcing the invariant.
UPDATE "MediaStorageConfig" AS "candidate"
SET "enabled" = 0
WHERE "candidate"."enabled" = 1
  AND EXISTS (
    SELECT 1
    FROM "MediaStorageConfig" AS "newer"
    WHERE "newer"."providerKind" = "candidate"."providerKind"
      AND "newer"."enabled" = 1
      AND (
        "newer"."updatedAt" > "candidate"."updatedAt"
        OR ("newer"."updatedAt" = "candidate"."updatedAt" AND "newer"."id" > "candidate"."id")
      )
  );

CREATE UNIQUE INDEX "MediaStorageConfig_one_enabled_per_provider_idx"
ON "MediaStorageConfig"("providerKind")
WHERE "enabled" = 1;

-- ACTIVE rows never carry cleanup ownership; only CLEANING rows may have a lease.
UPDATE "DigitalHumanMediaAsset"
SET "cleanupClaimToken" = NULL,
    "cleanupClaimedAt" = NULL,
    "cleanupClaimExpiresAt" = NULL
WHERE "cleanupStatus" = 'ACTIVE';
