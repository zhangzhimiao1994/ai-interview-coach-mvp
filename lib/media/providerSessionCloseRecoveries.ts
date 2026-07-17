import { prisma } from "@/lib/db/prisma";
import { MediaProviderError } from "@/lib/media/errors";
import {
  createLingmouSessionCloser,
  type LingmouSessionCloser
} from "@/lib/media/providers/lingmou";
import type { LingmouCloseCredentialSource } from "@/lib/media/providers/lingmouCredentials";

export type ProviderSessionCloseRecoveryInput = {
  providerId: string;
  providerSessionId: string;
  instanceId: string;
  providerConfigVersion: number;
  reasonCode: string;
};

type RecoveryRecord = ProviderSessionCloseRecoveryInput & {
  id: string;
  attemptCount: number;
  nextAttemptAt: Date;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type CloseProviderRecord = {
  id: string;
  providerType: string;
  settingsJson: string;
  closeConfigVersion: number;
  credentialsCiphertext: string | null;
  credentialsIv: string | null;
  credentialsTag: string | null;
};

type RecoveryRepository = {
  upsert: (
    input: ProviderSessionCloseRecoveryInput & { nextAttemptAt: Date }
  ) => Promise<RecoveryRecord>;
  findDue: (now: Date) => Promise<RecoveryRecord[]>;
  findProvider: (providerId: string) => Promise<CloseProviderRecord | null>;
  delete: (id: string) => Promise<unknown>;
  recordFailure: (
    id: string,
    data: {
      attemptCount: number;
      nextAttemptAt: Date;
      lastErrorCode: string;
    }
  ) => Promise<unknown>;
};

type RecoveryServiceDependencies = {
  repository: RecoveryRepository;
  createSessionCloser: (
    source: LingmouCloseCredentialSource,
    instanceId: string
  ) => LingmouSessionCloser;
  now: () => Date;
};

export class ProviderSessionCloseRecoveryPersistenceError extends Error {
  readonly code = "DIGITAL_HUMAN_RECOVERY_QUEUE_PERSIST_FAILED";

  constructor() {
    super("Provider session close recovery could not be persisted");
    this.name = "ProviderSessionCloseRecoveryPersistenceError";
  }
}

const inFlightRecoveries = new Map<string, Promise<boolean>>();
const initialBackoffMs = 5_000;
const maxBackoffMs = 300_000;

function boundedText(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new ProviderSessionCloseRecoveryPersistenceError();
  }
  return normalized;
}

function safeReasonCode(value: string) {
  const normalized = value.trim();
  return /^[A-Z0-9_.-]{1,100}$/.test(normalized)
    ? normalized
    : "PROVIDER_SESSION_CLOSE_REQUIRED";
}

function safeCloseErrorCode(error: unknown) {
  const candidate =
    error instanceof MediaProviderError
      ? error.code
      : "LINGMOU_RECOVERY_CLOSE_FAILED";
  return /^[A-Z0-9_.-]{1,100}$/.test(candidate)
    ? candidate
    : "LINGMOU_RECOVERY_CLOSE_FAILED";
}

function nextBackoffMs(attemptCount: number) {
  return Math.min(
    maxBackoffMs,
    initialBackoffMs * 2 ** Math.min(Math.max(attemptCount, 0), 16)
  );
}

function closeCredentialSource(
  provider: CloseProviderRecord
): LingmouCloseCredentialSource {
  let providerSettings: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(provider.settingsJson || "{}");
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("invalid");
    }
    providerSettings = parsed as Record<string, unknown>;
  } catch {
    throw new MediaProviderError(
      "Lingmou close configuration is unavailable",
      "LINGMOU",
      "LINGMOU_RECOVERY_CLOSE_CONFIG_UNAVAILABLE"
    );
  }

  const parts = [
    provider.credentialsCiphertext,
    provider.credentialsIv,
    provider.credentialsTag
  ];
  const hasAll = parts.every(
    (part) => typeof part === "string" && part.length > 0
  );
  if (!hasAll) {
    throw new MediaProviderError(
      "Lingmou close configuration is unavailable",
      "LINGMOU",
      "LINGMOU_RECOVERY_CLOSE_CONFIG_UNAVAILABLE"
    );
  }

  return {
    providerType: provider.providerType,
    providerSettings,
    credentialEnvelopes: {
      apiKey: null,
      structured: {
        ciphertext: provider.credentialsCiphertext!,
        iv: provider.credentialsIv!,
        tag: provider.credentialsTag!
      }
    }
  };
}

function createDefaultRepository(): RecoveryRepository {
  return {
    upsert: (input) =>
      prisma.providerSessionCloseRecovery.upsert({
        where: {
          providerId_providerSessionId_instanceId: {
            providerId: input.providerId,
            providerSessionId: input.providerSessionId,
            instanceId: input.instanceId
          }
        },
        update: {
          providerConfigVersion: input.providerConfigVersion,
          reasonCode: input.reasonCode,
          nextAttemptAt: input.nextAttemptAt,
          lastErrorCode: null
        },
        create: input
      }),
    findDue: (now) =>
      prisma.providerSessionCloseRecovery.findMany({
        where: { nextAttemptAt: { lte: now } },
        orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }]
      }),
    findProvider: (providerId) =>
      prisma.aiServiceProvider.findUnique({
        where: { id: providerId },
        select: {
          id: true,
          providerType: true,
          settingsJson: true,
          closeConfigVersion: true,
          credentialsCiphertext: true,
          credentialsIv: true,
          credentialsTag: true
        }
      }),
    delete: (id) =>
      prisma.providerSessionCloseRecovery.deleteMany({ where: { id } }),
    recordFailure: (id, data) =>
      prisma.providerSessionCloseRecovery.updateMany({ where: { id }, data })
  };
}

export function createProviderSessionCloseRecoveryService(
  overrides: Partial<RecoveryServiceDependencies> = {}
) {
  const deps: RecoveryServiceDependencies = {
    repository: createDefaultRepository(),
    createSessionCloser: createLingmouSessionCloser,
    now: () => new Date(),
    ...overrides
  };

  async function enqueue(input: ProviderSessionCloseRecoveryInput) {
    const normalized = {
      providerId: boundedText(input.providerId),
      providerSessionId: boundedText(input.providerSessionId),
      instanceId: boundedText(input.instanceId),
      providerConfigVersion: input.providerConfigVersion,
      reasonCode: safeReasonCode(input.reasonCode),
      nextAttemptAt: deps.now()
    };
    if (!Number.isInteger(normalized.providerConfigVersion)) {
      throw new ProviderSessionCloseRecoveryPersistenceError();
    }
    try {
      return await deps.repository.upsert(normalized);
    } catch {
      throw new ProviderSessionCloseRecoveryPersistenceError();
    }
  }

  function closeRecovery(record: RecoveryRecord) {
    const existing = inFlightRecoveries.get(record.id);
    if (existing) return existing;

    const pending = (async () => {
      try {
        const provider = await deps.repository.findProvider(record.providerId);
        if (
          !provider ||
          provider.closeConfigVersion !== record.providerConfigVersion
        ) {
          throw new MediaProviderError(
            "Lingmou close configuration is unavailable",
            "LINGMOU",
            "LINGMOU_RECOVERY_CLOSE_CONFIG_UNAVAILABLE"
          );
        }
        await deps
          .createSessionCloser(
            closeCredentialSource(provider),
            record.instanceId
          )
          .closeSession(record.providerSessionId);
        await deps.repository.delete(record.id);
        return true;
      } catch (error) {
        const attemptCount = record.attemptCount + 1;
        await deps.repository.recordFailure(record.id, {
          attemptCount,
          nextAttemptAt: new Date(
            deps.now().getTime() + nextBackoffMs(record.attemptCount)
          ),
          lastErrorCode: safeCloseErrorCode(error)
        }).catch(() => undefined);
        return false;
      }
    })();

    inFlightRecoveries.set(record.id, pending);
    void pending.finally(() => {
      if (inFlightRecoveries.get(record.id) === pending) {
        inFlightRecoveries.delete(record.id);
      }
    });
    return pending;
  }

  async function drainDue(at = deps.now()) {
    const records = await deps.repository.findDue(at);
    const results = await Promise.all(records.map(closeRecovery));
    return results.filter(Boolean).length;
  }

  return { enqueue, drainDue };
}

export async function enqueueProviderSessionCloseRecovery(
  input: ProviderSessionCloseRecoveryInput
) {
  return createProviderSessionCloseRecoveryService().enqueue(input);
}

export async function drainProviderSessionCloseRecoveries(now?: Date) {
  return createProviderSessionCloseRecoveryService().drainDue(now);
}
