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
    digitalHumanSessionId: "digital-session-1",
    attemptCount: 0,
    nextAttemptAt: now,
    claimExpiresAt: null,
    lastErrorCode: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function harness(rows = [recoveryRow()]) {
  const repository = {
    upsert: vi.fn().mockResolvedValue(recoveryRow()),
    createClaim: vi.fn().mockResolvedValue(recoveryRow({
      digitalHumanSessionId: null,
      providerSessionId: null
    })),
    attach: vi.fn().mockResolvedValue(true),
    renewClaim: vi.fn().mockResolvedValue(true),
    expireClaims: vi.fn().mockResolvedValue([]),
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
    complete: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined)
  };
  const closeSession = vi.fn().mockResolvedValue(undefined);
  const createSessionCloser = vi.fn(() => ({ closeSession }));
  const auditUnknownClaim = vi.fn();
  const service = createProviderSessionCloseRecoveryService({
    repository,
    createSessionCloser,
    auditUnknownClaim,
    now: () => now
  });
  return {
    repository,
    closeSession,
    createSessionCloser,
    auditUnknownClaim,
    service
  };
}

describe("provider session close recovery queue", () => {
  it("durably upserts only the bounded upstream close identity", async () => {
    const { repository, service } = harness([]);

    await service.enqueue({
      providerId: " provider-1 ",
      providerSessionId: " upstream-session-1 ",
      instanceId: " instance-1 ",
      providerConfigVersion: 3,
      reasonCode: "CREATE_COMPENSATION_FAILED",
      digitalHumanSessionId: "digital-session-1"
    });

    expect(repository.upsert).toHaveBeenCalledWith({
      providerId: "provider-1",
      providerSessionId: "upstream-session-1",
      instanceId: "instance-1",
      providerConfigVersion: 3,
      reasonCode: "CREATE_COMPENSATION_FAILED",
      digitalHumanSessionId: "digital-session-1",
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

  it("creates and renews a bounded null-session claim lease", async () => {
    const { repository, service } = harness([]);

    await service.createClaim({
      providerId: "provider-1",
      instanceId: "instance-1",
      providerConfigVersion: 3,
      reasonCode: "DIAGNOSTIC_LIVE_OPERATION",
      leaseMs: 60_000
    });
    await service.renewClaim("recovery-1", 60_000);

    expect(repository.createClaim).toHaveBeenCalledWith({
      providerId: "provider-1",
      instanceId: "instance-1",
      providerConfigVersion: 3,
      reasonCode: "DIAGNOSTIC_LIVE_OPERATION",
      nextAttemptAt: now,
      claimExpiresAt: new Date(now.getTime() + 60_000)
    });
    expect(repository.renewClaim).toHaveBeenCalledWith(
      "recovery-1",
      new Date(now.getTime() + 60_000)
    );
  });

  it("expires abandoned null-session claims with a fixed UNKNOWN_UPSTREAM audit", async () => {
    const { repository, auditUnknownClaim, service } = harness([]);
    repository.expireClaims.mockResolvedValue([
      { id: "claim-expired-1" },
      { id: "claim-expired-2" }
    ]);

    await expect(service.drainDue(now)).resolves.toBe(0);

    expect(repository.expireClaims).toHaveBeenCalledWith(now);
    expect(auditUnknownClaim.mock.calls).toEqual([
      ["claim-expired-1"],
      ["claim-expired-2"]
    ]);
  });

  it("clears the null-claim lease when an upstream identity attaches", async () => {
    const { repository, service } = harness([]);

    await service.attach(
      "recovery-1",
      "upstream-session-1",
      "DIAGNOSTIC_LIVE_OPERATION"
    );

    expect(repository.attach).toHaveBeenCalledWith("recovery-1", {
      providerSessionId: "upstream-session-1",
      reasonCode: "DIAGNOSTIC_LIVE_OPERATION",
      nextAttemptAt: now,
      claimExpiresAt: null
    });
  });

  it("keeps the claim when ambiguous attach commits make fallback upsert return the same row", async () => {
    const { repository, service } = harness([]);
    repository.attach.mockRejectedValue(new Error("ambiguous commit"));
    repository.upsert.mockResolvedValue(recoveryRow({
      id: "recovery-1",
      digitalHumanSessionId: null
    }));

    const result = await service.persistClaimIdentity(
      "recovery-1",
      {
        providerId: "provider-1",
        providerSessionId: "upstream-session-1",
        instanceId: "instance-1",
        providerConfigVersion: 3,
        reasonCode: "DIAGNOSTIC_LIVE_CLOSE_FAILED"
      },
      2
    );

    expect(result).toEqual({ owner: "CLAIM", attachFailed: true });
    expect(repository.attach).toHaveBeenCalledTimes(2);
    expect(repository.upsert).toHaveBeenCalledOnce();
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it("closes each due upstream session and terminalizes its linked lifecycle atomically", async () => {
    const { repository, closeSession, createSessionCloser, service } = harness();

    await expect(service.drainDue(now)).resolves.toBe(1);

    expect(createSessionCloser).toHaveBeenCalledWith(
      expect.objectContaining({ providerType: "LINGMOU" }),
      "instance-1"
    );
    expect(closeSession).toHaveBeenCalledOnce();
    expect(closeSession).toHaveBeenCalledWith("upstream-session-1");
    expect(repository.complete).toHaveBeenCalledWith(
      "recovery-1",
      "digital-session-1",
      now
    );
    expect(repository.delete).not.toHaveBeenCalled();
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
    expect(repository.complete).toHaveBeenCalledOnce();
  });
});
