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

describe("digital human reaper with Prisma SQLite", () => {
  it("closes real idle, expired, and due FAILED rows while preserving a healthy row", async () => {
    const temporaryDirectory = mkdtempSync(join(prismaDirectory, ".reaper-service-"));
    const databaseUrl = `file:./${basename(temporaryDirectory)}/service.db`;
    let prisma: PrismaClient | undefined;

    try {
      applyMigrations(databaseUrl, temporaryDirectory);
      prisma = new PrismaClient({ datasourceUrl: databaseUrl });
      const now = new Date("2026-07-18T02:00:00.000Z");
      const provider = await prisma.aiServiceProvider.create({
        data: {
          id: "provider-1",
          displayName: "Lingmou",
          providerType: "LINGMOU",
          settingsJson: '{"region":"cn-beijing"}'
        }
      });
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
      const trainingSessionIds = ["idle", "expired", "failed", "healthy"].map(
        (name) => `training-session-${name}`
      );
      await prisma.trainingSession.createMany({
        data: trainingSessionIds.map((id) => ({
          id,
          taskId: task.id,
          candidateId: candidate.id
        }))
      });
      const cloudBase = {
        providerId: provider.id,
        modelId: "model-1",
        adapter: "LINGMOU",
        mode: "LINGMOU_CLOUD",
        providerConfigVersion: 0
      };
      await prisma.digitalHumanSession.createMany({
        data: [
          {
            ...cloudBase,
            id: "idle",
            trainingSessionId: "training-session-idle",
            providerSessionId: "provider-session-idle",
            instanceId: "instance-idle",
            status: "READY",
            lastActivityAt: new Date(now.getTime() - 60_001),
            expiresAt: new Date(now.getTime() + 60_000),
            updatedAt: new Date(now.getTime() - 60_001)
          },
          {
            ...cloudBase,
            id: "expired",
            trainingSessionId: "training-session-expired",
            providerSessionId: "provider-session-expired",
            instanceId: "instance-expired",
            status: "READY",
            lastActivityAt: now,
            expiresAt: now,
            updatedAt: now
          },
          {
            ...cloudBase,
            id: "failed",
            trainingSessionId: "training-session-failed",
            providerSessionId: "provider-session-failed",
            instanceId: "instance-failed",
            status: "FAILED",
            lastActivityAt: now,
            expiresAt: new Date(now.getTime() + 60_000),
            updatedAt: new Date(now.getTime() - 30_001)
          },
          {
            ...cloudBase,
            id: "healthy",
            trainingSessionId: "training-session-healthy",
            providerSessionId: "provider-session-healthy",
            instanceId: "instance-healthy",
            status: "READY",
            lastActivityAt: now,
            expiresAt: new Date(now.getTime() + 60_000),
            updatedAt: now
          }
        ]
      });

      const closeSession = vi.fn().mockResolvedValue(undefined);
      const service = createDigitalHumanSessionService({
        repository: createPrismaDigitalHumanSessionRepository(prisma),
        createSessionCloser: () => ({ closeSession }),
        now: () => now
      });

      await expect(service.reapDigitalHumanSessions(now)).resolves.toBe(3);
      expect(closeSession).toHaveBeenCalledTimes(3);
      expect(closeSession.mock.calls.map(([id]) => id).sort()).toEqual([
        "provider-session-expired",
        "provider-session-failed",
        "provider-session-idle"
      ]);
      const rows = await prisma.digitalHumanSession.findMany({
        select: { id: true, status: true, stopReason: true },
        orderBy: { id: "asc" }
      });
      expect(rows).toEqual([
        { id: "expired", status: "STOPPED", stopReason: "SESSION_EXPIRED" },
        { id: "failed", status: "STOPPED", stopReason: "RECOVERY_RETRY" },
        { id: "healthy", status: "READY", stopReason: null },
        { id: "idle", status: "STOPPED", stopReason: "IDLE_TIMEOUT" }
      ]);
    } finally {
      try {
        await prisma?.$disconnect();
      } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    }
  }, 30_000);
});
