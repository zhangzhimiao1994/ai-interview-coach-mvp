-- AddColumn
ALTER TABLE "AiServiceProvider"
ADD COLUMN "closeConfigVersion" INTEGER NOT NULL DEFAULT 0;

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
    "providerConfigVersion" INTEGER,
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

-- CreateIndex
CREATE UNIQUE INDEX "DigitalHumanSession_one_active_per_training_session"
ON "DigitalHumanSession"("trainingSessionId" ASC)
WHERE "status" IN ('CONNECTING', 'READY', 'SPEAKING', 'STOPPING', 'FAILED');

-- Guard close-critical provider changes while a cloud session may need closing.
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
) AND EXISTS (
    SELECT 1 FROM "DigitalHumanSession"
    WHERE "providerId" = OLD."id"
      AND "mode" = 'LINGMOU_CLOUD'
      AND "status" <> 'STOPPED'
)
BEGIN
    SELECT RAISE(ABORT, 'DIGITAL_HUMAN_PROVIDER_IN_USE');
END;

CREATE TRIGGER "DigitalHumanSession_provider_close_config_version"
AFTER UPDATE OF "providerType", "settingsJson", "credentialsCiphertext", "credentialsIv", "credentialsTag"
ON "AiServiceProvider"
FOR EACH ROW
WHEN (
    NEW."providerType" IS NOT OLD."providerType"
    OR NEW."settingsJson" IS NOT OLD."settingsJson"
    OR NEW."credentialsCiphertext" IS NOT OLD."credentialsCiphertext"
    OR NEW."credentialsIv" IS NOT OLD."credentialsIv"
    OR NEW."credentialsTag" IS NOT OLD."credentialsTag"
)
BEGIN
    UPDATE "AiServiceProvider"
    SET "closeConfigVersion" = OLD."closeConfigVersion" + 1
    WHERE "id" = NEW."id";
END;

CREATE TRIGGER "DigitalHumanSession_provider_close_config_delete_guard"
BEFORE DELETE ON "AiServiceProvider"
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM "DigitalHumanSession"
    WHERE "providerId" = OLD."id"
      AND "mode" = 'LINGMOU_CLOUD'
      AND "status" <> 'STOPPED'
)
BEGIN
    SELECT RAISE(ABORT, 'DIGITAL_HUMAN_PROVIDER_IN_USE');
END;

CREATE TRIGGER "DigitalHumanSession_close_config_claim_guard"
BEFORE INSERT ON "DigitalHumanSession"
FOR EACH ROW
WHEN NEW."mode" = 'LINGMOU_CLOUD' AND NOT EXISTS (
    SELECT 1 FROM "AiServiceProvider"
    WHERE "id" = NEW."providerId"
      AND "closeConfigVersion" = NEW."providerConfigVersion"
)
BEGIN
    SELECT RAISE(ABORT, 'DIGITAL_HUMAN_PROVIDER_CONFIG_STALE');
END;
