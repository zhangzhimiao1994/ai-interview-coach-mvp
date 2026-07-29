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
      AI_CONFIG_SECRET: "real-ai-config-secret",
      RECRUITMENT_SESSION_SECRET: "real-recruitment-session-secret-123456"
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

  it("requires recruitment credential encryption in production", () => {
    const script = join(root, "scripts/validate-production-env.mjs");
    const missingRecruitmentSecret = spawnSync(process.execPath, [script], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: "file:./data/prod.db",
        ADMIN_PASSWORD: "real-admin-password",
        AI_CONFIG_SECRET: "real-ai-config-secret"
      },
      encoding: "utf8"
    });

    expect(missingRecruitmentSecret.status).toBe(1);
    expect(missingRecruitmentSecret.stderr).toContain("RECRUITMENT_SESSION_SECRET");
    expect(missingRecruitmentSecret.stderr).toContain("recruitment API credentials and browser session state");
  });

  it("uses the dedicated readiness endpoint for Docker health checks", () => {
    expect(readWorkspaceFile("docker-compose.yml")).toContain("http://127.0.0.1:3000/api/health");
  });

  it("keeps Linux entry scripts on LF line endings", () => {
    const attributesPath = join(root, ".gitattributes");

    expect(existsSync(attributesPath)).toBe(true);
    if (existsSync(attributesPath)) {
      expect(readWorkspaceFile(".gitattributes")).toContain("*.sh text eol=lf");
    }

    for (const path of [
      "scripts/docker-entrypoint.sh",
      "scripts/linux/migrate.sh",
      "scripts/linux/setup.sh",
      "scripts/linux/start.sh"
    ]) {
      expect(readWorkspaceFile(path)).not.toContain("\r\n");
    }
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

  it("packages the Alibaba OSS client without the retired DUIX browser runtime", () => {
    expect(readWorkspaceFile("package.json")).toContain('"ali-oss"');
    expect(readWorkspaceFile("package-lock.json")).toContain('"node_modules/ali-oss"');
    expect(readWorkspaceFile("package.json")).not.toContain('"duix-guiji"');
    expect(existsSync(join(root, "lib/client/duixAvatarClient.ts"))).toBe(false);
    expect(existsSync(join(root, "duix-guiji.d.ts"))).toBe(false);
  });

  it("uses cached and retryable npm installs during Docker builds", () => {
    const dockerfile = readWorkspaceFile("Dockerfile");

    expect(dockerfile).toContain("# syntax=docker/dockerfile");
    expect(dockerfile).toContain("--mount=type=cache,target=/root/.npm");
    expect(dockerfile).toContain("--fetch-retries=5");
    expect(dockerfile).toContain("--fetch-retry-maxtimeout=120000");
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
    expect(docs).toContain("百炼 Workspace/API Key 与灵眸 RAM AccessKey 是两套独立凭据");
    expect(docs).toContain("configId");
    expect(docs).toContain("instanceId");
    expect(docs).toContain("NOT_CONFIGURED");
    expect(docs).toContain("本地数字人和 CosyVoice");
    expect(docs).toContain("会创建并立即关闭一次真实会话，可能计费");
    expect(docs).toContain("npm ci");
    expect(docs).toContain("npm run db:migrate:deploy");
    expect(docs).toContain("docker compose down --remove-orphans");
    expect(docs).toContain("docker desktop stop");
    expect(docs).toContain("RECRUITMENT_SESSION_SECRET");
    expect(docs).toContain("recruitment API credentials and browser session state");
    expect(docs).toContain("招聘来源");
    expect(docs).toContain("浏览器授权记录");
  });

  it("keeps Lingmou RAM credentials out of environment files", () => {
    const example = readWorkspaceFile(".env.example");

    expect(example).toContain("RAM AccessKey");
    expect(example).toContain("后台加密");
    expect(example).not.toMatch(/LINGMOU_(?:ACCESS_KEY|SECRET|TOKEN)/);
  });

  it("documents realtime speech configuration, proxying, and explicit fallbacks", () => {
    const deploymentDocs = readWorkspaceFile("docs/linux-deployment.md");
    const mediaDocs = readWorkspaceFile("docs/digital-human-and-behavior-interfaces.md");

    expect(deploymentDocs).toContain("/ws/asr");
    expect(deploymentDocs).toContain("proxy_set_header Upgrade $http_upgrade;");
    expect(deploymentDocs).toContain('proxy_set_header Connection "upgrade";');
    expect(deploymentDocs).toContain("同源 WebSocket");

    for (const setting of ["region", "workspaceId", "asrApiKey", "ttsApiKey"]) {
      expect(mediaDocs).toContain(`\`${setting}\``);
    }
    expect(mediaDocs).toContain("qwen3-asr-flash-realtime");
    expect(mediaDocs).toContain("cosyvoice-v3-flash");
    expect(mediaDocs).toContain("当前使用（isSelected）");
    expect(mediaDocs).toContain("阿里实时识别优先");
    expect(mediaDocs).toContain("浏览器识别降级");
    expect(mediaDocs).toContain("阿里真实语音优先");
    expect(mediaDocs).toContain("浏览器语音降级");
  });
});
