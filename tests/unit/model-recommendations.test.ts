import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aiCapabilities } from "@/lib/domain/aiServiceConstants";
import { modelRecommendationGroups } from "@/lib/domain/modelRecommendations";

describe("model recommendation matrix", () => {
  it("covers the full interview product model chain", () => {
    const recommendedCapabilities = modelRecommendationGroups.flatMap((group) =>
      group.recommendations.map((recommendation) => recommendation.capability)
    );

    expect(recommendedCapabilities).toEqual(
      expect.arrayContaining([
        "INTERVIEW_DIALOGUE",
        "INTERVIEW_OUTLINE",
        "INTERVIEW_FOLLOW_UP",
        "REPORT_ANALYSIS",
        "COMPANY_RESEARCH",
        "SPEECH_TO_TEXT",
        "TEXT_TO_SPEECH",
        "DIGITAL_HUMAN_REALTIME",
        "DIGITAL_HUMAN_VIDEO",
        "VISION_BEHAVIOR_ANALYSIS",
        "EMBEDDING",
        "SAFETY_REVIEW"
      ])
    );
  });

  it("only recommends capabilities that can be selected in the admin model form", () => {
    const capabilities = new Set(aiCapabilities);

    for (const group of modelRecommendationGroups) {
      for (const recommendation of group.recommendations) {
        expect(capabilities.has(recommendation.capability)).toBe(true);
        expect(recommendation.priceNote.length).toBeGreaterThan(0);
        expect(recommendation.howToUse.length).toBeGreaterThan(0);
      }
    }
  });

  it("renders recommendations on the AI services admin page", () => {
    const source = readFileSync(join(process.cwd(), "components/admin/AiServiceConfigPanel.tsx"), "utf8");

    expect(source).toContain("模型推荐矩阵");
    expect(source).toContain("modelRecommendationGroups");
    expect(source).toContain("添加参考");
  });
});
