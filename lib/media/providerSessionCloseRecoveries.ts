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
  digitalHumanSessionId?: string;
};

export type ProviderSessionCloseRecoveryClaimInput = {
  providerId: string;
  instanceId: string;
  providerConfigVersion: number;
  reasonCode: string;
  leaseMs: number;
};

type RecoveryRecord = {
  id: string;
  providerId: string;
  digitalHumanSessionId: string | null;
  providerSessionId: string | null;
  instanceId: string;
  providerConfigVersion: number;
  reasonCode: string;
  attemptCount: number;
  nextAttemptAt: Date;
  claimExpiresAt: Date | null;
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
  createClaim: (
    input: Omit<ProviderSessionCloseRecoveryClaimInput, "leaseMs"> & {
      nextAttemptAt: Date;
      claimExpiresAt: Date;
    }
  ) => Promise<RecoveryRecord>;
  attach: (
    id: string,
    data: {
      providerSessionId: string;
      reasonCode: string;
      nextAttemptAt: Date;
      claimExpiresAt: null;
    }
  ) => Promise<boolean>;
  renewClaim: (id: string, claimExpiresAt: Date) => Promise<boolean>;
  expireClaims: (now: Date) => Promise<Array<{ id: string }>>;
  findDue: (now: Date) => Promise<RecoveryRecord[]>;
  findProvider: (providerId: string) => Promise<CloseProviderRecord | null>;
  delete: (id: string) => Promise<unknown>;
  complete: (
    id: string,
    digitalHumanSessionId: string | null,
    completedAt: Date
  ) => Promise<unknown>;
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
  auditUnknownClaim: (claimId: string) => void;
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
const minClaimLeaseMs = 30_000;
const maxClaimLeaseMs = 15 * 60_000;

export const providerSessionCloseRecoveryClaimLeaseMs = 60_000;
export const providerSessionCloseRecoveryClaimRenewIntervalMs = 20_000;

function boundedText(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new ProviderSessionCloseRecoveryPersistenceError();
  }
  return normalized;
}

function boundedClaimLeaseMs(value: number) {
  if (
    !Number.isInteger(value) ||
    value < minClaimLeaseMs ||
    value > maxClaimLeaseMs
  ) {
    throw new ProviderSessionCloseRecoveryPersistenceError();
  }
  return value;
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

export function createPrismaProviderSessionCloseRecoveryRepository(
  client = prisma
): RecoveryRepository {
  return {
    upsert: (input) =>
      client.providerSessionCloseRecovery.upsert({
        where: {
          providerId_providerSessionId_instanceId: {
            providerId: input.providerId,
            providerSessionId: input.providerSessionId,
            instanceId: input.instanceId
          }
        },
        create: input,
        update: {
          digitalHumanSessionId: input.digitalHumanSessionId,
          reasonCode: input.reasonCode,
          nextAttemptAt: input.nextAttemptAt
        }
      }),
    createClaim: (input) =>
      client.$transaction(async (transaction) => {
        const provider = await transaction.aiServiceProvider.findUnique({
          where: { id: input.providerId },
          select: { closeConfigVersion: true }
        });
        if (
          !provider ||
          provider.closeConfigVersion !== input.providerConfigVersion
        ) {
          throw new Error("Provider close configuration changed");
        }
        return transaction.providerSessionCloseRecovery.create({
          data: { ...input, providerSessionId: null }
        });
      }),
    attach: (id, data) =>
      client.$transaction(async (transaction) => {
        const updated = await transaction.providerSessionCloseRecovery.updateMany({
          where: {
            id,
            OR: [
              { providerSessionId: null },
              { providerSessionId: data.providerSessionId }
            ]
          },
          data
        });
        if (updated.count === 1) return true;
        const existing = await transaction.providerSessionCloseRecovery.findUnique({
          where: { id },
          select: { providerSessionId: true }
        });
        return existing?.providerSessionId === data.providerSessionId;
      }),
    async renewClaim(id, claimExpiresAt) {
      const updated = await client.providerSessionCloseRecovery.updateMany({
        where: { id, providerSessionId: null, claimExpiresAt: { not: null } },
        data: { claimExpiresAt }
      });
      return updated.count === 1;
    },
    expireClaims: (now) =>
      client.$transaction(async (transaction) => {
        const expired = await transaction.providerSessionCloseRecovery.findMany({
          where: {
            providerSessionId: null,
            claimExpiresAt: { lte: now }
          },
          select: { id: true }
        });
        if (expired.length > 0) {
          await transaction.providerSessionCloseRecovery.deleteMany({
            where: {
              id: { in: expired.map((claim) => claim.id) },
              providerSessionId: null,
              claimExpiresAt: { lte: now }
            }
          });
        }
        return expired;
      }),
    findDue: (now) =>
      client.providerSessionCloseRecovery.findMany({
        where: {
          providerSessionId: { not: null },
          nextAttemptAt: { lte: now }
        },
        orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }]
      }),
    findProvider: (providerId) =>
      client.aiServiceProvider.findUnique({
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
      client.providerSessionCloseRecovery.deleteMany({ where: { id } }),
    complete: (id, digitalHumanSessionId, completedAt) =>
      client.$transaction(async (transaction) => {
        if (digitalHumanSessionId) {
          await transaction.digitalHumanSession.updateMany({
            where: { id: digitalHumanSessionId, status: { not: "STOPPED" } },
            data: {
              status: "STOPPED",
              providerId: null,
              modelId: null,
              providerSessionId: null,
              instanceId: null,
              providerConfigVersion: null,
              endedAt: completedAt,
              stopReason: "PROVIDER_SESSION_RECOVERED"
            }
          });
        }
        await transaction.providerSessionCloseRecovery.deleteMany({
          where: { id }
        });
      }),
    recordFailure: (id, data) =>
      client.providerSessionCloseRecovery.updateMany({ where: { id }, data })
  };
}

export function createProviderSessionCloseRecoveryService(
  overrides: Partial<RecoveryServiceDependencies> = {}
) {
  const deps: RecoveryServiceDependencies = {
    repository: createPrismaProviderSessionCloseRecoveryRepository(),
    createSessionCloser: createLingmouSessionCloser,
    auditUnknownClaim: (claimId) => {
      console.warn("DIGITAL_HUMAN_DIAGNOSTIC_UNKNOWN_UPSTREAM", { claimId });
    },
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
      digitalHumanSessionId: input.digitalHumanSessionId
        ? boundedText(input.digitalHumanSessionId)
        : undefined,
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

  async function createClaim(input: ProviderSessionCloseRecoveryClaimInput) {
    const claimedAt = deps.now();
    const leaseMs = boundedClaimLeaseMs(input.leaseMs);
    const normalized = {
      providerId: boundedText(input.providerId),
      instanceId: boundedText(input.instanceId),
      providerConfigVersion: input.providerConfigVersion,
      reasonCode: safeReasonCode(input.reasonCode),
      nextAttemptAt: claimedAt,
      claimExpiresAt: new Date(claimedAt.getTime() + leaseMs)
    };
    if (!Number.isInteger(normalized.providerConfigVersion)) {
      throw new ProviderSessionCloseRecoveryPersistenceError();
    }
    try {
      return await deps.repository.createClaim(normalized);
    } catch {
      throw new ProviderSessionCloseRecoveryPersistenceError();
    }
  }

  async function renewClaim(id: string, leaseMs: number) {
    const renewedAt = deps.now();
    try {
      const renewed = await deps.repository.renewClaim(
        boundedText(id),
        new Date(renewedAt.getTime() + boundedClaimLeaseMs(leaseMs))
      );
      if (!renewed) throw new Error("Recovery claim is unavailable");
    } catch {
      throw new ProviderSessionCloseRecoveryPersistenceError();
    }
  }

  async function attach(
    id: string,
    providerSessionId: string,
    reasonCode: string
  ) {
    try {
      const updated = await deps.repository.attach(boundedText(id), {
        providerSessionId: boundedText(providerSessionId),
        reasonCode: safeReasonCode(reasonCode),
        nextAttemptAt: deps.now(),
        claimExpiresAt: null
      });
      if (!updated) throw new Error("Recovery claim is unavailable");
    } catch {
      throw new ProviderSessionCloseRecoveryPersistenceError();
    }
  }

  async function release(id: string) {
    try {
      await deps.repository.delete(boundedText(id));
    } catch {
      throw new ProviderSessionCloseRecoveryPersistenceError();
    }
  }

  async function persistClaimIdentity(
    claimId: string,
    input: ProviderSessionCloseRecoveryInput,
    attachAttempts = 2
  ) {
    const normalizedClaimId = boundedText(claimId);
    if (!Number.isInteger(attachAttempts) || attachAttempts < 1 || attachAttempts > 3) {
      throw new ProviderSessionCloseRecoveryPersistenceError();
    }
    let attachFailed = false;
    for (let attempt = 0; attempt < attachAttempts; attempt += 1) {
      try {
        await attach(
          normalizedClaimId,
          input.providerSessionId,
          input.reasonCode
        );
        return { owner: "CLAIM" as const, attachFailed };
      } catch {
        attachFailed = true;
      }
    }

    const fallback = await enqueue(input);
    if (fallback.id === normalizedClaimId) {
      return { owner: "CLAIM" as const, attachFailed };
    }
    await release(normalizedClaimId).catch(() => undefined);
    return { owner: "FALLBACK" as const, attachFailed };
  }

  function closeRecovery(record: RecoveryRecord) {
    const existing = inFlightRecoveries.get(record.id);
    if (existing) return existing;

    const pending = (async () => {
      try {
        if (!record.providerSessionId) return false;
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
        await deps.repository.complete(
          record.id,
          record.digitalHumanSessionId,
          deps.now()
        );
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
    const expiredClaims = await deps.repository.expireClaims(at);
    for (const claim of expiredClaims) {
      deps.auditUnknownClaim(claim.id);
    }
    const records = await deps.repository.findDue(at);
    const results = await Promise.all(records.map(closeRecovery));
    return results.filter(Boolean).length;
  }

  return {
    enqueue,
    createClaim,
    renewClaim,
    attach,
    release,
    persistClaimIdentity,
    drainDue
  };
}

export async function enqueueProviderSessionCloseRecovery(
  input: ProviderSessionCloseRecoveryInput
) {
  return createProviderSessionCloseRecoveryService().enqueue(input);
}

export async function drainProviderSessionCloseRecoveries(now?: Date) {
  return createProviderSessionCloseRecoveryService().drainDue(now);
}

export async function createProviderSessionCloseRecoveryClaim(
  input: ProviderSessionCloseRecoveryClaimInput
) {
  return createProviderSessionCloseRecoveryService().createClaim(input);
}

export async function attachProviderSessionCloseRecovery(
  id: string,
  providerSessionId: string,
  reasonCode: string
) {
  return createProviderSessionCloseRecoveryService().attach(
    id,
    providerSessionId,
    reasonCode
  );
}

export async function renewProviderSessionCloseRecoveryClaim(
  id: string,
  leaseMs: number
) {
  return createProviderSessionCloseRecoveryService().renewClaim(id, leaseMs);
}

export async function persistProviderSessionCloseRecoveryIdentity(
  claimId: string,
  input: ProviderSessionCloseRecoveryInput,
  attachAttempts = 2
) {
  return createProviderSessionCloseRecoveryService().persistClaimIdentity(
    claimId,
    input,
    attachAttempts
  );
}

export async function releaseProviderSessionCloseRecovery(id: string) {
  return createProviderSessionCloseRecoveryService().release(id);
}
