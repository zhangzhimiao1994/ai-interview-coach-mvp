import { describe, expect, it, vi } from "vitest";
import { encryptCredentialMap } from "@/lib/domain/aiServices";
import type { ResolvedMediaModel } from "@/lib/media/config";
import {
  createLingmouBroadcastProvider,
  resolveLingmouBroadcastConfiguration
} from "@/lib/media/video/providers/lingmouBroadcast";

const configSecret = "lingmou-broadcast-config-secret";

describe("Lingmou broadcast configuration", () => {
  it("uses cn-beijing by default and keeps broadcast settings separate from realtime fields", () => {
    expect(resolveLingmouBroadcastConfiguration(model(), () => configSecret)).toEqual({
      credentials: {
        accessKeyId: "lingmou-ak-id",
        accessKeySecret: "lingmou-ak-secret",
        region: "cn-beijing"
      },
      templateId: "template-01",
      audioVariableName: "audio",
      portraitVariableName: "portrait",
      resolution: "1080p",
      fps: 25,
      watermark: false,
      mode: "standard"
    });
  });

  it("honors a stored Lingmou region override", () => {
    expect(resolveLingmouBroadcastConfiguration(model({
      providerSettings: { region: "cn-shanghai" }
    }), () => configSecret).credentials.region).toBe("cn-shanghai");
  });

  it.each([
    ["provider", { providerType: "TONGYI" }, "LINGMOU_BROADCAST_PROVIDER_REQUIRED"],
    ["capability", { capability: "DIGITAL_HUMAN_REALTIME" }, "LINGMOU_BROADCAST_CAPABILITY_REQUIRED"],
    ["model", { modelName: "lingmou-2d-cloud-audio-driven" }, "LINGMOU_BROADCAST_ADAPTER_CONFIG_INVALID"],
    ["template", { modelSettings: { templateId: "" } }, "LINGMOU_BROADCAST_TEMPLATE_ID_REQUIRED"],
    ["portrait variable", { modelSettings: { portraitVariableName: "" } }, "LINGMOU_BROADCAST_PORTRAIT_VARIABLE_INVALID"]
  ] as const)("rejects an invalid %s before constructing the SDK client", (
    _field,
    overrides,
    code
  ) => {
    const createClient = vi.fn();

    expect(() => createLingmouBroadcastProvider(model(overrides), {
      createClient,
      readConfigSecret: () => configSecret
    })).toThrowError(expect.objectContaining({ code }));
    expect(createClient).not.toHaveBeenCalled();
  });

  it("validates required HTTPS media URLs before invoking the SDK", async () => {
    const client = fakeClient();
    const provider = createLingmouBroadcastProvider(model(), {
      createClient: () => client,
      readConfigSecret: () => configSecret
    });

    await expect(provider.submit({
      requestName: "render-01",
      audioUrl: "http://private.example/audio.wav",
      portraitUrl: "https://private.example/portrait.png"
    })).rejects.toMatchObject({ code: "LINGMOU_BROADCAST_AUDIO_URL_INVALID" });
    expect(client.createBroadcastVideoFromTemplate).not.toHaveBeenCalled();
  });

  it("rejects a missing portrait when the template requires one before invoking the SDK", async () => {
    const client = fakeClient();
    const provider = createLingmouBroadcastProvider(model(), {
      createClient: () => client,
      readConfigSecret: () => configSecret
    });

    await expect(provider.submit({
      requestName: "render-01",
      audioUrl: "https://private.example/audio.wav",
      portraitUrl: null
    })).rejects.toMatchObject({ code: "LINGMOU_BROADCAST_PORTRAIT_URL_REQUIRED" });
    expect(client.createBroadcastVideoFromTemplate).not.toHaveBeenCalled();
  });
});

function fakeClient() {
  return {
    getBroadcastTemplate: vi.fn(),
    createBroadcastVideoFromTemplate: vi.fn(),
    listBroadcastVideosById: vi.fn()
  };
}

function model(overrides: {
  providerType?: string;
  capability?: "DIGITAL_HUMAN_VIDEO" | "DIGITAL_HUMAN_REALTIME";
  modelName?: string;
  providerSettings?: Record<string, unknown>;
  modelSettings?: Record<string, unknown>;
} = {}): ResolvedMediaModel {
  return {
    capability: overrides.capability ?? "DIGITAL_HUMAN_VIDEO",
    providerId: "lingmou-provider",
    providerName: "Lingmou",
    providerType: overrides.providerType ?? "LINGMOU",
    providerConfigVersion: 0,
    baseUrl: null,
    providerSettings: overrides.providerSettings ?? {},
    modelId: "lingmou-broadcast-model",
    modelDisplayName: "Lingmou broadcast",
    modelName: overrides.modelName ?? "lingmou-broadcast-video",
    modelSettings: {
      templateId: "template-01",
      audioVariableName: "audio",
      portraitVariableName: "portrait",
      resolution: "1080p",
      fps: 25,
      watermark: false,
      mode: "standard",
      ...overrides.modelSettings
    },
    temperature: 0,
    maxTokens: 0,
    timeoutMs: 120000,
    credentialEnvelopes: {
      apiKey: null,
      structured: encryptCredentialMap({
        accessKeyId: "lingmou-ak-id",
        accessKeySecret: "lingmou-ak-secret"
      }, configSecret)
    }
  };
}
