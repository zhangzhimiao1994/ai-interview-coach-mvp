import { describe, expect, it, vi } from "vitest";
import {
  createProviderSessionCloseRecoveryService,
  ProviderSessionCloseRecoveryPersistenceError
} from "@/lib/media/providerSessionCloseRecoveries";

const now = new Date("2026-07-18T04:00:00.000Z");

function recoveryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "recovery-1",
    providerId: "provider-1",
    providerSessionId: "upstream-session-1",
    instanceId: "instance-1",
    providerConfigVersion: 3,
    reasonCode: "CREATE_COMPENSATION_FAILED",
    attemptCount: 0,
    nextAttemptAt: now,
    lastErrorCode: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function harness(rows = [recoveryRow()]) {
  const repository = {
    upsert: vi.fn().mockResolvedValue(recoveryRow()),
    findDue: vi.fn().mockResolvedValue(rows),
    findProvider: vi.fn().mockResolvedValue({
      id: "provider-1",
      providerType: "LINGMOU",
      settingsJson: JSON.stringify({ region: "cn-beijing" }),
      closeConfigVersion: 3,
      credentialsCiphertext: "ciphertext",
      credentialsIv: "iv",
      credentialsTag: "tag"
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined)
  };
  const closeSession = vi.fn().mockResolvedValue(undefined);
  const createSessionCloser = vi.fn(() => ({ closeSession }));
  const service = createProviderSessionCloseRecoveryService({
    repository,
    createSessionCloser,
    now: () => now
  });
  return { repository, closeSession, createSessionCloser, service };
}

describe("provider session close recovery queue", () => {
  it("durably upserts only the bounded upstream close identity", async () => {
    const { repository, service } = harness([]);

    await service.enqueue({
      providerId: " provider-1 ",
      providerSessionId: " upstream-session-1 ",
      instanceId: " instance-1 ",
      providerConfigVersion: 3,
      reasonCode: "CREATE_COMPENSATION_FAILED"
    });

    expect(repository.upsert).toHaveBeenCalledWith({
      providerId: "provider-1",
      providerSessionId: "upstream-session-1",
      instanceId: "instance-1",
      providerConfigVersion: 3,
      reasonCode: "CREATE_COMPENSATION_FAILED",
      nextAttemptAt: now
    });
    expect(JSON.stringify(repository.upsert.mock.calls[0]?.[0])).not.toMatch(
      /token|accessKey|secret|rtcParams|audio/i
    );
  });

  it("throws a fixed operational code when the durable enqueue itself fails", async () => {
    const { repository, service } = harness([]);
    repository.upsert.mockRejectedValue(new Error("raw database secret sentinel"));

    const error = await service.enqueue({
      providerId: "provider-1",
      providerSessionId: "upstream-session-1",
      instanceId: "instance-1",
      providerConfigVersion: 3,
      reasonCode: "CREATE_COMPENSATION_FAILED"
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderSessionCloseRecoveryPersistenceError);
    expect(error).toMatchObject({
      code: "DIGITAL_HUMAN_RECOVERY_QUEUE_PERSIST_FAILED"
    });
    expect(String(error)).not.toContain("database secret sentinel");
  });

  it("closes each due upstream session and deletes successful recovery work", async () => {
    const { repository, closeSession, createSessionCloser, service } = harness();

    await expect(service.drainDue(now)).resolves.toBe(1);

    expect(createSessionCloser).toHaveBeenCalledWith(
      expect.objectContaining({ providerType: "LINGMOU" }),
      "instance-1"
    );
    expect(closeSession).toHaveBeenCalledOnce();
    expect(closeSession).toHaveBeenCalledWith("upstream-session-1");
    expect(repository.delete).toHaveBeenCalledWith("recovery-1");
    expect(repository.recordFailure).not.toHaveBeenCalled();
  });

  it("records only a safe error code and bounded exponential backoff", async () => {
    const { repository, closeSession, service } = harness([
      recoveryRow({ attemptCount: 7 })
    ]);
    closeSession.mockRejectedValue(new Error("raw access-key sentinel"));

    await expect(service.drainDue(now)).resolves.toBe(0);

    expect(repository.recordFailure).toHaveBeenCalledWith("recovery-1", {
      attemptCount: 8,
      nextAttemptAt: new Date(now.getTime() + 300_000),
      lastErrorCode: "LINGMOU_RECOVERY_CLOSE_FAILED"
    });
    expect(JSON.stringify(repository.recordFailure.mock.calls)).not.toContain(
      "access-key sentinel"
    );
  });

  it("shares one in-flight close across concurrent drains and service instances", async () => {
    const { repository, closeSession, createSessionCloser, service } = harness();
    let release: () => void = () => undefined;
    closeSession.mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; })
    );
    const other = createProviderSessionCloseRecoveryService({
      repository,
      createSessionCloser,
      now: () => now
    });

    const first = service.drainDue(now);
    await vi.waitFor(() => expect(closeSession).toHaveBeenCalledOnce());
    const second = other.drainDue(now);
    await Promise.resolve();
    release();

    await expect(Promise.all([first, second])).resolves.toEqual([1, 1]);
    expect(closeSession).toHaveBeenCalledOnce();
    expect(repository.delete).toHaveBeenCalledOnce();
  });
});
