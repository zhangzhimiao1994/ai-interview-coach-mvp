import { readFileSync } from "node:fs";
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
});
