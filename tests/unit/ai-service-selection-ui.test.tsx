import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiServiceConfigPanel } from "@/components/admin/AiServiceConfigPanel";

describe("AI service current-model controls", () => {
  it("shows recommendation and runtime selection as independent concepts", () => {
    const markup = renderToStaticMarkup(
      <AiServiceConfigPanel
        initialProviders={[{
          id: "provider-1",
          displayName: "Alibaba Cloud",
          providerType: "TONGYI",
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          apiKeyPreview: "sk-a****7890",
          enabled: true,
          notes: null
        }]}
        initialModels={[{
          id: "model-1",
          providerId: "provider-1",
          displayName: "Qwen Plus",
          modelName: "qwen-plus",
          capability: "INTERVIEW_DIALOGUE",
          temperature: 0.4,
          maxTokens: 1200,
          timeoutMs: 30000,
          costNote: null,
          enabled: true,
          isDefault: true,
          isSelected: false,
          provider: {
            id: "provider-1",
            displayName: "Alibaba Cloud",
            providerType: "TONGYI",
            enabled: true
          }
        }]}
      />
    );

    expect(markup).toContain("推荐");
    expect(markup).toContain("设为当前使用");
    expect(markup).toContain("推荐默认（仅供参考）");
    expect(markup).toContain('name="isSelected"');
  });
});
