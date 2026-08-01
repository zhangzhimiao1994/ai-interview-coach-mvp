CREATE TABLE "DigitalHumanVideoDiagnosticAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT NOT NULL,
    "providerKind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "safeCode" TEXT NOT NULL,
    "traceId" TEXT,
    "checkedAt" DATETIME NOT NULL,
    "billingOperationsJson" TEXT NOT NULL,
    "costSemantics" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "DigitalHumanVideoDiagnosticAudit_actorId_checkedAt_idx"
ON "DigitalHumanVideoDiagnosticAudit"("actorId", "checkedAt");

CREATE INDEX "DigitalHumanVideoDiagnosticAudit_providerKind_checkedAt_idx"
ON "DigitalHumanVideoDiagnosticAudit"("providerKind", "checkedAt");

CREATE INDEX "DigitalHumanVideoDiagnosticAudit_status_checkedAt_idx"
ON "DigitalHumanVideoDiagnosticAudit"("status", "checkedAt");
