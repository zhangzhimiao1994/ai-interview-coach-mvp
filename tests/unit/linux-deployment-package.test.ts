import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readWorkspaceFile(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("linux deployment package", () => {
  it("uses Prisma migrations instead of db push in production deployment paths", () => {
    expect(readWorkspaceFile("scripts/linux/setup.sh")).toContain("npm run db:migrate:deploy");
    expect(readWorkspaceFile("scripts/linux/migrate.sh")).toContain("npm run db:migrate:deploy");
    expect(readWorkspaceFile("scripts/docker-entrypoint.sh")).toContain("npm run db:migrate:deploy");
  });

  it("documents source package deployment and excludes local secrets", () => {
    const docs = readWorkspaceFile("docs/linux-deployment.md");

    expect(docs).toContain("部署包方式");
    expect(docs).toContain("AI_CONFIG_SECRET");
    expect(docs).toContain(".env 不在部署包内");
  });

  it("validates production environment before migration or startup", () => {
    expect(readWorkspaceFile("scripts/linux/setup.sh")).toContain("validate-production-env");
    expect(readWorkspaceFile("scripts/linux/start.sh")).toContain("validate-production-env");
    expect(readWorkspaceFile("scripts/docker-entrypoint.sh")).toContain("validate-production-env");
  });

  it("rejects placeholder secrets and accepts complete production configuration", () => {
    const script = join(root, "scripts/validate-production-env.mjs");
    const baseEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "file:./data/prod.db",
      AI_CONFIG_SECRET: "real-ai-config-secret"
    };
    const invalid = spawnSync(process.execPath, [script], {
      env: { ...baseEnvironment, ADMIN_PASSWORD: "change-this-before-production" },
      encoding: "utf8"
    });
    const valid = spawnSync(process.execPath, [script], {
      env: { ...baseEnvironment, ADMIN_PASSWORD: "real-admin-password" },
      encoding: "utf8"
    });

    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("ADMIN_PASSWORD");
    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain("validation passed");
  });

  it("uses the dedicated readiness endpoint for Docker health checks", () => {
    expect(readWorkspaceFile("docker-compose.yml")).toContain("http://127.0.0.1:3000/api/health");
  });

  it("packages the diagnostics API and admin assets in the Docker build context", () => {
    expect(existsSync(join(root, "app/api/ai-services/diagnostics/route.ts"))).toBe(true);
    expect(existsSync(join(root, "components/admin/AiDiagnosticsPanel.tsx"))).toBe(true);
    expect(readWorkspaceFile("Dockerfile")).toContain("COPY . .");

    const dockerIgnore = readWorkspaceFile(".dockerignore");
    expect(dockerIgnore).not.toMatch(/^app(?:\/|$)/m);
    expect(dockerIgnore).not.toMatch(/^components(?:\/|$)/m);
    expect(dockerIgnore).not.toMatch(/^lib(?:\/|$)/m);
  });

  it("documents authenticated diagnostics after source and Docker updates", () => {
    const docs = readWorkspaceFile("docs/linux-deployment.md");

    expect(docs).toContain("git switch feature/alibaba-multimodal-integration");
    expect(docs).toContain("git pull");
    expect(docs).toContain("docker compose up -d --build");
    expect(docs).toContain("docker compose ps");
    expect(docs).toContain("curl -u");
    expect(docs).toContain("/api/ai-services/diagnostics");
    expect(docs).toContain("真实连通测试不会自动执行");
  });
});
