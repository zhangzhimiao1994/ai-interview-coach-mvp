ALTER TABLE "AiServiceProvider" ADD COLUMN "credentialsCiphertext" TEXT;
ALTER TABLE "AiServiceProvider" ADD COLUMN "credentialsIv" TEXT;
ALTER TABLE "AiServiceProvider" ADD COLUMN "credentialsTag" TEXT;
ALTER TABLE "AiServiceProvider" ADD COLUMN "credentialsPreviewJson" TEXT;
ALTER TABLE "AiServiceProvider" ADD COLUMN "settingsJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "AiModelConfig" ADD COLUMN "settingsJson" TEXT NOT NULL DEFAULT '{}';
