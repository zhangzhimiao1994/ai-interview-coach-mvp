import { classifyRecruitmentFailure, createRecruitmentConnectorRegistry, redactRecruitmentLog, type ConnectorSearchTemplate, type ConnectorSource, type RecruitmentConnector } from "@/lib/recruitment/connectors/base";
import { normalizeConnectorPostingInput } from "@/lib/recruitment/postings";
import type { NormalizedRecruitmentPostingInput, RecruitmentRunStatus } from "@/lib/recruitment/types";

export type RecruitmentSyncRunRecord = {
  id: string;
  sourceId: string | null;
  templateId: string | null;
  mode: string;
  status: string;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  failureReason: string | null;
  logsJson: string;
  startedAt: Date;
  finishedAt: Date | null;
  createdAt: Date;
};

type RecruitmentSyncPrisma = {
  recruitmentSearchTemplate: {
    findUnique(args: unknown): Promise<(ConnectorSearchTemplate & {
      name?: string;
      sourceIdsJson: string;
      enabled: boolean;
    }) | null>;
  };
  recruitmentSource: {
    findMany(args: unknown): Promise<ConnectorSource[]>;
  };
  recruitmentJobPosting: {
    findUnique(args: { where: { dedupeKey: string } }): Promise<unknown | null>;
    upsert(args: unknown): Promise<unknown>;
  };
  recruitmentSyncRun: {
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<RecruitmentSyncRunRecord>;
  };
};

type RecruitmentConnectorRegistry = {
  get(provider: string): RecruitmentConnector;
};

export type RunRecruitmentSyncOptions = {
  prisma: RecruitmentSyncPrisma;
  connectorRegistry?: RecruitmentConnectorRegistry;
  templateId: string;
  sourceIds?: string[];
  mode?: "MANUAL";
  now?: () => Date;
};

export type RunRecruitmentSyncResult = {
  runId: string;
  status: RecruitmentRunStatus;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  logs: unknown[];
};

function parseSourceIds(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function safeErrorStatus(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : undefined;
}

function safeErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/[A-Za-z0-9+/=_-]{16,}/g, "[REDACTED]");
}

function combineStatus(current: RecruitmentRunStatus, next: RecruitmentRunStatus) {
  if (current === "SUCCESS" && next === "SUCCESS") return "SUCCESS";
  if (current === "SUCCESS") return "PARTIAL";
  if (current === next) return current;
  if (current === "PENDING") return next;
  return "PARTIAL";
}

function toRunStatus(status: RecruitmentRunStatus) {
  return status === "PENDING" ? "SUCCESS" : status;
}

function toStoredPosting(source: ConnectorSource, input: NormalizedRecruitmentPostingInput, now: Date) {
  const normalized = normalizeConnectorPostingInput(input);
  const rawJson = normalized.rawJson === undefined ? null : JSON.stringify(normalized.rawJson);

  return {
    sourceId: source.id,
    provider: normalized.provider,
    sourceType: normalized.sourceType,
    title: normalized.title,
    company: normalized.company,
    location: normalized.location,
    salary: normalized.salary,
    description: normalized.description,
    requirementsJson: JSON.stringify(normalized.requirements),
    sourceUrl: normalized.sourceUrl,
    externalJobId: normalized.externalJobId,
    publishedAt: normalized.publishedAt,
    rawJson,
    dedupeKey: normalized.dedupeKey,
    status: "ACTIVE",
    editedNotes: null,
    manualImport: false,
    firstSeenAt: now,
    lastSeenAt: now
  };
}

function serializeLog(log: unknown) {
  return redactRecruitmentLog(log);
}

export function parseRecruitmentSyncLogs(logsJson: string) {
  try {
    const parsed = JSON.parse(logsJson) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => serializeLog(item)) : [];
  } catch {
    return [];
  }
}

function iso(value?: Date | null) {
  return value ? value.toISOString() : null;
}

export function serializeRecruitmentSyncRun(run: RecruitmentSyncRunRecord) {
  return {
    id: run.id,
    sourceId: run.sourceId,
    templateId: run.templateId,
    mode: run.mode,
    status: run.status,
    insertedCount: run.insertedCount,
    updatedCount: run.updatedCount,
    skippedCount: run.skippedCount,
    failureReason: run.failureReason,
    logs: parseRecruitmentSyncLogs(run.logsJson),
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
    createdAt: iso(run.createdAt)
  };
}

export async function runRecruitmentSync(options: RunRecruitmentSyncOptions): Promise<RunRecruitmentSyncResult> {
  const now = options.now || (() => new Date());
  const registry = options.connectorRegistry || createRecruitmentConnectorRegistry();
  const startedAt = now();
  const template = await options.prisma.recruitmentSearchTemplate.findUnique({
    where: { id: options.templateId }
  });

  if (!template || !template.enabled) {
    throw new Error("RECRUITMENT_TEMPLATE_NOT_AVAILABLE");
  }

  const selectedSourceIds = options.sourceIds?.length ? options.sourceIds : parseSourceIds(template.sourceIdsJson);
  const sources = await options.prisma.recruitmentSource.findMany({
    where: {
      enabled: true,
      ...(selectedSourceIds.length ? { id: { in: selectedSourceIds } } : {})
    },
    orderBy: { createdAt: "desc" }
  });
  const run = await options.prisma.recruitmentSyncRun.create({
    data: {
      sourceId: sources.length === 1 ? sources[0].id : null,
      templateId: template.id,
      mode: options.mode || "MANUAL",
      status: "RUNNING",
      insertedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failureReason: null,
      logsJson: "[]",
      startedAt
    }
  });

  let status: RecruitmentRunStatus = "PENDING";
  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const logs: unknown[] = [];

  for (const source of sources) {
    try {
      const connector = registry.get(source.provider);
      const result = await connector.search(source, template);

      for (const posting of result.postings) {
        const data = toStoredPosting(source, posting, now());
        const existing = await options.prisma.recruitmentJobPosting.findUnique({
          where: { dedupeKey: data.dedupeKey }
        });

        await options.prisma.recruitmentJobPosting.upsert({
          where: { dedupeKey: data.dedupeKey },
          create: data,
          update: {
            ...data,
            firstSeenAt: undefined,
            manualImport: undefined
          }
        });

        if (existing) {
          updatedCount += 1;
        } else {
          insertedCount += 1;
        }
      }

      status = combineStatus(status, "SUCCESS");
      logs.push(serializeLog({
        provider: source.provider,
        sourceId: source.id,
        status: "SUCCESS",
        count: result.postings.length
      }));
    } catch (error) {
      const classified = classifyRecruitmentFailure({
        status: safeErrorStatus(error),
        message: safeErrorMessage(error)
      });
      status = combineStatus(status, classified);
      skippedCount += 1;
      logs.push(serializeLog({
        provider: source.provider,
        sourceId: source.id,
        status: classified,
        message: safeErrorMessage(error)
      }));
    }
  }

  const finishedStatus = sources.length ? toRunStatus(status) : "FAILED";
  const saved = await options.prisma.recruitmentSyncRun.update({
    where: { id: run.id },
    data: {
      status: finishedStatus,
      insertedCount,
      updatedCount,
      skippedCount,
      failureReason: finishedStatus === "SUCCESS" ? null : finishedStatus,
      logsJson: JSON.stringify(logs),
      finishedAt: now()
    }
  });

  return {
    runId: saved.id,
    status: saved.status as RecruitmentRunStatus,
    insertedCount: saved.insertedCount,
    updatedCount: saved.updatedCount,
    skippedCount: saved.skippedCount,
    logs
  };
}
