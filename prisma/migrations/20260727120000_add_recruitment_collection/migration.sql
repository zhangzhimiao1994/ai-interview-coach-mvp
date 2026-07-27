ALTER TABLE "TrainingTask" ADD COLUMN "jobPostingId" TEXT;

CREATE TABLE "RecruitmentSource" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "credentialCiphertext" TEXT,
  "credentialIv" TEXT,
  "credentialTag" TEXT,
  "credentialPreview" TEXT,
  "sessionCiphertext" TEXT,
  "sessionIv" TEXT,
  "sessionTag" TEXT,
  "sessionPreview" TEXT,
  "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "lastVerifiedAt" DATETIME,
  "lastSuccessfulSyncAt" DATETIME,
  "settingsJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "RecruitmentSearchTemplate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "keywords" TEXT NOT NULL,
  "roleType" TEXT,
  "city" TEXT,
  "country" TEXT,
  "experienceRange" TEXT,
  "salaryRange" TEXT,
  "language" TEXT,
  "remoteMode" TEXT,
  "sourceIdsJson" TEXT NOT NULL DEFAULT '[]',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "RecruitmentTemplateCandidate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "templateId" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecruitmentTemplateCandidate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RecruitmentSearchTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecruitmentTemplateCandidate_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "RecruitmentSyncSchedule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "templateId" TEXT NOT NULL,
  "frequency" TEXT NOT NULL,
  "nextRunAt" DATETIME NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lockExpiresAt" DATETIME,
  "lastRunAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RecruitmentSyncSchedule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RecruitmentSearchTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "RecruitmentSyncRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceId" TEXT,
  "templateId" TEXT,
  "mode" TEXT NOT NULL DEFAULT 'MANUAL',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "insertedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "failureReason" TEXT,
  "logsJson" TEXT NOT NULL DEFAULT '[]',
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecruitmentSyncRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RecruitmentSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "RecruitmentSyncRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RecruitmentSearchTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "RecruitmentJobPosting" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceId" TEXT,
  "provider" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "company" TEXT,
  "location" TEXT,
  "salary" TEXT,
  "description" TEXT NOT NULL,
  "requirementsJson" TEXT NOT NULL DEFAULT '[]',
  "sourceUrl" TEXT,
  "externalJobId" TEXT,
  "publishedAt" DATETIME,
  "rawJson" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "editedNotes" TEXT,
  "manualImport" BOOLEAN NOT NULL DEFAULT false,
  "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RecruitmentJobPosting_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RecruitmentSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "TrainingTask_jobPostingId_idx" ON "TrainingTask"("jobPostingId");
CREATE INDEX "RecruitmentSource_provider_idx" ON "RecruitmentSource"("provider");
CREATE INDEX "RecruitmentSource_sourceType_idx" ON "RecruitmentSource"("sourceType");
CREATE INDEX "RecruitmentSource_enabled_idx" ON "RecruitmentSource"("enabled");
CREATE UNIQUE INDEX "RecruitmentSource_provider_displayName_key" ON "RecruitmentSource"("provider", "displayName");
CREATE INDEX "RecruitmentSearchTemplate_enabled_idx" ON "RecruitmentSearchTemplate"("enabled");
CREATE INDEX "RecruitmentSearchTemplate_country_idx" ON "RecruitmentSearchTemplate"("country");
CREATE INDEX "RecruitmentSearchTemplate_city_idx" ON "RecruitmentSearchTemplate"("city");
CREATE UNIQUE INDEX "RecruitmentTemplateCandidate_templateId_candidateId_key" ON "RecruitmentTemplateCandidate"("templateId", "candidateId");
CREATE INDEX "RecruitmentTemplateCandidate_candidateId_idx" ON "RecruitmentTemplateCandidate"("candidateId");
CREATE INDEX "RecruitmentSyncSchedule_enabled_nextRunAt_idx" ON "RecruitmentSyncSchedule"("enabled", "nextRunAt");
CREATE INDEX "RecruitmentSyncSchedule_templateId_idx" ON "RecruitmentSyncSchedule"("templateId");
CREATE INDEX "RecruitmentSyncRun_sourceId_idx" ON "RecruitmentSyncRun"("sourceId");
CREATE INDEX "RecruitmentSyncRun_templateId_idx" ON "RecruitmentSyncRun"("templateId");
CREATE INDEX "RecruitmentSyncRun_status_idx" ON "RecruitmentSyncRun"("status");
CREATE INDEX "RecruitmentSyncRun_startedAt_idx" ON "RecruitmentSyncRun"("startedAt");
CREATE UNIQUE INDEX "RecruitmentJobPosting_dedupeKey_key" ON "RecruitmentJobPosting"("dedupeKey");
CREATE UNIQUE INDEX "RecruitmentJobPosting_provider_externalJobId_key" ON "RecruitmentJobPosting"("provider", "externalJobId");
CREATE INDEX "RecruitmentJobPosting_sourceId_idx" ON "RecruitmentJobPosting"("sourceId");
CREATE INDEX "RecruitmentJobPosting_provider_idx" ON "RecruitmentJobPosting"("provider");
CREATE INDEX "RecruitmentJobPosting_sourceType_idx" ON "RecruitmentJobPosting"("sourceType");
CREATE INDEX "RecruitmentJobPosting_status_idx" ON "RecruitmentJobPosting"("status");
CREATE INDEX "RecruitmentJobPosting_company_idx" ON "RecruitmentJobPosting"("company");
CREATE INDEX "RecruitmentJobPosting_lastSeenAt_idx" ON "RecruitmentJobPosting"("lastSeenAt");
