import { describe, expect, it, vi } from "vitest";
import { MediaConfigurationError, MediaProviderError } from "@/lib/media/errors";
import type { ResolvedMediaModel } from "@/lib/media/config";
import { LingmouSessionRecoveryError } from "@/lib/media/providers/lingmou";
import {
  createDigitalHumanSessionService,
  isValidDigitalHumanSessionTransition,
  startDigitalHumanSessionReaper
} from "@/lib/media/digitalHumanSessions";
import { createServerShutdown } from "@/lib/server/lifecycle";

type RecordRow = {
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
  updatedAt: Date;
};

const now = new Date("2026-07-17T03:00:00.000Z");
const connection = {
  appId: "rtc-app",
  avatarUserId: "avatar-user",
  channel: "rtc-channel",
  clientUserId: "client-user",
  serverUserId: "server-user",
  timestamp: 1_784_257_200,
  token: "short-lived-token",
  sessionId: "provider-session-1"
};
const duixConnection = {
  protocol: "webrtc" as const,
  metadata: {
    adapter: "DUIX_H5_SDK",
    sign: "short-lived-sign",
    conversationId: "conv-1",
    platform: "duix.com",
    sdkPackage: "duix-guiji",
    openAsr: false,
    speechMode: "duix-managed"
  }
};

function realtimeModel(): ResolvedMediaModel {
  return {
    capability: "DIGITAL_HUMAN_REALTIME",
    providerId: "lingmou-provider",
    providerName: "Lingmou",
    providerType: "LINGMOU",
    providerConfigVersion: 0,
    baseUrl: null,
    providerSettings: { region: "cn-beijing" },
    modelId: "lingmou-model",
    modelDisplayName: "Lingmou avatar",
    modelName: "lingmou-2d-cloud-audio-driven",
    modelSettings: {
      configId: "config-id",
      instanceId: "instance-id",
      renderMode: "cloud",
      integrationMode: "audio-driven",
      client: "web"
    },
    temperature: 0.4,
    maxTokens: 1200,
    timeoutMs: 30_000,
    credentialEnvelopes: { apiKey: null, structured: null }
  };
}

function duixRealtimeModel(): ResolvedMediaModel {
  return {
    capability: "DIGITAL_HUMAN_REALTIME",
    providerId: "duix-provider",
    providerName: "硅基 DUIX",
    providerType: "DUIX",
    providerConfigVersion: 2,
    baseUrl: null,
    providerSettings: { platform: "duix.com" },
    modelId: "duix-model",
    modelDisplayName: "DUIX 2D 端渲染实时数字人",
    modelName: "duix-h5-realtime",
    modelSettings: {
      conversationId: "conv-1",
      client: "web",
      interactionMode: "direct-drive",
      speechMode: "duix-managed"
    },
    temperature: 0.4,
    maxTokens: 1200,
    timeoutMs: 30_000,
    credentialEnvelopes: { apiKey: null, structured: null }
  };
}

function harness(initial: RecordRow[] = []) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  let sequence = initial.length;
  const closeSession = vi.fn().mockResolvedValue(undefined);
  const stopSession = vi.fn().mockResolvedValue(undefined);
  const createSession = vi.fn().mockResolvedValue({
    providerSessionId: "provider-session-1",
    connection
  });
  const repository = {
    findTrainingSession: vi.fn().mockResolvedValue({ id: "training-1", status: "IN_PROGRESS" }),
    findSession: vi.fn(async (id: string) => rows.get(id) ?? null),
    findNonTerminalSessions: vi.fn(async (trainingSessionId: string) =>
      [...rows.values()].filter(
        (row) =>
          row.trainingSessionId === trainingSessionId &&
          row.status !== "STOPPED"
      )
    ),
    findAllNonTerminalSessions: vi.fn(async () =>
      [...rows.values()].filter(
        (record) =>
          record.mode === "LINGMOU_CLOUD" && record.status !== "STOPPED"
      )
    ),
    findReapableSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn(async (data: Omit<
      RecordRow,
      "id" | "endedAt" | "stopReason" | "updatedAt"
    >) => {
      const row: RecordRow = {
        ...data,
        id: `digital-${++sequence}`,
        endedAt: null,
        stopReason: null,
        updatedAt: now
      };
      rows.set(row.id, row);
      return row;
    }),
    transitionSession: vi.fn(
      async (id: string, from: string[], data: Partial<RecordRow>) => {
        const row = rows.get(id);
        if (!row || !from.includes(row.status)) return null;
        const updated = { ...row, ...data };
        rows.set(id, updated);
        return updated;
      }
    ),
    touchSession: vi.fn(async (id: string, statuses: string[], at: Date) => {
      const existing = rows.get(id);
      if (!existing || !statuses.includes(existing.status)) return false;
      rows.set(id, { ...existing, lastActivityAt: at });
      return true;
    }),
    findCloseProvider: vi.fn().mockResolvedValue({
      id: "lingmou-provider",
      providerType: "LINGMOU",
      settingsJson: JSON.stringify({ region: "cn-beijing" }),
      credentialsCiphertext: "ciphertext",
      credentialsIv: "iv",
      credentialsTag: "tag"
    }),
    failUnrecoverableSessions: vi.fn().mockResolvedValue(0)
  };
  const resolveRealtimeModel = vi.fn().mockResolvedValue(realtimeModel());
  const provider = { createSession, closeSession, stopSession };
  const createProvider = vi.fn(() => provider);
  const createSessionCloser = vi.fn(() => ({ closeSession }));
  const enqueueRecovery = vi.fn().mockResolvedValue(undefined);
  const serviceDependencies = {
    repository,
    resolveRealtimeModel,
    createProvider,
    createSessionCloser,
    enqueueRecovery,
    now: () => now
  };
  const service = createDigitalHumanSessionService(serviceDependencies);

  return {
    rows,
    repository,
    resolveRealtimeModel,
    provider,
    createSessionCloser,
    enqueueRecovery,
    serviceDependencies,
    service
  };
}

function row(overrides: Partial<RecordRow> = {}): RecordRow {
  return {
    id: "digital-1",
    trainingSessionId: "training-1",
    providerId: null,
    modelId: null,
    adapter: "LOCAL",
    mode: "LOCAL_AVATAR",
    providerSessionId: null,
    instanceId: null,
    providerConfigVersion: null,
    status: "READY",
    lastActivityAt: now,
    expiresAt: new Date(now.getTime() + 15 * 60_000),
    endedAt: null,
    stopReason: null,
    updatedAt: now,
    ...overrides
  };
}

describe("digital human session lifecycle", () => {
  it("allows only forward lifecycle transitions", () => {
    expect(isValidDigitalHumanSessionTransition("CONNECTING", "READY")).toBe(true);
    expect(isValidDigitalHumanSessionTransition("READY", "SPEAKING")).toBe(true);
    expect(isValidDigitalHumanSessionTransition("SPEAKING", "READY")).toBe(true);
    expect(isValidDigitalHumanSessionTransition("READY", "STOPPING")).toBe(true);
    expect(isValidDigitalHumanSessionTransition("STOPPING", "STOPPED")).toBe(true);
    expect(isValidDigitalHumanSessionTransition("STOPPING", "READY")).toBe(true);
    expect(isValidDigitalHumanSessionTransition("STOPPED", "READY")).toBe(false);
    expect(isValidDigitalHumanSessionTransition("FAILED", "CONNECTING")).toBe(false);
  });

  it("creates a ready cloud session while persisting no RTC connection fields", async () => {
    const { rows, service } = harness();

    const result = await service.createDigitalHumanSession("training-1");

    expect(result).toEqual({
      id: "digital-1",
      mode: "LINGMOU_CLOUD",
      status: "READY",
      reasonCode: null,
      connection,
      expiresAt: "2026-07-17T03:15:00.000Z"
    });
    const stored = rows.get("digital-1");
    expect(stored).toMatchObject({
      providerId: "lingmou-provider",
      modelId: "lingmou-model",
      providerSessionId: "provider-session-1",
      instanceId: "instance-id",
      status: "READY"
    });
    expect(JSON.stringify(stored)).not.toContain("short-lived-token");
    expect(stored).not.toHaveProperty("connection");
  });

  it("creates a ready DUIX H5 session while returning only browser-safe metadata", async () => {
    const { rows, resolveRealtimeModel, provider, createSessionCloser, service } =
      harness();
    resolveRealtimeModel.mockResolvedValue(duixRealtimeModel());
    provider.createSession.mockResolvedValue({
      providerSessionId: "duix-provider-session-1",
      connection: duixConnection
    });

    const result = await service.createDigitalHumanSession("training-1");

    expect(provider.createSession).toHaveBeenCalledWith({
      trainingSessionId: "training-1"
    });
    expect(result).toEqual({
      id: "digital-1",
      mode: "DUIX_H5",
      status: "READY",
      reasonCode: null,
      connection: duixConnection,
      expiresAt: "2026-07-17T03:15:00.000Z"
    });
    expect(rows.get("digital-1")).toMatchObject({
      providerId: "duix-provider",
      modelId: "duix-model",
      adapter: "DUIX_H5_SDK",
      mode: "DUIX_H5",
      providerSessionId: "duix-provider-session-1",
      instanceId: null,
      providerConfigVersion: 2,
      status: "READY"
    });
    expect(createSessionCloser).not.toHaveBeenCalled();
    expect(JSON.stringify(rows.get("digital-1"))).not.toContain("short-lived-sign");
    expect(JSON.stringify(result)).not.toContain("appSecret");
  });

  it("falls back to a usable local session when Lingmou configuration is unavailable", async () => {
    const { rows, resolveRealtimeModel, provider, service } = harness();
    resolveRealtimeModel.mockRejectedValue(
      new MediaConfigurationError("contains access-key-sentinel", {
        code: "LINGMOU_CONFIG_ID_REQUIRED"
      })
    );

    const result = await service.createDigitalHumanSession("training-1");

    expect(result).toMatchObject({
      mode: "LOCAL_AVATAR",
      status: "READY",
      reasonCode: "LINGMOU_CONFIG_ID_REQUIRED",
      connection: null
    });
    expect(provider.createSession).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("access-key-sentinel");
    expect([...rows.values()][0]).toMatchObject({
      mode: "LOCAL_AVATAR",
      status: "READY",
      providerSessionId: null
    });
  });

  it("gives the linked durable queue sole ownership of invalid-RTC recovery", async () => {
    const { rows, provider, repository, enqueueRecovery, service } = harness();
    provider.createSession.mockRejectedValue(
      new LingmouSessionRecoveryError("orphan-upstream-1", "instance-id")
    );

    await expect(
      service.createDigitalHumanSession("training-1")
    ).rejects.toMatchObject({
      code: "DIGITAL_HUMAN_UPSTREAM_RECOVERY_PENDING",
      status: 503
    });

    expect(enqueueRecovery).toHaveBeenCalledWith({
      providerId: "lingmou-provider",
      providerSessionId: "orphan-upstream-1",
      instanceId: "instance-id",
      providerConfigVersion: 0,
      reasonCode: "CREATE_COMPENSATION_FAILED",
      digitalHumanSessionId: "digital-1"
    });
    expect(rows.get("digital-1")).toMatchObject({
      mode: "LINGMOU_CLOUD",
      status: "FAILED",
      providerId: "lingmou-provider",
      providerSessionId: null,
      instanceId: "instance-id",
      stopReason: "CREATE_COMPENSATION_FAILED"
    });
    expect(enqueueRecovery.mock.invocationCallOrder[0]).toBeLessThan(
      repository.transitionSession.mock.invocationCallOrder[0]!
    );
  });

  it("keeps lifecycle ownership and lets the reaper close once when linked enqueue is not persisted", async () => {
    const { rows, provider, repository, enqueueRecovery, service } = harness();
    provider.createSession.mockRejectedValue(
      new LingmouSessionRecoveryError("orphan-upstream-1", "instance-id")
    );
    enqueueRecovery.mockRejectedValue(new Error("raw database secret sentinel"));

    const error = await service
      .createDigitalHumanSession("training-1")
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "DIGITAL_HUMAN_RECOVERY_QUEUE_PERSIST_FAILED",
      status: 500
    });
    expect(String(error)).not.toContain("database secret sentinel");

    const fallbackOwner = rows.get("digital-1");
    expect(fallbackOwner).toMatchObject({
      mode: "LINGMOU_CLOUD",
      status: "FAILED",
      providerId: "lingmou-provider",
      providerSessionId: "orphan-upstream-1",
      instanceId: "instance-id",
      providerConfigVersion: 0,
      stopReason: "CREATE_COMPENSATION_FAILED"
    });
    repository.findReapableSessions.mockResolvedValue([fallbackOwner!]);

    await expect(service.reapDigitalHumanSessions(now)).resolves.toBe(1);

    expect(provider.closeSession).toHaveBeenCalledOnce();
    expect(provider.closeSession).toHaveBeenCalledWith("orphan-upstream-1");
    expect(rows.get("digital-1")).toMatchObject({
      status: "STOPPED",
      providerSessionId: "orphan-upstream-1",
      stopReason: "RECOVERY_RETRY"
    });
  });

  it("falls back locally without claiming cloud success when upstream creation fails", async () => {
    const { rows, provider, service } = harness();
    provider.createSession.mockRejectedValue(
      new MediaProviderError(
        "raw upstream token-sentinel",
        "LINGMOU",
        "LINGMOU_UPSTREAM_FAILED",
        true
      )
    );

    const result = await service.createDigitalHumanSession("training-1");

    expect(result).toMatchObject({
      mode: "LOCAL_AVATAR",
      status: "READY",
      reasonCode: "LINGMOU_UPSTREAM_FAILED",
      connection: null
    });
    expect(JSON.stringify(result)).not.toContain("token-sentinel");
    expect([...rows.values()][0]).toMatchObject({
      mode: "LOCAL_AVATAR",
      status: "READY",
      providerSessionId: null
    });
  });

  it("falls back locally when DUIX signing or H5 session preparation fails", async () => {
    const { rows, resolveRealtimeModel, provider, enqueueRecovery, service } =
      harness();
    resolveRealtimeModel.mockResolvedValue(duixRealtimeModel());
    provider.createSession.mockRejectedValue(
      new MediaProviderError(
        "raw duix appSecret sentinel",
        "DUIX",
        "DUIX_UPSTREAM_FAILED",
        true
      )
    );

    const result = await service.createDigitalHumanSession("training-1");

    expect(result).toMatchObject({
      mode: "LOCAL_AVATAR",
      status: "READY",
      reasonCode: "DUIX_UPSTREAM_FAILED",
      connection: null
    });
    expect(enqueueRecovery).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("appSecret sentinel");
    expect([...rows.values()][0]).toMatchObject({
      mode: "LOCAL_AVATAR",
      status: "READY",
      providerSessionId: null
    });
  });

  it("records STOPPED after compensation closes a cloud session whose READY update failed", async () => {
    const { rows, repository, provider, service } = harness();
    repository.transitionSession.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(service.createDigitalHumanSession("training-1")).rejects.toThrow(
      "Digital human session could not be persisted"
    );
    expect(provider.closeSession).toHaveBeenCalledOnce();
    expect(provider.closeSession).toHaveBeenCalledWith("provider-session-1");
    expect(rows.get("digital-1")).toMatchObject({
      status: "STOPPED",
      stopReason: "CLOUD_PERSIST_FAILED",
      endedAt: now
    });
  });

  it("persists recovery identity after READY and compensation close fail, then retries DELETE", async () => {
    const { rows, repository, provider, service } = harness();
    repository.transitionSession.mockRejectedValueOnce(
      new Error("ready write unavailable")
    );
    provider.closeSession.mockRejectedValueOnce(
      new Error("raw close access-key-sentinel")
    );

    const createError = await service
      .createDigitalHumanSession("training-1")
      .catch((error) => error);

    expect(createError).toMatchObject({ code: "DIGITAL_HUMAN_PERSIST_FAILED" });
    expect(String(createError)).not.toContain("access-key-sentinel");
    expect(rows.get("digital-1")).toMatchObject({
      providerId: "lingmou-provider",
      instanceId: "instance-id",
      providerConfigVersion: 0,
      providerSessionId: "provider-session-1",
      status: "FAILED",
      stopReason: "CLOUD_PERSIST_FAILED"
    });

    await service.stopDigitalHumanSession("digital-1", "CLIENT_DELETE_RETRY");

    expect(provider.closeSession).toHaveBeenCalledTimes(2);
    expect(provider.closeSession).toHaveBeenLastCalledWith("provider-session-1");
    expect(rows.get("digital-1")).toMatchObject({
      status: "STOPPED",
      stopReason: "CLIENT_DELETE_RETRY"
    });
  });

  it("returns a bounded operational error when recovery identity cannot be persisted", async () => {
    const { repository, provider, service } = harness();
    repository.transitionSession
      .mockRejectedValueOnce(new Error("ready write unavailable"))
      .mockRejectedValueOnce(
        new Error("raw recovery write access-key-sentinel")
      );
    provider.closeSession.mockRejectedValueOnce(
      new Error("raw compensation access-key-sentinel")
    );

    const error = await service
      .createDigitalHumanSession("training-1")
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "DIGITAL_HUMAN_RECOVERY_IDENTITY_PERSIST_FAILED",
      status: 500
    });
    expect(String(error)).not.toContain("access-key-sentinel");
  });

  it("stops a local session idempotently", async () => {
    const { rows, repository, provider, service } = harness([row()]);

    await service.stopDigitalHumanSession("digital-1", "CLIENT_EXIT");
    await service.stopDigitalHumanSession("digital-1", "CLIENT_EXIT");

    expect(rows.get("digital-1")).toMatchObject({
      status: "STOPPED",
      endedAt: now,
      stopReason: "CLIENT_EXIT"
    });
    expect(provider.closeSession).not.toHaveBeenCalled();
    expect(repository.transitionSession).toHaveBeenCalledTimes(2);
  });

  it("stops a DUIX H5 session locally without invoking Lingmou close recovery", async () => {
    const duix = row({
      providerId: "duix-provider",
      modelId: "duix-model",
      adapter: "DUIX_H5_SDK",
      mode: "DUIX_H5",
      providerSessionId: "duix-provider-session-1",
      instanceId: null,
      providerConfigVersion: 2
    });
    const {
      rows,
      repository,
      provider,
      createSessionCloser,
      service
    } = harness([duix]);

    await service.stopDigitalHumanSession("digital-1", "CLIENT_EXIT");

    expect(rows.get("digital-1")).toMatchObject({
      status: "STOPPED",
      endedAt: now,
      stopReason: "CLIENT_EXIT"
    });
    expect(provider.closeSession).not.toHaveBeenCalled();
    expect(provider.stopSession).not.toHaveBeenCalled();
    expect(repository.findCloseProvider).not.toHaveBeenCalled();
    expect(createSessionCloser).not.toHaveBeenCalled();
  });

  it("normalizes unsafe stop reasons before persistence", async () => {
    const { rows, service } = harness([row()]);

    await service.stopDigitalHumanSession(
      "digital-1",
      "raw access-key-sentinel"
    );

    expect(rows.get("digital-1")?.stopReason).toBe("STOP_REQUESTED");
    expect(JSON.stringify(rows.get("digital-1"))).not.toContain(
      "access-key-sentinel"
    );
  });

  it("refreshes activity without treating heartbeat as a state transition", async () => {
    const earlier = new Date(now.getTime() - 20_000);
    const { rows, repository, service } = harness([
      row({ lastActivityAt: earlier })
    ]);

    await service.heartbeatDigitalHumanSession("digital-1");

    expect(rows.get("digital-1")?.lastActivityAt).toEqual(now);
    expect(repository.touchSession).toHaveBeenCalledWith(
      "digital-1",
      ["READY", "SPEAKING"],
      now
    );
    expect(repository.transitionSession).not.toHaveBeenCalled();
  });

  it("marks a cloud session FAILED with a safe error when upstream stop fails", async () => {
    const cloud = row({
      providerId: "lingmou-provider",
      modelId: "lingmou-model",
      adapter: "LINGMOU_OFFICIAL_SDK",
      mode: "LINGMOU_CLOUD",
      providerSessionId: "provider-session-1",
      instanceId: "instance-id"
    });
    const { rows, provider, service } = harness([cloud]);
    provider.closeSession.mockRejectedValue(
      new Error("raw close access-key-sentinel")
    );

    const error = await service
      .stopDigitalHumanSession("digital-1", "CLIENT_EXIT")
      .catch((caught) => caught);

    expect(error).toMatchObject({ code: "DIGITAL_HUMAN_STOP_FAILED" });
    expect(String(error)).not.toContain("access-key-sentinel");
    expect(rows.get("digital-1")).toMatchObject({
      status: "FAILED",
      endedAt: now,
      stopReason: "CLIENT_EXIT"
    });

    provider.closeSession.mockResolvedValue(undefined);
    await service.stopDigitalHumanSession("digital-1", "CLIENT_EXIT_RETRY");

    expect(provider.closeSession).toHaveBeenCalledTimes(2);
    expect(rows.get("digital-1")).toMatchObject({
      status: "STOPPED",
      stopReason: "CLIENT_EXIT_RETRY"
    });
  });

  it("atomically downgrades the same cloud lifecycle row only after upstream close succeeds", async () => {
    const cloud = row({
      mode: "LINGMOU_CLOUD",
      adapter: "LINGMOU_OFFICIAL_SDK",
      providerId: "lingmou-provider",
      modelId: "lingmou-model",
      providerSessionId: "provider-session-1",
      instanceId: "instance-id",
      providerConfigVersion: 0
    });
    const { rows, provider, service } = harness([cloud]);

    const result = await service.downgradeDigitalHumanSession(
      "digital-1",
      "CLIENT_SDK_INIT_FAILED"
    );

    expect(provider.closeSession).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      id: "digital-1",
      mode: "LOCAL_AVATAR",
      status: "READY",
      reasonCode: "CLIENT_SDK_INIT_FAILED",
      connection: null
    });
    expect(rows.get("digital-1")).toMatchObject({
      mode: "LOCAL_AVATAR",
      adapter: "LOCAL",
      status: "READY",
      providerId: null,
      modelId: null,
      providerSessionId: null,
      instanceId: null,
      providerConfigVersion: null
    });
  });

  it("keeps cloud recovery identity FAILED when atomic downgrade close fails", async () => {
    const cloud = row({
      mode: "LINGMOU_CLOUD",
      adapter: "LINGMOU_OFFICIAL_SDK",
      providerId: "lingmou-provider",
      modelId: "lingmou-model",
      providerSessionId: "provider-session-1",
      instanceId: "instance-id",
      providerConfigVersion: 0
    });
    const { rows, provider, service } = harness([cloud]);
    provider.closeSession.mockRejectedValue(new Error("raw close secret"));

    await expect(
      service.downgradeDigitalHumanSession(
        "digital-1",
        "CLIENT_PCM_PUSH_FAILED"
      )
    ).rejects.toMatchObject({
      code: "DIGITAL_HUMAN_DOWNGRADE_FAILED",
      status: 503
    });
    expect(rows.get("digital-1")).toMatchObject({
      mode: "LINGMOU_CLOUD",
      status: "FAILED",
      providerId: "lingmou-provider",
      modelId: "lingmou-model",
      providerSessionId: "provider-session-1",
      instanceId: "instance-id",
      providerConfigVersion: 0
    });
  });

  it("coalesces concurrent atomic downgrade requests into exactly one upstream close", async () => {
    const cloud = row({
      mode: "LINGMOU_CLOUD",
      adapter: "LINGMOU_OFFICIAL_SDK",
      providerId: "lingmou-provider",
      modelId: "lingmou-model",
      providerSessionId: "provider-session-1",
      instanceId: "instance-id",
      providerConfigVersion: 0
    });
    const { provider, service, serviceDependencies } = harness([cloud]);
    const other = createDigitalHumanSessionService(serviceDependencies);
    let release: () => void = () => undefined;
    provider.closeSession.mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; })
    );

    const first = service.downgradeDigitalHumanSession(
      "digital-1",
      "CLIENT_PCM_PUSH_FAILED"
    );
    await vi.waitFor(() => expect(provider.closeSession).toHaveBeenCalledOnce());
    const second = other.downgradeDigitalHumanSession(
      "digital-1",
      "CLIENT_PCM_PUSH_FAILED"
    );
    release();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(provider.closeSession).toHaveBeenCalledOnce();
    expect(second).toBe(first);
  });

  it("closes with the persisted provider and instance identity", async () => {
    const cloud = row({
      providerId: "lingmou-provider",
      modelId: "deleted-or-disabled-model",
      adapter: "LINGMOU_OFFICIAL_SDK",
      mode: "LINGMOU_CLOUD",
      providerSessionId: "provider-session-1",
      instanceId: "persisted-instance-id"
    });
    const { repository, createSessionCloser, service } = harness([cloud]);

    await service.stopDigitalHumanSession("digital-1", "CLIENT_EXIT");

    expect(repository.findCloseProvider).toHaveBeenCalledWith(
      "lingmou-provider"
    );
    expect(createSessionCloser).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: "LINGMOU",
        providerSettings: { region: "cn-beijing" }
      }),
      "persisted-instance-id"
    );
  });

  it("rejects an ended training session before any provider call", async () => {
    const { repository, resolveRealtimeModel, provider, service } = harness();
    repository.findTrainingSession.mockResolvedValue({
      id: "training-1",
      status: "COMPLETED"
    });

    await expect(service.createDigitalHumanSession("training-1")).rejects.toMatchObject({
      code: "TRAINING_SESSION_INACTIVE"
    });
    expect(resolveRealtimeModel).not.toHaveBeenCalled();
    expect(provider.createSession).not.toHaveBeenCalled();
  });

  it("serializes concurrent creation for the same training session", async () => {
    const { rows, provider, service } = harness();
    let inFlight = 0;
    let maxInFlight = 0;
    let cloudSequence = 0;
    provider.createSession.mockImplementation(async () => {
      const sequence = ++cloudSequence;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return {
        providerSessionId: `provider-session-${sequence}`,
        connection: {
          ...connection,
          sessionId: `provider-session-${sequence}`
        }
      };
    });

    await Promise.all([
      service.createDigitalHumanSession("training-1"),
      service.createDigitalHumanSession("training-1")
    ]);

    expect(maxInFlight).toBe(1);
    expect(
      [...rows.values()].filter((session) => session.status !== "STOPPED")
    ).toHaveLength(1);
    expect(provider.closeSession).toHaveBeenCalledWith("provider-session-1");
  });

  it("maps a database active-session claim conflict to a safe response", async () => {
    const { repository, provider, service } = harness();
    repository.createSession.mockRejectedValueOnce({ code: "P2002" });

    await expect(
      service.createDigitalHumanSession("training-1")
    ).rejects.toMatchObject({
      code: "DIGITAL_HUMAN_ACTIVE_CONFLICT",
      status: 409
    });
    expect(provider.createSession).not.toHaveBeenCalled();
  });

  it("stops every active cloud session during server shutdown", async () => {
    const cloudReady = row({
      id: "cloud-ready",
      mode: "LINGMOU_CLOUD",
      providerId: "lingmou-provider",
      providerSessionId: "provider-ready",
      instanceId: "instance-id"
    });
    const cloudFailed = row({
      id: "cloud-failed",
      mode: "LINGMOU_CLOUD",
      providerId: "lingmou-provider",
      providerSessionId: "provider-failed",
      instanceId: "instance-id",
      status: "FAILED"
    });
    const local = row({ id: "local-ready" });
    const { rows, provider, service } = harness([cloudReady, cloudFailed, local]);

    await service.stopAllActiveDigitalHumanSessions("SERVER_SHUTDOWN");

    expect(provider.closeSession).toHaveBeenCalledTimes(2);
    expect(rows.get("cloud-ready")).toMatchObject({
      status: "STOPPED",
      stopReason: "SERVER_SHUTDOWN"
    });
    expect(rows.get("cloud-failed")).toMatchObject({
      status: "STOPPED",
      stopReason: "SERVER_SHUTDOWN"
    });
    expect(rows.get("local-ready")).toMatchObject({ status: "READY" });
  });

  it("reaps idle, hard-expired, and backoff-due FAILED cloud sessions", async () => {
    const idle = row({
      id: "cloud-idle",
      mode: "LINGMOU_CLOUD",
      providerId: "lingmou-provider",
      providerSessionId: "provider-idle",
      instanceId: "instance-id",
      lastActivityAt: new Date(now.getTime() - 120_000)
    });
    const expired = row({
      id: "cloud-expired",
      mode: "LINGMOU_CLOUD",
      providerId: "lingmou-provider",
      providerSessionId: "provider-expired",
      instanceId: "instance-id",
      expiresAt: new Date(now.getTime() - 1),
      lastActivityAt: now
    });
    const failed = row({
      id: "cloud-failed",
      mode: "LINGMOU_CLOUD",
      providerId: "lingmou-provider",
      providerSessionId: "provider-failed",
      instanceId: "instance-id",
      status: "FAILED",
      updatedAt: new Date(now.getTime() - 31_000)
    });
    const { rows, repository, provider, service } = harness([
      idle,
      expired,
      failed
    ]);
    repository.findReapableSessions.mockResolvedValue([idle, expired, failed]);

    await expect(service.reapDigitalHumanSessions(now)).resolves.toBe(3);

    expect(repository.findReapableSessions).toHaveBeenCalledWith(
      now,
      new Date(now.getTime() - 60_000),
      new Date(now.getTime() - 30_000)
    );
    expect(provider.closeSession).toHaveBeenCalledTimes(3);
    expect(rows.get("cloud-idle")?.stopReason).toBe("IDLE_TIMEOUT");
    expect(rows.get("cloud-expired")?.stopReason).toBe("SESSION_EXPIRED");
    expect(rows.get("cloud-failed")?.stopReason).toBe("RECOVERY_RETRY");
  });

  it("immediately closes recoverable cloud sessions after startup recovery", async () => {
    const cloud = row({
      mode: "LINGMOU_CLOUD",
      providerId: "lingmou-provider",
      providerSessionId: "provider-session-1",
      instanceId: "instance-id",
      status: "FAILED"
    });
    const { repository, provider, service } = harness([cloud]);
    repository.failUnrecoverableSessions.mockResolvedValue(1);

    await expect(
      service.recoverDigitalHumanSessionsAfterStartup(now)
    ).resolves.toBe(1);

    expect(repository.failUnrecoverableSessions).toHaveBeenCalledWith(now);
    expect(provider.closeSession).toHaveBeenCalledWith("provider-session-1");
  });

  it("starts one unref'ed 30-second reaper and stops it idempotently", () => {
    const unref = vi.fn();
    const interval = { unref } as unknown as ReturnType<typeof setInterval>;
    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue(interval);
    const clearIntervalSpy = vi
      .spyOn(globalThis, "clearInterval")
      .mockImplementation(() => undefined);

    const stopFirst = startDigitalHumanSessionReaper();
    const stopSecond = startDigitalHumanSessionReaper();

    expect(stopSecond).toBe(stopFirst);
    expect(setIntervalSpy).toHaveBeenCalledOnce();
    expect(setIntervalSpy.mock.calls[0]?.[1]).toBe(30_000);
    expect(unref).toHaveBeenCalledOnce();

    stopFirst();
    stopSecond();

    expect(clearIntervalSpy).toHaveBeenCalledOnce();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it("coalesces concurrent close requests while one provider close is in flight", async () => {
    const cloud = row({
      mode: "LINGMOU_CLOUD",
      providerId: "lingmou-provider",
      providerSessionId: "provider-session-1",
      instanceId: "instance-id"
    });
    const { rows, provider, service } = harness([cloud]);
    let releaseClose: () => void = () => undefined;
    provider.closeSession.mockImplementation(
      () => new Promise<void>((resolve) => { releaseClose = resolve; })
    );

    const first = service.stopDigitalHumanSession("digital-1", "CLIENT_EXIT");
    await vi.waitFor(() =>
      expect(rows.get("digital-1")?.status).toBe("STOPPING")
    );
    const second = service.stopDigitalHumanSession("digital-1", "CLIENT_EXIT");
    await Promise.resolve();
    releaseClose();

    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined
    ]);
    expect(provider.closeSession).toHaveBeenCalledOnce();
    expect(rows.get("digital-1")?.status).toBe("STOPPED");
  });

  it("shares the actual in-flight close promise across service instances beyond 500ms", async () => {
    vi.useFakeTimers();
    const cloud = row({
      mode: "LINGMOU_CLOUD",
      providerId: "lingmou-provider",
      providerSessionId: "provider-session-1",
      instanceId: "instance-id"
    });
    const { rows, provider, service, serviceDependencies } = harness([cloud]);
    const otherService = createDigitalHumanSessionService(serviceDependencies);
    let releaseClose: () => void = () => undefined;
    provider.closeSession.mockImplementation(
      () => new Promise<void>((resolve) => { releaseClose = resolve; })
    );

    const first = service.stopDigitalHumanSession("digital-1", "IDLE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(0);
    const second = otherService.stopDigitalHumanSession(
      "digital-1",
      "SERVER_SHUTDOWN"
    );
    const samePromise = second === first;
    let secondOutcome = "pending";
    const trackedSecond = second.then(
      () => { secondOutcome = "fulfilled"; },
      () => { secondOutcome = "rejected"; }
    );

    await vi.advanceTimersByTimeAsync(600);
    const outcomeBeforeRelease = secondOutcome;
    releaseClose();
    await vi.advanceTimersByTimeAsync(0);
    await first;
    await trackedSecond;
    vi.useRealTimers();

    expect(samePromise).toBe(true);
    expect(outcomeBeforeRelease).toBe("pending");
    expect(provider.closeSession).toHaveBeenCalledOnce();
    expect(rows.get("digital-1")?.status).toBe("STOPPED");
  });

  it("does not close the app while a reaper-owned SDK close is still draining", async () => {
    vi.useFakeTimers();
    const cloud = row({
      mode: "LINGMOU_CLOUD",
      providerId: "lingmou-provider",
      providerSessionId: "provider-session-1",
      instanceId: "instance-id",
      lastActivityAt: new Date(now.getTime() - 120_000)
    });
    const {
      repository,
      provider,
      service,
      serviceDependencies
    } = harness([cloud]);
    repository.findReapableSessions.mockResolvedValue([cloud]);
    const shutdownService = createDigitalHumanSessionService(
      serviceDependencies
    );
    let releaseClose: () => void = () => undefined;
    provider.closeSession.mockImplementation(
      () => new Promise<void>((resolve) => { releaseClose = resolve; })
    );
    const reaperTick = service.reapDigitalHumanSessions(now);
    await vi.advanceTimersByTimeAsync(0);
    const closeApp = vi.fn().mockResolvedValue(undefined);
    const shutdown = createServerShutdown({
      stopReaper: () => reaperTick,
      closeWebSockets: vi.fn().mockResolvedValue(undefined),
      stopHttpAccept: vi.fn().mockResolvedValue(undefined),
      stopCloudSessions: () =>
        shutdownService.stopAllActiveDigitalHumanSessions("SERVER_SHUTDOWN"),
      closeApp,
      warn: vi.fn(),
      timeoutMs: 2_000
    });

    const pendingShutdown = shutdown();
    await vi.advanceTimersByTimeAsync(600);
    const appClosedBeforeRelease = closeApp.mock.calls.length > 0;
    releaseClose();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([reaperTick, pendingShutdown]);
    vi.useRealTimers();

    expect(appClosedBeforeRelease).toBe(false);
    expect(provider.closeSession).toHaveBeenCalledOnce();
    expect(closeApp).toHaveBeenCalledOnce();
  });
});
