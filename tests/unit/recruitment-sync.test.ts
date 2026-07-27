import { describe, expect, it } from "vitest";
import { runRecruitmentSync } from "@/lib/recruitment/sync";
import type { ConnectorSearchTemplate, ConnectorSource, RecruitmentConnector } from "@/lib/recruitment/connectors/base";

function templateRecord(): ConnectorSearchTemplate & {
  name: string;
  sourceIdsJson: string;
  enabled: boolean;
} {
  return {
    id: "template-1",
    name: "React",
    keywords: "react engineer",
    city: "Remote",
    country: "us",
    roleType: null,
    experienceRange: null,
    salaryRange: null,
    language: null,
    remoteMode: null,
    sourceIdsJson: JSON.stringify(["source-1"]),
    enabled: true
  };
}

function sourceRecord(): ConnectorSource {
  return {
    id: "source-1",
    provider: "greenhouse",
    sourceType: "PUBLIC_SOURCE",
    displayName: "Greenhouse",
    enabled: true,
    credentialCiphertext: null,
    credentialIv: null,
    credentialTag: null,
    settingsJson: JSON.stringify({ boardToken: "acme" })
  };
}

function fakePrisma() {
  const postings = new Map<string, Record<string, unknown>>();
  const syncRuns = new Map<string, Record<string, unknown>>();

  return {
    _postings: postings,
    _syncRuns: syncRuns,
    recruitmentSearchTemplate: {
      findUnique: async () => templateRecord()
    },
    recruitmentSource: {
      findMany: async () => [sourceRecord()]
    },
    recruitmentJobPosting: {
      findUnique: async ({ where }: { where: { dedupeKey: string } }) => postings.get(where.dedupeKey) || null,
      upsert: async ({ where, create, update }: { where: { dedupeKey: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = postings.get(where.dedupeKey);
        const row = existing ? { ...existing, ...update } : { id: `posting-${postings.size + 1}`, ...create };
        postings.set(where.dedupeKey, row);
        return row;
      }
    },
    recruitmentSyncRun: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "run-1", ...data };
        syncRuns.set("run-1", row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = { ...syncRuns.get(where.id), ...data };
        syncRuns.set(where.id, row);
        return row;
      }
    }
  };
}

function registryWith(connector: RecruitmentConnector) {
  return {
    get: () => connector
  };
}

describe("recruitment sync", () => {
  it("upserts connector postings and records a successful run", async () => {
    const prisma = fakePrisma();
    const connector: RecruitmentConnector = {
      provider: "greenhouse",
      sourceType: "PUBLIC_SOURCE",
      verify: async () => ({ ok: true, status: "VERIFIED" }),
      search: async () => ({
        postings: [{
          provider: "greenhouse",
          sourceType: "PUBLIC_SOURCE",
          title: "Frontend Engineer",
          company: "Acme",
          location: "Remote",
          salary: null,
          description: "Build React interviews",
          requirements: ["React"],
          sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
          externalJobId: "gh-1",
          publishedAt: new Date("2026-07-26T00:00:00.000Z"),
          rawJson: { id: "gh-1" }
        }]
      })
    };

    const result = await runRecruitmentSync({
      prisma,
      connectorRegistry: registryWith(connector),
      templateId: "template-1",
      sourceIds: ["source-1"],
      now: () => new Date("2026-07-27T12:00:00.000Z")
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.insertedCount).toBe(1);
    expect(result.updatedCount).toBe(0);
    expect(prisma._postings.get("provider:greenhouse:gh-1")).toMatchObject({
      sourceId: "source-1",
      provider: "greenhouse",
      title: "Frontend Engineer",
      requirementsJson: JSON.stringify(["React"])
    });
    expect(prisma._syncRuns.get("run-1")).toMatchObject({
      status: "SUCCESS",
      insertedCount: 1,
      updatedCount: 0
    });
  });

  it("redacts secrets and marks authorization failures", async () => {
    const connector: RecruitmentConnector = {
      provider: "greenhouse",
      sourceType: "PUBLIC_SOURCE",
      verify: async () => ({ ok: false, status: "AUTH_REQUIRED" }),
      search: async () => {
        throw Object.assign(new Error("secret-api-key-123456 unauthorized"), { status: 401 });
      }
    };

    const result = await runRecruitmentSync({
      prisma: fakePrisma(),
      connectorRegistry: registryWith(connector),
      templateId: "template-1",
      sourceIds: ["source-1"]
    });

    expect(result.status).toBe("AUTH_REQUIRED");
    expect(JSON.stringify(result.logs)).not.toContain("secret-api-key-123456");
    expect(JSON.stringify(result.logs)).toContain("AUTH_REQUIRED");
  });
});
