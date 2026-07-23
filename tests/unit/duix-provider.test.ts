import { describe, expect, it } from "vitest";
import { encryptCredentialMap } from "@/lib/domain/aiServices";
import type { ResolvedMediaModel } from "@/lib/media/config";
import {
  createDuixProvider,
  createDuixSign
} from "@/lib/media/providers/duix";
import {
  duixAdapterContract,
  resolveDuixCredentials
} from "@/lib/media/providers/duixCredentials";

const configSecret = "duix-test-config-secret";

describe("DUIX credentials", () => {
  it("rejects a model that is not provided by DUIX", () => {
    expect(() =>
      resolveDuixCredentials(resolvedModel({ providerType: "LINGMOU" }), () =>
        configSecret
      )
    ).toThrowError(
      expect.objectContaining({
        name: "MediaConfigurationError",
        code: "DUIX_PROVIDER_REQUIRED"
      })
    );
  });

  it.each([
    ["appId", { appId: "" }, {}, "DUIX_APP_ID_REQUIRED"],
    ["appSecret", { appSecret: "" }, {}, "DUIX_APP_SECRET_REQUIRED"],
    ["conversationId", {}, { conversationId: "" }, "DUIX_CONVERSATION_ID_REQUIRED"]
  ])(
    "rejects a missing %s with a safe fixed code",
    (_field, credentials, modelSettings, code) => {
      expect(() =>
        resolveDuixCredentials(
          resolvedModel({
            credentials: {
              appId: "app-id-1",
              appSecret: "secret-1",
              ...credentials
            },
            modelSettings: {
              conversationId: "conv-1",
              ...modelSettings
            }
          }),
          () => configSecret
        )
      ).toThrowError(
        expect.objectContaining({
          name: "MediaConfigurationError",
          code
        })
      );
    }
  );

  it.each([
    ["model name", { modelName: "another-duix-model" }],
    ["client", { modelSettings: { client: "native" } }],
    ["interaction mode", { modelSettings: { interactionMode: "full-chain" } }],
    ["speech mode", { modelSettings: { speechMode: "external-audio" } }]
  ])("rejects unsupported adapter %s", (_field, overrides) => {
    expect(() =>
      resolveDuixCredentials(resolvedModel(overrides), () => configSecret)
    ).toThrowError(
      expect.objectContaining({
        name: "MediaConfigurationError",
        code: "DUIX_ADAPTER_CONFIG_INVALID"
      })
    );
  });

  it("returns only decrypted app credentials and browser-safe session fields", () => {
    const credentials = resolveDuixCredentials(
      resolvedModel(),
      () => configSecret
    );

    expect(credentials).toEqual({
      appId: "app-id-1",
      appSecret: "secret-1",
      conversationId: "conv-1",
      platform: "duix.com"
    });
  });
});

describe("DUIX H5 adapter", () => {
  it("creates a signed browser connection without leaking appSecret", async () => {
    const provider = createDuixProvider(resolvedModel(), {
      readConfigSecret: () => configSecret,
      now: () => new Date("2026-07-23T00:00:00.000Z"),
      randomId: () => "trace-1"
    });

    const session = await provider.createSession({
      trainingSessionId: "training-1"
    });

    expect(session).toMatchObject({
      provider: "硅基 DUIX",
      model: duixAdapterContract.modelName,
      mode: "duix-h5-direct-drive",
      traceId: "trace-1",
      fallbackUsed: false,
      sessionId: "trace-1",
      providerSessionId: "trace-1",
      connection: {
        protocol: "webrtc",
        metadata: {
          adapter: "DUIX_H5_SDK",
          conversationId: "conv-1",
          platform: "duix.com",
          sdkPackage: "duix-guiji",
          openAsr: false,
          speechMode: "duix-managed"
        }
      },
      expiresAt: "2026-07-23T00:10:00.000Z"
    });
    const sign = session.connection.metadata?.sign;
    expect(typeof sign).toBe("string");
    expect(String(sign).split(".")).toHaveLength(3);
    expect(JSON.stringify(session)).not.toContain("secret-1");
  });

  it("generates deterministic HS256 JWT sign payloads", () => {
    const sign = createDuixSign({
      appId: "app-id-1",
      appSecret: "secret-1",
      now: new Date("2026-07-23T00:00:00.000Z"),
      ttlSeconds: 600
    });
    const [header, payload, signature] = sign.split(".");

    expect(JSON.parse(Buffer.from(header, "base64url").toString("utf8"))).toEqual({
      alg: "HS256",
      typ: "JWT"
    });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))).toEqual({
      appId: "app-id-1",
      iat: 1_784_764_800,
      exp: 1_784_765_400
    });
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("keeps speak and stop server-side as safe lifecycle no-ops", async () => {
    const provider = createDuixProvider(resolvedModel(), {
      readConfigSecret: () => configSecret,
      now: () => new Date("2026-07-23T00:00:00.000Z"),
      randomId: () => "trace-2"
    });

    await expect(
      provider.speak("trace-2", { text: "你好", requestId: "question-1" })
    ).resolves.toMatchObject({
      provider: "硅基 DUIX",
      model: duixAdapterContract.modelName,
      mode: "duix-h5-client-speak",
      traceId: "question-1",
      fallbackUsed: false,
      speechId: "question-1",
      accepted: true
    });
    await expect(provider.stopSession("trace-2")).resolves.toBeUndefined();
  });
});

function resolvedModel(overrides: {
  providerType?: string;
  modelName?: string;
  credentials?: Record<string, string>;
  providerSettings?: Record<string, unknown>;
  modelSettings?: Record<string, unknown>;
} = {}): ResolvedMediaModel {
  const credentials = encryptCredentialMap(
    overrides.credentials ?? {
      appId: "app-id-1",
      appSecret: "secret-1"
    },
    configSecret
  );

  return {
    capability: "DIGITAL_HUMAN_REALTIME",
    providerId: "duix-provider",
    providerName: "硅基 DUIX",
    providerType: overrides.providerType ?? "DUIX",
    providerConfigVersion: 0,
    baseUrl: null,
    providerSettings: {
      platform: "duix.com",
      ...overrides.providerSettings
    },
    modelId: "duix-model",
    modelDisplayName: "DUIX 2D 端渲染实时数字人",
    modelName: overrides.modelName ?? "duix-h5-realtime",
    modelSettings: {
      conversationId: "conv-1",
      client: "web",
      interactionMode: "direct-drive",
      speechMode: "duix-managed",
      ...overrides.modelSettings
    },
    temperature: 0.4,
    maxTokens: 1200,
    timeoutMs: 30_000,
    credentialEnvelopes: {
      apiKey: null,
      structured: credentials
    }
  };
}
