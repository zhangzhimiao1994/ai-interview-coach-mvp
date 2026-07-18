import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  createDigitalHumanSessionService,
  createPrismaDigitalHumanSessionRepository
} from "@/lib/media/digitalHumanSessions";
import {
  createPrismaProviderSessionCloseRecoveryRepository,
  createProviderSessionCloseRecoveryService,
  ProviderSessionCloseRecoveryPersistenceError
} from "@/lib/media/providerSessionCloseRecoveries";

const root = process.cwd();
const prismaDirectory = join(root, "prisma");
const migrationsDirectory = join(prismaDirectory, "migrations");
const prismaCliPath = join(root, "node_modules/prisma/build/index.js");

function applyMigrations(databaseUrl: string, temporaryDirectory: string) {
  const setupPath = join(temporaryDirectory, "setup.sql");
  const sql = readdirSync(migrationsDirectory)
    .filter((directory) => /^\d/.test(directory))
    .sort()
    .map((directory) =>
      readFileSync(join(migrationsDirectory, directory, "migration.sql"), "utf8")
    )
    .join("\n");
  writeFileSync(setupPath, sql, "utf8");
  execFileSync(
    process.execPath,
    [prismaCliPath, "db", "execute", "--file", setupPath, "--url", databaseUrl],
    { cwd: prismaDirectory, stdio: "pipe" }
  );
}

async function seedProvider(prisma: PrismaClient) {
  return prisma.aiServiceProvider.create({
    data: {
      id: "provider-1",
      displayName: "Lingmou",
      providerType: "LINGMOU",
      settingsJson: '{"region":"cn-beijing"}',
      credentialsCiphertext: "ciphertext",
      credentialsIv: "iv",
      credentialsTag: "tag"
    }
  });
}

async function withTemporaryPrisma(
  run: (prisma: PrismaClient) => Promise<void>
) {
  const temporaryDirectory = mkdtempSync(join(prismaDirectory, ".close-service-"));
  const databaseUrl = `file:./${basename(temporaryDirectory)}/service.db`;
  let prisma: PrismaClient | undefined;
  try {
    applyMigrations(databaseUrl, temporaryDirectory);
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await run(prisma);
  } finally {
    try {
      await prisma?.$disconnect();
    } finally {
      rmSync(temporaryDirectory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
      });
    }
  }
}

describe("provider recovery service with Prisma SQLite", () => {
  it("serializes provider mutation and live-operation claims in both orderings", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedProvider(prisma);
      const now = new Date("2026-07-18T04:00:00.000Z");
      const auditUnknownClaim = vi.fn();
      const service = createProviderSessionCloseRecoveryService({
        repository: createPrismaProviderSessionCloseRecoveryRepository(prisma),
        auditUnknownClaim,
        now: () => now
      });

      await prisma.aiServiceProvider.update({
        where: { id: "provider-1" },
        data: { settingsJson: '{"region":"cn-shanghai"}' }
      });
      await expect(service.createClaim({
        providerId: "provider-1",
        instanceId: "instance-1",
        providerConfigVersion: 0,
        reasonCode: "DIAGNOSTIC_LIVE_OPERATION",
        leaseMs: 60_000
      })).rejects.toBeInstanceOf(ProviderSessionCloseRecoveryPersistenceError);
      expect(await prisma.providerSessionCloseRecovery.count()).toBe(0);

      const claim = await service.createClaim({
        providerId: "provider-1",
        instanceId: "instance-1",
        providerConfigVersion: 1,
        reasonCode: "DIAGNOSTIC_LIVE_OPERATION",
        leaseMs: 60_000
      });
      await expect(prisma.aiServiceProvider.update({
        where: { id: "provider-1" },
        data: { settingsJson: '{"region":"cn-beijing"}' }
      })).rejects.toThrow();
      expect(await prisma.providerSessionCloseRecovery.findUnique({
        where: { id: claim.id }
      })).toMatchObject({
        providerSessionId: null,
        providerConfigVersion: 1,
        claimExpiresAt: new Date(now.getTime() + 60_000)
      });

      await expect(service.drainDue(new Date(now.getTime() + 59_999))).resolves.toBe(0);
      await expect(prisma.aiServiceProvider.update({
        where: { id: "provider-1" },
        data: { settingsJson: '{"region":"cn-beijing"}' }
      })).rejects.toThrow();
      expect(auditUnknownClaim).not.toHaveBeenCalled();

      await expect(service.drainDue(new Date(now.getTime() + 60_000))).resolves.toBe(0);
      expect(auditUnknownClaim).toHaveBeenCalledWith(claim.id);
      expect(await prisma.providerSessionCloseRecovery.count()).toBe(0);
      await expect(prisma.aiServiceProvider.update({
        where: { id: "provider-1" },
        data: { settingsJson: '{"region":"cn-beijing"}' }
      })).resolves.toMatchObject({ id: "provider-1" });
      await expect(prisma.aiServiceProvider.findUnique({
        where: { id: "provider-1" }
      })).resolves.toMatchObject({ closeConfigVersion: 2 });
    });
  }, 30_000);

  it("gives a linked queue priority after an ambiguous enqueue commit and terminalizes or retries consistently", async () => {
    await withTemporaryPrisma(async (prisma) => {
      const provider = await seedProvider(prisma);
      const candidate = await prisma.candidate.create({
        data: { id: "candidate-1", name: "Candidate" }
      });
      const task = await prisma.trainingTask.create({
        data: {
          id: "task-1",
          candidateId: candidate.id,
          title: "Interview",
          targetCompany: "Company",
          targetRole: "Engineer",
          stageConfig: "[]",
          expectedMinutes: 30
        }
      });
      await prisma.trainingSession.createMany({
        data: ["success", "retry"].map((suffix) => ({
          id: `training-${suffix}`,
          taskId: task.id,
          candidateId: candidate.id
        }))
      });
      const now = new Date("2026-07-18T04:00:00.000Z");
      const base = {
        providerId: provider.id,
        modelId: "model-1",
        adapter: "LINGMOU_OFFICIAL_SDK",
        mode: "LINGMOU_CLOUD",
        providerSessionId: null,
        instanceId: "instance-1",
        providerConfigVersion: 0,
        status: "FAILED",
        lastActivityAt: now,
        expiresAt: new Date(now.getTime() - 1),
        endedAt: now,
        stopReason: "CREATE_COMPENSATION_FAILED",
        updatedAt: new Date(now.getTime() - 60_000)
      };
      await prisma.digitalHumanSession.createMany({
        data: [
          {
            ...base,
            id: "digital-success",
            trainingSessionId: "training-success",
            providerSessionId: "upstream-success"
          },
          { ...base, id: "digital-retry", trainingSessionId: "training-retry" }
        ]
      });

      const closeSession = vi.fn().mockResolvedValue(undefined);
      const closer = () => ({ closeSession });
      const recovery = createProviderSessionCloseRecoveryService({
        repository: createPrismaProviderSessionCloseRecoveryRepository(prisma),
        createSessionCloser: closer,
        now: () => now
      });
      const sessions = createDigitalHumanSessionService({
        repository: createPrismaDigitalHumanSessionRepository(prisma),
        createSessionCloser: closer,
        now: () => now
      });
      await recovery.enqueue({
        providerId: provider.id,
        providerSessionId: "upstream-success",
        instanceId: "instance-1",
        providerConfigVersion: 0,
        reasonCode: "CREATE_COMPENSATION_FAILED",
        digitalHumanSessionId: "digital-success"
      });

      await expect(Promise.all([
        sessions.reapDigitalHumanSessions(now),
        recovery.drainDue(now)
      ])).resolves.toEqual([0, 1]);
      expect(closeSession).toHaveBeenCalledTimes(1);
      expect(await prisma.digitalHumanSession.findUnique({
        where: { id: "digital-success" }
      })).toMatchObject({
        status: "STOPPED",
        providerId: null,
        modelId: null,
        providerSessionId: null,
        instanceId: null,
        providerConfigVersion: null,
        stopReason: "PROVIDER_SESSION_RECOVERED"
      });
      expect(await prisma.providerSessionCloseRecovery.count({
        where: { digitalHumanSessionId: "digital-success" }
      })).toBe(0);

      await recovery.enqueue({
        providerId: provider.id,
        providerSessionId: "upstream-retry",
        instanceId: "instance-1",
        providerConfigVersion: 0,
        reasonCode: "CREATE_COMPENSATION_FAILED",
        digitalHumanSessionId: "digital-retry"
      });
      closeSession.mockRejectedValueOnce(new Error("raw close secret"));
      await expect(Promise.all([
        sessions.reapDigitalHumanSessions(now),
        recovery.drainDue(now)
      ])).resolves.toEqual([0, 0]);
      expect(closeSession).toHaveBeenCalledTimes(2);
      expect(await prisma.digitalHumanSession.findUnique({
        where: { id: "digital-retry" }
      })).toMatchObject({ status: "FAILED", providerSessionId: null });
      expect(await prisma.providerSessionCloseRecovery.findFirst({
        where: { digitalHumanSessionId: "digital-retry" }
      })).toMatchObject({
        providerSessionId: "upstream-retry",
        attemptCount: 1,
        nextAttemptAt: new Date(now.getTime() + 5_000),
        lastErrorCode: "LINGMOU_RECOVERY_CLOSE_FAILED"
      });

      await expect(recovery.drainDue(new Date(now.getTime() + 4_999))).resolves.toBe(0);
      expect(closeSession).toHaveBeenCalledTimes(2);
      await expect(recovery.drainDue(new Date(now.getTime() + 5_000))).resolves.toBe(1);
      expect(closeSession).toHaveBeenCalledTimes(3);
      expect(await prisma.digitalHumanSession.findUnique({
        where: { id: "digital-retry" }
      })).toMatchObject({ status: "STOPPED", providerSessionId: null });
      expect(await prisma.providerSessionCloseRecovery.count({
        where: { digitalHumanSessionId: "digital-retry" }
      })).toBe(0);
    });
  }, 30_000);

  it("confirms repeated enqueue ownership with one idempotent durable row", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedProvider(prisma);
      const service = createProviderSessionCloseRecoveryService({
        repository: createPrismaProviderSessionCloseRecoveryRepository(prisma)
      });
      const input = {
        providerId: "provider-1",
        providerSessionId: "upstream-idempotent",
        instanceId: "instance-1",
        providerConfigVersion: 0,
        reasonCode: "CREATE_COMPENSATION_FAILED"
      };

      const first = await service.enqueue(input);
      const second = await service.enqueue(input);

      expect(second.id).toBe(first.id);
      expect(await prisma.providerSessionCloseRecovery.count({
        where: {
          providerId: input.providerId,
          providerSessionId: input.providerSessionId,
          instanceId: input.instanceId
        }
      })).toBe(1);
    });
  }, 30_000);

  it("retains an ambiguously attached claim and drains its known identity once", async () => {
    await withTemporaryPrisma(async (prisma) => {
      await seedProvider(prisma);
      const now = new Date("2026-07-18T04:00:00.000Z");
      const repository = createPrismaProviderSessionCloseRecoveryRepository(prisma);
      const ambiguousRepository = {
        ...repository,
        async attach(
          id: string,
          data: Parameters<typeof repository.attach>[1]
        ) {
          await repository.attach(id, data);
          throw new Error("commit acknowledged as failed");
        }
      };
      const ambiguous = createProviderSessionCloseRecoveryService({
        repository: ambiguousRepository,
        now: () => now
      });
      const claim = await ambiguous.createClaim({
        providerId: "provider-1",
        instanceId: "instance-1",
        providerConfigVersion: 0,
        reasonCode: "DIAGNOSTIC_LIVE_OPERATION",
        leaseMs: 60_000
      });

      await expect(ambiguous.persistClaimIdentity(
        claim.id,
        {
          providerId: "provider-1",
          providerSessionId: "ambiguous-upstream",
          instanceId: "instance-1",
          providerConfigVersion: 0,
          reasonCode: "DIAGNOSTIC_LIVE_CLOSE_FAILED"
        },
        2
      )).resolves.toEqual({ owner: "CLAIM", attachFailed: true });

      expect(await prisma.providerSessionCloseRecovery.findMany()).toEqual([
        expect.objectContaining({
          id: claim.id,
          providerSessionId: "ambiguous-upstream",
          claimExpiresAt: null
        })
      ]);
      const closeSession = vi.fn().mockResolvedValue(undefined);
      const recovery = createProviderSessionCloseRecoveryService({
        repository,
        createSessionCloser: () => ({ closeSession }),
        now: () => now
      });

      await expect(recovery.drainDue(now)).resolves.toBe(1);
      expect(closeSession).toHaveBeenCalledOnce();
      expect(closeSession).toHaveBeenCalledWith("ambiguous-upstream");
      expect(await prisma.providerSessionCloseRecovery.count()).toBe(0);
    });
  }, 30_000);
});
