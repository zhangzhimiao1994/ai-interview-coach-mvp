-- Upgrade the original durable recovery queue without changing its checksum.
-- SQLite requires a table rebuild to make providerSessionId nullable and add
-- the linked lifecycle and bounded diagnostic-claim lease columns.
PRAGMA foreign_keys=OFF;

DROP TRIGGER "DigitalHumanSession_provider_close_config_update_guard";
DROP TRIGGER "DigitalHumanSession_provider_close_config_delete_guard";

CREATE TABLE "new_ProviderSessionCloseRecovery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "digitalHumanSessionId" TEXT,
    "providerSessionId" TEXT,
    "instanceId" TEXT NOT NULL,
    "providerConfigVersion" INTEGER NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimExpiresAt" DATETIME,
    "lastErrorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProviderSessionCloseRecovery_providerId_fkey"
      FOREIGN KEY ("providerId") REFERENCES "AiServiceProvider" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProviderSessionCloseRecovery_digitalHumanSessionId_fkey"
      FOREIGN KEY ("digitalHumanSessionId") REFERENCES "DigitalHumanSession" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_ProviderSessionCloseRecovery" (
    "id",
    "providerId",
    "digitalHumanSessionId",
    "providerSessionId",
    "instanceId",
    "providerConfigVersion",
    "reasonCode",
    "attemptCount",
    "nextAttemptAt",
    "claimExpiresAt",
    "lastErrorCode",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "providerId",
    NULL,
    "providerSessionId",
    "instanceId",
    "providerConfigVersion",
    "reasonCode",
    "attemptCount",
    "nextAttemptAt",
    NULL,
    "lastErrorCode",
    "createdAt",
    "updatedAt"
FROM "ProviderSessionCloseRecovery";

DROP TABLE "ProviderSessionCloseRecovery";
ALTER TABLE "new_ProviderSessionCloseRecovery"
RENAME TO "ProviderSessionCloseRecovery";

CREATE UNIQUE INDEX "ProviderSessionCloseRecovery_providerId_providerSessionId_instanceId_key"
ON "ProviderSessionCloseRecovery"("providerId", "providerSessionId", "instanceId");

CREATE INDEX "ProviderSessionCloseRecovery_nextAttemptAt_idx"
ON "ProviderSessionCloseRecovery"("nextAttemptAt");

CREATE INDEX "ProviderSessionCloseRecovery_providerId_idx"
ON "ProviderSessionCloseRecovery"("providerId");

CREATE UNIQUE INDEX "ProviderSessionCloseRecovery_digitalHumanSessionId_key"
ON "ProviderSessionCloseRecovery"("digitalHumanSessionId");

-- Reject a live-operation claim made from a stale resolved provider config.
CREATE TRIGGER "ProviderSessionCloseRecovery_config_version_insert_guard"
BEFORE INSERT ON "ProviderSessionCloseRecovery"
FOR EACH ROW
WHEN NOT EXISTS (
    SELECT 1 FROM "AiServiceProvider"
    WHERE "id" = NEW."providerId"
      AND "closeConfigVersion" = NEW."providerConfigVersion"
)
BEGIN
    SELECT RAISE(ABORT, 'DIGITAL_HUMAN_PROVIDER_CONFIG_STALE');
END;

CREATE TRIGGER "DigitalHumanSession_provider_close_config_update_guard"
BEFORE UPDATE OF "providerType", "settingsJson", "credentialsCiphertext", "credentialsIv", "credentialsTag"
ON "AiServiceProvider"
FOR EACH ROW
WHEN (
    NEW."providerType" IS NOT OLD."providerType"
    OR NEW."settingsJson" IS NOT OLD."settingsJson"
    OR NEW."credentialsCiphertext" IS NOT OLD."credentialsCiphertext"
    OR NEW."credentialsIv" IS NOT OLD."credentialsIv"
    OR NEW."credentialsTag" IS NOT OLD."credentialsTag"
) AND (
    EXISTS (
        SELECT 1 FROM "DigitalHumanSession"
        WHERE "providerId" = OLD."id"
          AND "mode" = 'LINGMOU_CLOUD'
          AND "status" <> 'STOPPED'
    ) OR EXISTS (
        SELECT 1 FROM "ProviderSessionCloseRecovery"
        WHERE "providerId" = OLD."id"
    )
)
BEGIN
    SELECT RAISE(ABORT, 'DIGITAL_HUMAN_PROVIDER_IN_USE');
END;

CREATE TRIGGER "DigitalHumanSession_provider_close_config_delete_guard"
BEFORE DELETE ON "AiServiceProvider"
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM "DigitalHumanSession"
    WHERE "providerId" = OLD."id"
      AND "mode" = 'LINGMOU_CLOUD'
      AND "status" <> 'STOPPED'
) OR EXISTS (
    SELECT 1 FROM "ProviderSessionCloseRecovery"
    WHERE "providerId" = OLD."id"
)
BEGIN
    SELECT RAISE(ABORT, 'DIGITAL_HUMAN_PROVIDER_IN_USE');
END;

PRAGMA foreign_keys=ON;
