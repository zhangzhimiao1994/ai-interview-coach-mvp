import { describe, expect, it, vi } from "vitest";
import { MediaConfigurationError, MediaProviderError } from "@/lib/media/errors";
import type { ResolvedMediaModel } from "@/lib/media/config";
import {
  createDigitalHumanSessionService,
  isValidDigitalHumanSessionTransition
} from "@/lib/media/digitalHumanSessions";

type RecordRow = {
  id: string;
  trainingSessionId: string;
  providerId: string | null;
  modelId: string | null;
  adapter: string;
  mode: string;
  providerSessionId: string | null;
  instanceId: string | null;
  status: string;
  lastActivityAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  stopReason: string | null;
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

function realtimeModel(): ResolvedMediaModel {
  return {
    capability: "DIGITAL_HUMAN_REALTIME",
    providerId: "lingmou-provider",
    providerName: "Lingmou",
    providerType: "LINGMOU",
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

function harness(initial: RecordRow[] = []) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  let sequence = initial.length;
  const closeSession = vi.fn().mockResolvedValue(undefined);
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
    findIdleSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn(async (data: Omit<RecordRow, "id" | "endedAt" | "stopReason">) => {
      const row: RecordRow = {
        ...data,
        id: `digital-${++sequence}`,
        endedAt: null,
        stopReason: null
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
  const provider = { createSession, closeSession };
  const createSessionCloser = vi.fn(() => ({ closeSession }));
  const service = createDigitalHumanSessionService({
    repository,
    resolveRealtimeModel,
    createProvider: vi.fn(() => provider),
    createSessionCloser,
    now: () => now
  });

  return {
    rows,
    repository,
    resolveRealtimeModel,
    provider,
    createSessionCloser,
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
    status: "READY",
    lastActivityAt: now,
    expiresAt: new Date(now.getTime() + 15 * 60_000),
    endedAt: null,
    stopReason: null,
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
    expect(isValidDigitalHumanSessionTransition("STOPPING", "READY")).toBe(false);
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

  it("compensatingly closes a cloud session when the local READY update fails", async () => {
    const { rows, repository, provider, service } = harness();
    repository.transitionSession.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(service.createDigitalHumanSession("training-1")).rejects.toThrow(
      "Digital human session could not be persisted"
    );
    expect(provider.closeSession).toHaveBeenCalledOnce();
    expect(provider.closeSession).toHaveBeenCalledWith("provider-session-1");
    expect(rows.get("digital-1")).toMatchObject({
      status: "FAILED",
      stopReason: "CLOUD_PERSIST_FAILED",
      endedAt: now
    });
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
});
