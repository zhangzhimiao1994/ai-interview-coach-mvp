-- CreateTable
CREATE TABLE "ProviderSessionCloseRecovery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "providerSessionId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "providerConfigVersion" INTEGER NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProviderSessionCloseRecovery_providerId_fkey"
      FOREIGN KEY ("providerId") REFERENCES "AiServiceProvider" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderSessionCloseRecovery_providerId_providerSessionId_instanceId_key"
ON "ProviderSessionCloseRecovery"("providerId", "providerSessionId", "instanceId");

CREATE INDEX "ProviderSessionCloseRecovery_nextAttemptAt_idx"
ON "ProviderSessionCloseRecovery"("nextAttemptAt");

CREATE INDEX "ProviderSessionCloseRecovery_providerId_idx"
ON "ProviderSessionCloseRecovery"("providerId");

-- Replace the published lifecycle guards with forward-compatible guards that
-- also protect durable pending-close work.
DROP TRIGGER "DigitalHumanSession_provider_close_config_update_guard";
DROP TRIGGER "DigitalHumanSession_provider_close_config_delete_guard";

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
