ALTER TABLE "TrainingSession" ADD COLUMN "outlineJson" TEXT;

ALTER TABLE "SessionTurn" ADD COLUMN "questionId" TEXT;

CREATE UNIQUE INDEX "SessionTurn_sessionId_questionId_key" ON "SessionTurn"("sessionId", "questionId");
