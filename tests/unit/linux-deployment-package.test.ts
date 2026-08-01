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

  it("keeps emergency Basic Auth optional but validates a configured pair", () => {
    const script = join(root, "scripts/validate-production-env.mjs");
    const baseEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "file:./data/prod.db",
      APP_ORIGIN: "https://interview.example.com",
      AI_CONFIG_SECRET: "real-ai-config-secret",
      RECRUITMENT_SESSION_SECRET: "real-recruitment-session-secret-123456"
    };
    const withoutBasicAuth = spawnSync(process.execPath, [script], {
      env: { ...baseEnvironment, ADMIN_USERNAME: undefined, ADMIN_PASSWORD: undefined },
      encoding: "utf8"
    });
    const usernameOnly = spawnSync(process.execPath, [script], {
      env: { ...baseEnvironment, ADMIN_USERNAME: "break-glass", ADMIN_PASSWORD: undefined },
      encoding: "utf8"
    });
    const weakPair = spawnSync(process.execPath, [script], {
      env: { ...baseEnvironment, ADMIN_USERNAME: "break-glass", ADMIN_PASSWORD: "short" },
      encoding: "utf8"
    });
    const validPair = spawnSync(process.execPath, [script], {
      env: { ...baseEnvironment, ADMIN_USERNAME: "break-glass", ADMIN_PASSWORD: "strong-emergency-password" },
      encoding: "utf8"
    });

    expect(withoutBasicAuth.status).toBe(0);
    expect(usernameOnly.status).toBe(1);
    expect(usernameOnly.stderr).toContain("ADMIN_USERNAME and ADMIN_PASSWORD");
    expect(weakPair.status).toBe(1);
    expect(weakPair.stderr).toContain("at least 12 characters");
    expect(validPair.status).toBe(0);
    expect(validPair.stdout).toContain("validation passed");
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

  it("requires a canonical public APP_ORIGIN in production", () => {
    const script = join(root, "scripts/validate-production-env.mjs");
    const baseEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "file:./data/prod.db",
      ADMIN_USERNAME: "break-glass",
      ADMIN_PASSWORD: "real-admin-password",
      AI_CONFIG_SECRET: "real-ai-config-secret",
      RECRUITMENT_SESSION_SECRET: "real-recruitment-session-secret-123456"
    };

    for (const APP_ORIGIN of [
      undefined,
      "https://interview.example.com/path",
      "https://user:secret@interview.example.com",
      "ftp://interview.example.com"
    ]) {
      const result = spawnSync(process.execPath, [script], {
        env: { ...baseEnvironment, APP_ORIGIN },
        encoding: "utf8"
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("APP_ORIGIN");
    }

    const valid = spawnSync(process.execPath, [script], {
      env: { ...baseEnvironment, APP_ORIGIN: "https://interview.example.com" },
      encoding: "utf8"
    });
    expect(valid.status).toBe(0);
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
    expect(docs).toContain("灵眸播报");
    expect(docs).toContain("模板 ID");
    expect(docs).toContain("模板变量映射");
    expect(docs).toContain("NOT_CONFIGURED");
    expect(docs).toContain("本地头像");
    expect(docs).toContain("Qwen TTS");
    expect(docs).toContain("它可能创建真实任务并计费");
    expect(docs).toContain("npm ci");
    expect(docs).toContain("npm run db:migrate:deploy");
    expect(docs).toContain("docker compose down --remove-orphans");
    expect(docs).toContain("docker desktop stop");
    expect(docs).toContain("Windows Docker Desktop only");
    expect(docs).toContain("stops all local Desktop workloads");
    expect(docs).toContain("on Linux run only `docker compose down --remove-orphans`");
    expect(docs).toContain("RECRUITMENT_SESSION_SECRET");
    expect(docs).toContain("recruitment API credentials and browser session state");
    expect(docs).toContain("招聘来源");
    expect(docs).toContain("浏览器授权记录");
    expect(docs).not.toMatch(/configId|instanceId|license/i);
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

  it("documents the complete Alibaba dual-video debugging contract", () => {
    const docs = readWorkspaceFile("docs/alibaba-video-digital-human-debugging.md");

    for (const required of [
      "私有 Bucket",
      "最小权限 RAM",
      "灵眸播报模板",
      "变量映射",
      "EMO",
      "肖像",
      "音频",
      "AUTO_RACE",
      "LINGMOU_ONLY",
      "EMO_ONLY",
      "可能产生费用",
      "3 秒",
      "6 秒",
      "8 秒",
      "24 小时",
      "签名 URL",
      "重新上传",
      "portraitWidth",
      "portraitHeight",
      "docker compose down --remove-orphans",
      "docker desktop stop"
    ]) {
      expect(docs).toContain(required);
    }
    expect(docs).toContain("HTTPS");
    expect(docs).toContain("15 MiB");
    expect(docs).toContain("60 秒");
    expect(docs).toContain("400–7000");
    expect(docs).toContain("JPEG/PNG");
    expect(docs).toContain("5 MiB");
    expect(docs).toContain("PutObject");
    expect(docs).toContain("GetObject");
    expect(docs).toContain("DeleteObject");
    expect(docs).toContain("控制台可能更严格");
  });

  it("documents exact Windows and lockfile-equivalent Linux deployment flows", () => {
    const docs = readWorkspaceFile("docs/linux-deployment.md");
    const windowsCommands = [
      "npm.cmd ci",
      "npx.cmd prisma migrate deploy",
      "npm.cmd run build",
      "npm.cmd run dev"
    ];
    let previous = -1;
    for (const command of windowsCommands) {
      const position = docs.indexOf(command);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }

    expect(docs).toContain("package-lock.json");
    expect(docs).toContain("npm ci");
    expect(docs).toContain("npx prisma migrate deploy");
    expect(docs).toContain("首次运行");
    expect(docs).toContain("超级管理员");
    expect(docs).toContain("真实服务核对表");
    expect(docs).toContain("不要把凭据写入本文档");
  });

  it("uses a free configuration-only Docker health check and current lockfile build", () => {
    const dockerfile = readWorkspaceFile("Dockerfile");
    const compose = readWorkspaceFile("docker-compose.yml");

    expect(dockerfile).toContain("COPY package.json package-lock.json ./");
    expect(dockerfile).toContain("npm ci");
    expect(dockerfile).toContain("scripts/docker-entrypoint.sh");
    expect(compose).toContain("/api/health");
    expect(compose).toContain("免费的配置级就绪检查");
    expect(compose).not.toContain("digital-human-video-diagnostics");
    expect(compose).not.toContain("LINGMOU_ONLY");
    expect(compose).not.toContain("EMO_ONLY");
  });

  it("hands off only the current Alibaba video runtime requirements", () => {
    const handoff = readWorkspaceFile("docs/new-project-handoff-2026-07-16.md");
    const interfaces = readWorkspaceFile("docs/digital-human-and-behavior-interfaces.md");
    const combined = `${handoff}\n${interfaces}`;

    expect(combined).toContain("阿里灵眸播报优先");
    expect(combined).toContain("EMO 并发");
    expect(combined).toContain("谁先成功用谁");
    expect(combined).toContain("两路立即各提交一次");
    expect(combined).toContain("3 秒和 6 秒轮询灵眸");
    expect(combined).toContain("8 秒轮询 EMO");
    expect(combined).toContain("8 秒本地 Qwen TTS 降级");
    expect(combined).toContain("两位面试官");
    expect(combined).not.toMatch(/DUIX|duix-guiji|酷虎云/i);
    expect(combined).not.toMatch(/license|configId|instanceId/i);
  });
});
