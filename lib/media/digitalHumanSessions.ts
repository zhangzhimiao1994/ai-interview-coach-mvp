import { prisma } from "@/lib/db/prisma";
import { resolveMediaModel, type ResolvedMediaModel } from "@/lib/media/config";
import { MediaConfigurationError, MediaProviderError } from "@/lib/media/errors";
import {
  createLingmouProvider,
  createLingmouSessionCloser,
  type LingmouProvider,
  type LingmouRtcConnection,
  type LingmouSessionCloser
} from "@/lib/media/providers/lingmou";
import type { LingmouCloseCredentialSource } from "@/lib/media/providers/lingmouCredentials";

export const digitalHumanSessionStatuses = [
  "CONNECTING",
  "READY",
  "SPEAKING",
  "STOPPING",
  "STOPPED",
  "FAILED"
] as const;

export type DigitalHumanSessionStatus =
  (typeof digitalHumanSessionStatuses)[number];
export type DigitalHumanSessionMode = "LINGMOU_CLOUD" | "LOCAL_AVATAR";

export type PublicDigitalHumanSession = {
  id: string;
  mode: DigitalHumanSessionMode;
  status: "READY";
  reasonCode: string | null;
  connection: LingmouRtcConnection | null;
  expiresAt: string;
};

export class DigitalHumanSessionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = "DigitalHumanSessionError";
  }
}

type DigitalHumanSessionRecord = {
  id: string;
  trainingSessionId: string;
  providerId: string | null;
  modelId: string | null;
  adapter: string;
  mode: string;
  providerSessionId: string | null;
  instanceId: string | null;
  providerConfigVersion: number | null;
  status: string;
  lastActivityAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  stopReason: string | null;
};

type CreateDigitalHumanSessionRecord = Omit<
  DigitalHumanSessionRecord,
  "id" | "endedAt" | "stopReason"
>;

type DigitalHumanCloseProviderRecord = {
  id: string;
  providerType: string;
  settingsJson: string;
  credentialsCiphertext: string | null;
  credentialsIv: string | null;
  credentialsTag: string | null;
};

export type DigitalHumanSessionRepository = {
  findTrainingSession: (
    id: string
  ) => Promise<{ id: string; status: string } | null>;
  findSession: (id: string) => Promise<DigitalHumanSessionRecord | null>;
  findNonTerminalSessions: (
    trainingSessionId: string
  ) => Promise<DigitalHumanSessionRecord[]>;
  findAllNonTerminalSessions: () => Promise<DigitalHumanSessionRecord[]>;
  findIdleSessions: (idleBefore: Date) => Promise<DigitalHumanSessionRecord[]>;
  createSession: (
    data: CreateDigitalHumanSessionRecord
  ) => Promise<DigitalHumanSessionRecord>;
  transitionSession: (
    id: string,
    from: string[],
    data: Partial<DigitalHumanSessionRecord>
  ) => Promise<DigitalHumanSessionRecord | null>;
  touchSession: (
    id: string,
    statuses: string[],
    at: Date
  ) => Promise<boolean>;
  findCloseProvider: (
    providerId: string
  ) => Promise<DigitalHumanCloseProviderRecord | null>;
  failUnrecoverableSessions: (now: Date) => Promise<number>;
};

type DigitalHumanSessionServiceDependencies = {
  repository: DigitalHumanSessionRepository;
  resolveRealtimeModel: () => Promise<ResolvedMediaModel>;
  createProvider: (model: ResolvedMediaModel) => LingmouProvider;
  createSessionCloser: (
    source: LingmouCloseCredentialSource,
    persistedInstanceId: string
  ) => LingmouSessionCloser;
  now: () => Date;
};

const activeStatuses = ["CONNECTING", "READY", "SPEAKING", "STOPPING"] as const;
const nonStoppedStatuses = [...activeStatuses, "FAILED"] as const;
const expiresAfterMs = 15 * 60_000;
const idleAfterMs = 60_000;
const trainingSessionCreationLocks = new Map<string, Promise<void>>();
const inFlightSessionStops = new Map<string, Promise<void>>();

const allowedTransitions: Record<
  DigitalHumanSessionStatus,
  readonly DigitalHumanSessionStatus[]
> = {
  CONNECTING: ["READY", "STOPPING", "FAILED"],
  READY: ["SPEAKING", "STOPPING", "FAILED"],
  SPEAKING: ["READY", "STOPPING", "FAILED"],
  STOPPING: ["STOPPED", "FAILED"],
  STOPPED: [],
  FAILED: ["STOPPING"]
};

function isStatus(value: string): value is DigitalHumanSessionStatus {
  return digitalHumanSessionStatuses.includes(value as DigitalHumanSessionStatus);
}

export function isValidDigitalHumanSessionTransition(
  from: DigitalHumanSessionStatus,
  to: DigitalHumanSessionStatus
) {
  return allowedTransitions[from].includes(to);
}

function safeReasonCode(error: unknown, fallback: string) {
  const candidate =
    error instanceof MediaConfigurationError || error instanceof MediaProviderError
      ? error.code
      : fallback;
  return /^[A-Z0-9_.-]{1,100}$/.test(candidate) ? candidate : fallback;
}

function safeStopReason(reason: string) {
  const normalized = reason.trim();
  return /^[A-Z0-9_.-]{1,100}$/.test(normalized)
    ? normalized
    : "STOP_REQUESTED";
}

function isActiveSessionClaimConflict(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === "P2002" ||
    code === "P2034" ||
    message.includes("DIGITAL_HUMAN_PROVIDER_CONFIG_STALE")
  );
}

async function withTrainingSessionCreationLock<T>(
  trainingSessionId: string,
  work: () => Promise<T>
) {
  const previous =
    trainingSessionCreationLocks.get(trainingSessionId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  trainingSessionCreationLocks.set(trainingSessionId, tail);

  await previous;
  try {
    return await work();
  } finally {
    release();
    if (trainingSessionCreationLocks.get(trainingSessionId) === tail) {
      trainingSessionCreationLocks.delete(trainingSessionId);
    }
  }
}

function requiredRecordStatus(value: string) {
  if (!isStatus(value)) {
    throw new DigitalHumanSessionError(
      "Digital human session state is invalid",
      "DIGITAL_HUMAN_STATE_INVALID",
      409
    );
  }
  return value;
}

function closeCredentialSource(
  provider: DigitalHumanCloseProviderRecord
): LingmouCloseCredentialSource {
  let providerSettings: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(provider.settingsJson || "{}");
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("Invalid provider settings");
    }
    providerSettings = parsed as Record<string, unknown>;
  } catch {
    throw new DigitalHumanSessionError(
      "Digital human close configuration is unavailable",
      "DIGITAL_HUMAN_CLOSE_CONFIG_UNAVAILABLE",
      503
    );
  }

  const envelopeParts = [
    provider.credentialsCiphertext,
    provider.credentialsIv,
    provider.credentialsTag
  ];
  const hasAny = envelopeParts.some((part) => part !== null);
  const hasAll = envelopeParts.every(
    (part) => typeof part === "string" && part.length > 0
  );
  if (hasAny && !hasAll) {
    throw new DigitalHumanSessionError(
      "Digital human close configuration is unavailable",
      "DIGITAL_HUMAN_CLOSE_CONFIG_UNAVAILABLE",
      503
    );
  }

  return {
    providerType: provider.providerType,
    providerSettings,
    credentialEnvelopes: {
      apiKey: null,
      structured: hasAll
        ? {
            ciphertext: provider.credentialsCiphertext!,
            iv: provider.credentialsIv!,
            tag: provider.credentialsTag!
          }
        : null
    }
  };
}

function createDefaultRepository(): DigitalHumanSessionRepository {
  return {
    findTrainingSession: (id) =>
      prisma.trainingSession.findUnique({
        where: { id },
        select: { id: true, status: true }
      }),
    findSession: (id) =>
      prisma.digitalHumanSession.findUnique({ where: { id } }),
    findNonTerminalSessions: (trainingSessionId) =>
      prisma.digitalHumanSession.findMany({
        where: {
          trainingSessionId,
          status: { in: [...nonStoppedStatuses] }
        },
        orderBy: { createdAt: "asc" }
      }),
    findAllNonTerminalSessions: () =>
      prisma.digitalHumanSession.findMany({
        where: {
          mode: "LINGMOU_CLOUD",
          status: { in: [...nonStoppedStatuses] }
        },
        orderBy: { createdAt: "asc" }
      }),
    findIdleSessions: (idleBefore) =>
      prisma.digitalHumanSession.findMany({
        where: {
          mode: "LINGMOU_CLOUD",
          status: { in: ["READY", "SPEAKING"] },
          lastActivityAt: { lt: idleBefore }
        },
        orderBy: { lastActivityAt: "asc" }
      }),
    createSession: (data) => prisma.digitalHumanSession.create({ data }),
    async transitionSession(id, from, data) {
      const next = data.status;
      if (
        typeof next !== "string" ||
        !isStatus(next) ||
        from.some(
          (current) =>
            !isStatus(current) ||
            !isValidDigitalHumanSessionTransition(current, next)
        )
      ) {
        throw new DigitalHumanSessionError(
          "Digital human session transition is not allowed",
          "DIGITAL_HUMAN_STATE_CONFLICT",
          409
        );
      }

      const update = await prisma.digitalHumanSession.updateMany({
        where: { id, status: { in: from } },
        data
      });
      if (update.count === 0) return null;
      return prisma.digitalHumanSession.findUnique({ where: { id } });
    },
    async touchSession(id, statuses, at) {
      const update = await prisma.digitalHumanSession.updateMany({
        where: { id, status: { in: statuses } },
        data: { lastActivityAt: at }
      });
      return update.count === 1;
    },
    findCloseProvider: (providerId) =>
      prisma.aiServiceProvider.findUnique({
        where: { id: providerId },
        select: {
          id: true,
          providerType: true,
          settingsJson: true,
          credentialsCiphertext: true,
          credentialsIv: true,
          credentialsTag: true
        }
      }),
    async failUnrecoverableSessions(now) {
      const update = await prisma.digitalHumanSession.updateMany({
        where: { status: { in: [...activeStatuses] } },
        data: {
          status: "FAILED",
          endedAt: now,
          stopReason: "PROCESS_RESTART"
        }
      });
      return update.count;
    }
  };
}

function defaultDependencies(): DigitalHumanSessionServiceDependencies {
  return {
    repository: createDefaultRepository(),
    resolveRealtimeModel: () => resolveMediaModel("DIGITAL_HUMAN_REALTIME"),
    createProvider: createLingmouProvider,
    createSessionCloser: createLingmouSessionCloser,
    now: () => new Date()
  };
}

export function createDigitalHumanSessionService(
  overrides: Partial<DigitalHumanSessionServiceDependencies> = {}
) {
  const deps = { ...defaultDependencies(), ...overrides };

  async function transition(
    record: DigitalHumanSessionRecord,
    to: DigitalHumanSessionStatus,
    data: Partial<DigitalHumanSessionRecord> = {}
  ) {
    const from = requiredRecordStatus(record.status);
    if (!isValidDigitalHumanSessionTransition(from, to)) {
      throw new DigitalHumanSessionError(
        "Digital human session transition is not allowed",
        "DIGITAL_HUMAN_STATE_CONFLICT",
        409
      );
    }
    return deps.repository.transitionSession(record.id, [from], {
      ...data,
      status: to
    });
  }

  async function localSession(
    trainingSessionId: string,
    reasonCode: string
  ): Promise<PublicDigitalHumanSession> {
    const createdAt = deps.now();
    const record = await createClaimedSession({
      trainingSessionId,
      providerId: null,
      modelId: null,
      adapter: "LOCAL",
      mode: "LOCAL_AVATAR",
      providerSessionId: null,
      instanceId: null,
      providerConfigVersion: null,
      status: "READY",
      lastActivityAt: createdAt,
      expiresAt: new Date(createdAt.getTime() + expiresAfterMs)
    });
    return {
      id: record.id,
      mode: "LOCAL_AVATAR",
      status: "READY",
      reasonCode,
      connection: null,
      expiresAt: record.expiresAt.toISOString()
    };
  }

  async function createClaimedSession(data: CreateDigitalHumanSessionRecord) {
    try {
      return await deps.repository.createSession(data);
    } catch (error) {
      if (isActiveSessionClaimConflict(error)) {
        throw new DigitalHumanSessionError(
          "Another digital human session is already active",
          "DIGITAL_HUMAN_ACTIVE_CONFLICT",
          409
        );
      }
      throw error;
    }
  }

  async function stopDigitalHumanSessionWork(
    id: string,
    reason: string
  ): Promise<void> {
    const normalizedReason = safeStopReason(reason);
    const record = await deps.repository.findSession(id);
    if (!record) {
      throw new DigitalHumanSessionError(
        "Digital human session was not found",
        "DIGITAL_HUMAN_SESSION_NOT_FOUND",
        404
      );
    }
    if (record.status === "STOPPED") {
      return;
    }
    if (record.status === "STOPPING") {
      throw new DigitalHumanSessionError(
        "Digital human session is changing state",
        "DIGITAL_HUMAN_STATE_CONFLICT",
        409
      );
    }

    const stopping = await transition(record, "STOPPING", {
      stopReason: normalizedReason
    });
    if (!stopping) {
      const current = await deps.repository.findSession(id);
      if (
        current &&
        current.status === "STOPPED"
      ) {
        return;
      }
      if (current?.status === "STOPPING") {
        throw new DigitalHumanSessionError(
          "Digital human session is changing state",
          "DIGITAL_HUMAN_STATE_CONFLICT",
          409
        );
      }
      throw new DigitalHumanSessionError(
        "Digital human session is changing state",
        "DIGITAL_HUMAN_STATE_CONFLICT",
        409
      );
    }

    try {
      if (stopping.mode === "LINGMOU_CLOUD") {
        if (
          !stopping.providerId ||
          !stopping.providerSessionId ||
          !stopping.instanceId
        ) {
          throw new Error("Cloud session metadata is incomplete");
        }
        const provider = await deps.repository.findCloseProvider(
          stopping.providerId
        );
        if (!provider) throw new Error("Close provider is unavailable");
        await deps
          .createSessionCloser(
            closeCredentialSource(provider),
            stopping.instanceId
          )
          .closeSession(stopping.providerSessionId);
      }
      const stopped = await transition(stopping, "STOPPED", {
        endedAt: deps.now(),
        stopReason: normalizedReason
      });
      if (!stopped) {
        throw new DigitalHumanSessionError(
          "Digital human session is changing state",
          "DIGITAL_HUMAN_STATE_CONFLICT",
          409
        );
      }
    } catch {
      await deps.repository
        .transitionSession(stopping.id, ["STOPPING"], {
          status: "FAILED",
          endedAt: deps.now(),
          stopReason: normalizedReason
        })
        .catch(() => undefined);
      throw new DigitalHumanSessionError(
        "Digital human session could not be stopped",
        "DIGITAL_HUMAN_STOP_FAILED",
        503
      );
    }
  }

  function stopDigitalHumanSession(id: string, reason: string): Promise<void> {
    const existing = inFlightSessionStops.get(id);
    if (existing) return existing;

    const pending = stopDigitalHumanSessionWork(id, reason);
    inFlightSessionStops.set(id, pending);
    void pending.then(
      () => {
        if (inFlightSessionStops.get(id) === pending) {
          inFlightSessionStops.delete(id);
        }
      },
      () => {
        if (inFlightSessionStops.get(id) === pending) {
          inFlightSessionStops.delete(id);
        }
      }
    );
    return pending;
  }

  async function stopDigitalHumanSessionsForTrainingSession(
    trainingSessionId: string,
    reason: string
  ) {
    const sessions = await deps.repository.findNonTerminalSessions(
      trainingSessionId
    );
    let failed = false;
    for (const session of sessions) {
      try {
        await stopDigitalHumanSession(session.id, reason);
      } catch {
        failed = true;
      }
    }
    if (failed) {
      throw new DigitalHumanSessionError(
        "One or more digital human sessions could not be stopped",
        "DIGITAL_HUMAN_STOP_FAILED",
        503
      );
    }
  }

  async function stopAllActiveDigitalHumanSessions(reason: string) {
    const sessions = await deps.repository.findAllNonTerminalSessions();
    let failed = false;
    for (const session of sessions) {
      try {
        await stopDigitalHumanSession(session.id, reason);
      } catch {
        failed = true;
      }
    }
    if (failed) {
      throw new DigitalHumanSessionError(
        "One or more digital human sessions could not be stopped",
        "DIGITAL_HUMAN_STOP_FAILED",
        503
      );
    }
  }

  async function createDigitalHumanSessionUnlocked(
    trainingSessionId: string
  ): Promise<PublicDigitalHumanSession> {
    const training = await deps.repository.findTrainingSession(trainingSessionId);
    if (!training) {
      throw new DigitalHumanSessionError(
        "Training session was not found",
        "TRAINING_SESSION_NOT_FOUND",
        404
      );
    }
    if (training.status !== "IN_PROGRESS") {
      throw new DigitalHumanSessionError(
        "Training session is not active",
        "TRAINING_SESSION_INACTIVE",
        409
      );
    }

    await stopDigitalHumanSessionsForTrainingSession(
      trainingSessionId,
      "REPLACED_BY_NEW_SESSION"
    );

    let model: ResolvedMediaModel;
    try {
      model = await deps.resolveRealtimeModel();
    } catch (error) {
      return localSession(
        trainingSessionId,
        safeReasonCode(error, "LINGMOU_NOT_CONFIGURED")
      );
    }

    const createdAt = deps.now();
    const connecting = await createClaimedSession({
      trainingSessionId,
      providerId: model.providerId,
      modelId: model.modelId,
      adapter: "LINGMOU_OFFICIAL_SDK",
      mode: "LINGMOU_CLOUD",
      providerSessionId: null,
      instanceId:
        typeof model.modelSettings.instanceId === "string"
          ? model.modelSettings.instanceId
          : null,
      providerConfigVersion: model.providerConfigVersion,
      status: "CONNECTING",
      lastActivityAt: createdAt,
      expiresAt: new Date(createdAt.getTime() + expiresAfterMs)
    });

    let provider: LingmouProvider;
    let cloud: Awaited<ReturnType<LingmouProvider["createSession"]>>;
    try {
      provider = deps.createProvider(model);
      cloud = await provider.createSession();
    } catch (error) {
      const fallback = await transition(connecting, "READY", {
        providerId: null,
        modelId: null,
        adapter: "LOCAL",
        mode: "LOCAL_AVATAR",
        providerSessionId: null,
        instanceId: null,
        lastActivityAt: deps.now()
      });
      if (!fallback) {
        throw new DigitalHumanSessionError(
          "Digital human session could not fall back locally",
          "DIGITAL_HUMAN_STATE_CONFLICT",
          409
        );
      }
      return {
        id: fallback.id,
        mode: "LOCAL_AVATAR",
        status: "READY",
        reasonCode: safeReasonCode(error, "LINGMOU_UPSTREAM_FAILED"),
        connection: null,
        expiresAt: fallback.expiresAt.toISOString()
      };
    }

    try {
      const ready = await transition(connecting, "READY", {
        providerSessionId: cloud.providerSessionId,
        lastActivityAt: deps.now()
      });
      if (!ready) throw new Error("Local state update failed");
      return {
        id: ready.id,
        mode: "LINGMOU_CLOUD",
        status: "READY",
        reasonCode: null,
        connection: cloud.connection,
        expiresAt: ready.expiresAt.toISOString()
      };
    } catch {
      let compensationClosed = false;
      try {
        await provider.closeSession(cloud.providerSessionId);
        compensationClosed = true;
      } catch {
        compensationClosed = false;
      }

      try {
        if (compensationClosed) {
          const stopping = await deps.repository.transitionSession(
            connecting.id,
            ["CONNECTING", "READY"],
            {
              status: "STOPPING",
              providerSessionId: cloud.providerSessionId,
              stopReason: "CLOUD_PERSIST_FAILED"
            }
          );
          if (!stopping) throw new Error("Recovery state changed");
          const stopped = await transition(stopping, "STOPPED", {
            endedAt: deps.now(),
            stopReason: "CLOUD_PERSIST_FAILED"
          });
          if (!stopped) throw new Error("Recovery state changed");
        } else {
          const failed = await deps.repository.transitionSession(
            connecting.id,
            ["CONNECTING", "READY"],
            {
              status: "FAILED",
              providerSessionId: cloud.providerSessionId,
              endedAt: deps.now(),
              stopReason: "CLOUD_PERSIST_FAILED"
            }
          );
          if (!failed) throw new Error("Recovery state changed");
        }
      } catch {
        throw new DigitalHumanSessionError(
          "Digital human recovery identity could not be persisted",
          "DIGITAL_HUMAN_RECOVERY_IDENTITY_PERSIST_FAILED",
          500
        );
      }
      throw new DigitalHumanSessionError(
        "Digital human session could not be persisted",
        "DIGITAL_HUMAN_PERSIST_FAILED",
        500
      );
    }
  }

  async function createDigitalHumanSession(trainingSessionId: string) {
    return withTrainingSessionCreationLock(trainingSessionId, () =>
      createDigitalHumanSessionUnlocked(trainingSessionId)
    );
  }

  async function heartbeatDigitalHumanSession(id: string) {
    const record = await deps.repository.findSession(id);
    if (!record) {
      throw new DigitalHumanSessionError(
        "Digital human session was not found",
        "DIGITAL_HUMAN_SESSION_NOT_FOUND",
        404
      );
    }
    const status = requiredRecordStatus(record.status);
    if (status !== "READY" && status !== "SPEAKING") {
      throw new DigitalHumanSessionError(
        "Digital human session is not active",
        "DIGITAL_HUMAN_STATE_CONFLICT",
        409
      );
    }
    const updated = await deps.repository.touchSession(
      id,
      ["READY", "SPEAKING"],
      deps.now()
    );
    if (!updated) {
      throw new DigitalHumanSessionError(
        "Digital human session is changing state",
        "DIGITAL_HUMAN_STATE_CONFLICT",
        409
      );
    }
  }

  async function stopIdleDigitalHumanSessions(now = deps.now()) {
    const sessions = await deps.repository.findIdleSessions(
      new Date(now.getTime() - idleAfterMs)
    );
    for (const session of sessions) {
      await stopDigitalHumanSession(session.id, "IDLE_TIMEOUT").catch(
        () => undefined
      );
    }
    return sessions.length;
  }

  return {
    createDigitalHumanSession,
    heartbeatDigitalHumanSession,
    stopDigitalHumanSession,
    stopDigitalHumanSessionsForTrainingSession,
    stopAllActiveDigitalHumanSessions,
    stopIdleDigitalHumanSessions,
    failUnrecoverableDigitalHumanSessions: (now = deps.now()) =>
      deps.repository.failUnrecoverableSessions(now)
  };
}

function defaultService() {
  return createDigitalHumanSessionService();
}

export async function createDigitalHumanSession(trainingSessionId: string) {
  return defaultService().createDigitalHumanSession(trainingSessionId);
}

export async function heartbeatDigitalHumanSession(id: string) {
  return defaultService().heartbeatDigitalHumanSession(id);
}

export async function stopDigitalHumanSession(id: string, reason: string) {
  return defaultService().stopDigitalHumanSession(id, reason);
}

export async function stopDigitalHumanSessionsForTrainingSession(
  trainingSessionId: string,
  reason: string
) {
  return defaultService().stopDigitalHumanSessionsForTrainingSession(
    trainingSessionId,
    reason
  );
}

export async function stopAllActiveDigitalHumanSessions(reason: string) {
  return defaultService().stopAllActiveDigitalHumanSessions(reason);
}

export async function stopIdleDigitalHumanSessions(now?: Date) {
  return defaultService().stopIdleDigitalHumanSessions(now);
}

export async function failUnrecoverableDigitalHumanSessions(now?: Date) {
  return defaultService().failUnrecoverableDigitalHumanSessions(now);
}

type DigitalHumanSessionReaperStop = () => Promise<void>;

let activeReaperStop: DigitalHumanSessionReaperStop | null = null;

export function startDigitalHumanSessionReaper(options: {
  intervalMs?: number;
  now?: () => Date;
} = {}) {
  if (activeReaperStop) return activeReaperStop;

  let activeTick: Promise<void> | null = null;
  let stopped = false;
  const interval = setInterval(() => {
    if (activeTick || stopped) return;
    const tick = stopIdleDigitalHumanSessions(options.now?.())
      .then(() => undefined)
      .catch(() => {
        console.warn("DIGITAL_HUMAN_REAPER_FAILED");
      })
      .finally(() => {
        if (activeTick === tick) activeTick = null;
      });
    activeTick = tick;
  }, options.intervalMs ?? 30_000);
  interval.unref?.();

  let drain: Promise<void> | null = null;
  const stop = () => {
    if (drain) return drain;
    stopped = true;
    clearInterval(interval);
    if (!activeTick) {
      if (activeReaperStop === stop) activeReaperStop = null;
      drain = Promise.resolve();
      return drain;
    }
    drain = activeTick.finally(() => {
      if (activeReaperStop === stop) activeReaperStop = null;
    });
    return drain;
  };
  activeReaperStop = stop;
  return stop;
}
