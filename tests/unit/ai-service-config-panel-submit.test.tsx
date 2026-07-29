import React from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiServiceConfigPanel } from "@/components/admin/AiServiceConfigPanel";

type FormValues = Record<string, string>;

class TestFormData {
  private readonly values: FormValues;

  constructor(target: { values: FormValues }) {
    this.values = target.values;
  }

  get(name: string) {
    return this.values[name] ?? null;
  }
}

describe("AI service configuration form submissions", () => {
  let renderer: ReactTestRenderer;

  beforeEach(async () => {
    vi.stubGlobal("FormData", TestFormData);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await act(async () => {
      renderer = create(
        <AiServiceConfigPanel
          initialProviders={[provider]}
          initialModels={[]}
        />
      );
    });
  });

  afterEach(() => {
    act(() => renderer.unmount());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the saved-provider success state after React releases the submit event", async () => {
    const savedProvider = { ...provider, id: "provider-2", displayName: "DeepSeek" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ provider: savedProvider })));
    const reset = vi.fn();
    const event = releasedSubmitEvent({
      displayName: "DeepSeek",
      apiKey: "sk-test",
      enabled: "on"
    }, reset);

    await act(async () => {
      await renderer.root.findAllByType("form")[1].props.onSubmit(event);
    });

    expect(reset).toHaveBeenCalledOnce();
    expect(JSON.stringify(renderer.toJSON())).toContain("服务商已保存，密钥已加密存储。");
    expect(JSON.stringify(renderer.toJSON())).not.toContain("服务不可达，请稍后重试。");
  });

  it("keeps the saved-model success state after React releases the submit event", async () => {
    const savedModel = {
      id: "model-1",
      providerId: provider.id,
      displayName: "DeepSeek Outline",
      modelName: "deepseek-v4-pro",
      capability: "INTERVIEW_OUTLINE",
      temperature: 0.4,
      maxTokens: 2400,
      timeoutMs: 60000,
      costNote: null,
      enabled: true,
      isDefault: false,
      isSelected: true,
      provider: {
        id: provider.id,
        displayName: provider.displayName,
        providerType: provider.providerType,
        enabled: true
      }
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ model: savedModel })));
    const reset = vi.fn();
    const event = releasedSubmitEvent({
      providerId: provider.id,
      displayName: savedModel.displayName,
      modelName: savedModel.modelName,
      capability: savedModel.capability,
      temperature: "0.4",
      maxTokens: "2400",
      timeoutMs: "60000",
      enabled: "on",
      isSelected: "on"
    }, reset);

    await act(async () => {
      await renderer.root.findAllByType("form")[2].props.onSubmit(event);
    });

    expect(reset).toHaveBeenCalledOnce();
    expect(JSON.stringify(renderer.toJSON())).toContain("模型配置已保存。");
    expect(JSON.stringify(renderer.toJSON())).not.toContain("服务不可达，请稍后重试。");
  });

  it("submits generic DashScope and legacy ASR/TTS credentials for TONGYI", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ provider: { ...provider, id: "tongyi" } }));
    vi.stubGlobal("fetch", fetchMock);
    await selectProviderType("TONGYI");

    await act(async () => {
      await renderer.root.findAllByType("form")[1].props.onSubmit(releasedSubmitEvent({
        displayName: "Bailian",
        apiKey: "dashscope-key",
        asrApiKey: "asr-key",
        ttsApiKey: "tts-key",
        workspaceId: "workspace-1",
        region: "cn-beijing",
        rtcAppId: "must-not-submit",
        rtcAppKey: "must-not-submit",
        enabled: "on"
      }, vi.fn()));
    });

    expect(requestPayload(fetchMock)).toMatchObject({
      providerType: "TONGYI",
      apiKey: "dashscope-key",
      credentials: { asrApiKey: "asr-key", ttsApiKey: "tts-key" },
      settings: { workspaceId: "workspace-1", region: "cn-beijing" }
    });
    expect(requestPayload(fetchMock).credentials).not.toHaveProperty("rtcAppKey");
    expect(requestPayload(fetchMock).settings).not.toHaveProperty("rtcAppId");
  });

  it("submits only Lingmou RAM credentials and region for LINGMOU", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ provider: { ...provider, id: "lingmou" } }));
    vi.stubGlobal("fetch", fetchMock);
    await selectProviderType("LINGMOU");

    await act(async () => {
      await renderer.root.findAllByType("form")[1].props.onSubmit(releasedSubmitEvent({
        displayName: "Lingmou",
        apiKey: "must-not-submit",
        accessKeyId: "ak-id",
        accessKeySecret: "ak-secret",
        region: "cn-beijing",
        workspaceId: "must-not-submit",
        rtcAppKey: "must-not-submit",
        enabled: "on"
      }, vi.fn()));
    });

    expect(requestPayload(fetchMock)).toEqual(expect.objectContaining({
      providerType: "LINGMOU",
      credentials: { accessKeyId: "ak-id", accessKeySecret: "ak-secret" },
      settings: { region: "cn-beijing" }
    }));
    expect(requestPayload(fetchMock)).not.toHaveProperty("apiKey");
    expect(requestPayload(fetchMock).credentials).not.toHaveProperty("asrApiKey");
    expect(requestPayload(fetchMock).settings).not.toHaveProperty("workspaceId");
  });

  it("excludes historical DUIX providers from model creation and runtime selection", async () => {
    const duixProvider = {
      ...provider,
      id: "duix-provider",
      displayName: "Historical DUIX",
      providerType: "DUIX"
    };
    const tongyiProvider = {
      ...provider,
      id: "tongyi-provider",
      displayName: "Tongyi",
      providerType: "TONGYI"
    };
    const modelBase = {
      displayName: "Video model",
      modelName: "video-model",
      capability: "DIGITAL_HUMAN_VIDEO",
      temperature: 0.4,
      maxTokens: 1200,
      timeoutMs: 30000,
      costNote: null,
      enabled: true,
      isDefault: false,
      isSelected: false
    };

    act(() => renderer.unmount());
    await act(async () => {
      renderer = create(
        <AiServiceConfigPanel
          initialProviders={[duixProvider, tongyiProvider]}
          initialModels={[
            {
              ...modelBase,
              id: "duix-model",
              providerId: duixProvider.id,
              provider: {
                id: duixProvider.id,
                displayName: duixProvider.displayName,
                providerType: duixProvider.providerType,
                enabled: true
              }
            },
            {
              ...modelBase,
              id: "tongyi-model",
              providerId: tongyiProvider.id,
              provider: {
                id: tongyiProvider.id,
                displayName: tongyiProvider.displayName,
                providerType: tongyiProvider.providerType,
                enabled: true
              }
            }
          ]}
        />
      );
    });

    const providerOptions = renderer.root
      .findByProps({ name: "providerId" })
      .findAllByType("option")
      .map((option) => option.props.value);
    const runtimeSelectionButtons = renderer.root
      .findAllByType("button")
      .filter((button) => renderedText(button).includes("设为当前使用"));

    expect(providerOptions).toContain(tongyiProvider.id);
    expect(providerOptions).not.toContain(duixProvider.id);
    expect(runtimeSelectionButtons).toHaveLength(1);
  });

  async function selectProviderType(providerType: "TONGYI" | "LINGMOU") {
    await act(async () => {
      renderer.root.findByProps({ name: "providerType" }).props.onChange({ target: { value: providerType } });
    });
  }
});

const provider = {
  id: "provider-1",
  displayName: "Existing Provider",
  providerType: "DEEPSEEK",
  baseUrl: "https://api.deepseek.com",
  apiKeyPreview: "sk-t****test",
  enabled: true,
  notes: null
};

function releasedSubmitEvent(values: FormValues, reset: () => void) {
  const form = { values, reset };
  let reads = 0;

  return {
    preventDefault: vi.fn(),
    get currentTarget() {
      reads += 1;
      return reads === 1 ? form : null;
    }
  };
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 201,
    headers: { "Content-Type": "application/json" }
  });
}

function requestPayload(fetchMock: ReturnType<typeof vi.fn>) {
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

function renderedText(node: ReactTestInstance): string {
  return node.children
    .map((child) => typeof child === "string" ? child : renderedText(child))
    .join("");
}
