-- CreateTable
CREATE TABLE "AiCallLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT,
    "sessionId" TEXT,
    "reportId" TEXT,
    "capability" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "costEstimate" REAL NOT NULL,
    "success" BOOLEAN NOT NULL,
    "failureReason" TEXT,
    "fallbackProvider" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("reportId") REFERENCES "CoachingReport" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("sessionId") REFERENCES "TrainingSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("taskId") REFERENCES "TrainingTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiModelConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "temperature" REAL NOT NULL DEFAULT 0.4,
    "maxTokens" INTEGER NOT NULL DEFAULT 1200,
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "costNote" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("providerId") REFERENCES "AiServiceProvider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiServiceProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKeyCiphertext" TEXT,
    "apiKeyIv" TEXT,
    "apiKeyTag" TEXT,
    "apiKeyPreview" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "targetCompany" TEXT,
    "targetRole" TEXT,
    "serviceStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "weakTags" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CoachingReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "subScores" TEXT NOT NULL,
    "perQuestionFeedback" TEXT NOT NULL,
    "expressionAnalysis" TEXT NOT NULL,
    "answerQualityAnalysis" TEXT NOT NULL,
    "strategySuggestions" TEXT NOT NULL,
    "weakTags" TEXT NOT NULL,
    "nextTrainingPlan" TEXT NOT NULL,
    "candidateSummary" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("sessionId") REFERENCES "TrainingSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompanyTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "interviewStyle" TEXT NOT NULL,
    "competencyModel" TEXT NOT NULL,
    "commonQuestions" TEXT NOT NULL,
    "scoringStandard" TEXT NOT NULL,
    "restrictedTopics" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "InterviewerTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "followUpDepth" INTEGER NOT NULL,
    "interruptFrequency" INTEGER NOT NULL,
    "challengeIntensity" INTEGER NOT NULL,
    "languageMode" TEXT NOT NULL,
    "safetyBoundary" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "JobTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "competencyModel" TEXT NOT NULL,
    "commonQuestions" TEXT NOT NULL,
    "riskQuestions" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MaterialAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionTurn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "feedback" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("sessionId") REFERENCES "TrainingSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainingSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "currentStage" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("taskId") REFERENCES "TrainingTask" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainingTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "companyTemplateId" TEXT,
    "jobTemplateId" TEXT,
    "interviewerTemplateId" TEXT,
    "title" TEXT NOT NULL,
    "targetCompany" TEXT NOT NULL,
    "targetRole" TEXT NOT NULL,
    "stageConfig" TEXT NOT NULL,
    "expectedMinutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("interviewerTemplateId") REFERENCES "InterviewerTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("jobTemplateId") REFERENCES "JobTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("companyTemplateId") REFERENCES "CompanyTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AiCallLog_reportId_idx" ON "AiCallLog"("reportId" ASC);
CREATE INDEX "AiCallLog_sessionId_idx" ON "AiCallLog"("sessionId" ASC);
CREATE INDEX "AiCallLog_taskId_idx" ON "AiCallLog"("taskId" ASC);
CREATE INDEX "AiModelConfig_isDefault_idx" ON "AiModelConfig"("isDefault" ASC);
CREATE INDEX "AiModelConfig_enabled_idx" ON "AiModelConfig"("enabled" ASC);
CREATE INDEX "AiModelConfig_capability_idx" ON "AiModelConfig"("capability" ASC);
CREATE INDEX "AiModelConfig_providerId_idx" ON "AiModelConfig"("providerId" ASC);
CREATE INDEX "AiServiceProvider_enabled_idx" ON "AiServiceProvider"("enabled" ASC);
CREATE INDEX "AiServiceProvider_providerType_idx" ON "AiServiceProvider"("providerType" ASC);
CREATE UNIQUE INDEX "CoachingReport_sessionId_key" ON "CoachingReport"("sessionId" ASC);
CREATE UNIQUE INDEX "InterviewerTemplate_type_key" ON "InterviewerTemplate"("type" ASC);
CREATE INDEX "MaterialAsset_candidateId_idx" ON "MaterialAsset"("candidateId" ASC);
CREATE INDEX "SessionTurn_sessionId_idx" ON "SessionTurn"("sessionId" ASC);
CREATE INDEX "TrainingSession_candidateId_idx" ON "TrainingSession"("candidateId" ASC);
CREATE INDEX "TrainingSession_taskId_idx" ON "TrainingSession"("taskId" ASC);
CREATE INDEX "TrainingTask_interviewerTemplateId_idx" ON "TrainingTask"("interviewerTemplateId" ASC);
CREATE INDEX "TrainingTask_jobTemplateId_idx" ON "TrainingTask"("jobTemplateId" ASC);
CREATE INDEX "TrainingTask_companyTemplateId_idx" ON "TrainingTask"("companyTemplateId" ASC);
CREATE INDEX "TrainingTask_candidateId_idx" ON "TrainingTask"("candidateId" ASC);
