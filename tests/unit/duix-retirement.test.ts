import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aiProviderTypes } from "@/lib/domain/aiServiceConstants";
import { modelRecommendationGroups } from "@/lib/domain/modelRecommendations";

const root = process.cwd();

function readWorkspaceFile(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("DUIX runtime retirement", () => {
  it("removes DUIX from selectable providers and model recommendations", () => {
    expect(aiProviderTypes).not.toContain("DUIX");
    expect(
      modelRecommendationGroups.flatMap((group) => group.recommendations)
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerType: "DUIX" })
      ])
    );
  });

  it("replaces the DUIX dependency with ali-oss", () => {
    const packageJson = readWorkspaceFile("package.json");
    const packageLock = readWorkspaceFile("package-lock.json");

    expect(packageJson).toContain('"ali-oss"');
    expect(packageJson).not.toContain('"duix-guiji"');
    expect(packageLock).toContain('"node_modules/ali-oss"');
    expect(packageLock).not.toContain('"node_modules/duix-guiji"');
  });

  it("deletes DUIX adapters and declarations", () => {
    for (const path of [
      "duix-guiji.d.ts",
      "lib/client/duixAvatarClient.ts",
      "lib/media/providers/duix.ts",
      "lib/media/providers/duixCredentials.ts"
    ]) {
      expect(existsSync(join(root, path)), path).toBe(false);
    }
  });

  it("removes DUIX imports and runtime branches from production paths", () => {
    for (const path of [
      "components/admin/AiMultimodalConfigFields.tsx",
      "components/admin/AiServiceConfigPanel.tsx",
      "components/practice/DigitalInterviewerVideo.tsx",
      "lib/ai/diagnostics.ts",
      "lib/domain/aiModelSettings.ts",
      "lib/media/digitalHumanSessions.ts"
    ]) {
      const source = readWorkspaceFile(path);

      expect(source, path).not.toContain("duix-guiji");
      expect(source, path).not.toContain("DUIX_H5");
      expect(source, path).not.toContain('providerType === "DUIX"');
      expect(source, path).not.toContain("DuixProviderFields");
    }
  });

  it("guards model creation, selection, and configuration UI from historical DUIX providers", () => {
    for (const path of [
      "app/api/ai-services/models/route.ts",
      "app/api/ai-services/models/[modelId]/route.ts",
      "components/admin/AiServiceConfigPanel.tsx"
    ]) {
      expect(readWorkspaceFile(path), path).toContain("isSelectableAiProviderType");
    }
  });
});
