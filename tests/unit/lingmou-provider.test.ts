import { describe, expect, it, vi } from "vitest";
import {
  CloseChatInstanceSessionsRequest,
  CreateChatSessionRequest
} from "@alicloud/lingmou20250527";
import { encryptCredentialMap } from "@/lib/domain/aiServices";
import type { ResolvedMediaModel } from "@/lib/media/config";
import {
  MediaConfigurationError,
  MediaProviderError
} from "@/lib/media/errors";
import { createLingmouProvider } from "@/lib/media/providers/lingmou";
import { resolveLingmouCredentials } from "@/lib/media/providers/lingmouCredentials";

const configSecret = "lingmou-test-config-secret";
const rtcParams = {
  appId: "rtc-app",
  avatarUserId: "avatar-user",
  channel: "rtc-channel",
  clientUserId: "client-user",
  serverUserId: "server-user",
  timestamp: 1_782_000_000,
  token: "short-lived-rtc-token",
  gslb: "https://must-not-leave-adapter.example",
  nonce: "must-not-leave-adapter"
};

const invalidCredentialCases: Array<[
  string,
  Record<string, string>,
  Record<string, string>,
  string,
  Record<string, string>?
]> = [
  ["accessKeyId", { accessKeyId: "" }, {}, "LINGMOU_ACCESS_KEY_ID_REQUIRED"],
  ["accessKeySecret", { accessKeySecret: "" }, {}, "LINGMOU_ACCESS_KEY_SECRET_REQUIRED"],
  ["region", {}, { region: "" }, "LINGMOU_REGION_INVALID"],
  ["unsupported region", {}, { region: "cn-shanghai" }, "LINGMOU_REGION_INVALID"],
  ["configId", {}, {}, "LINGMOU_CONFIG_ID_REQUIRED", { configId: "" }],
  ["instanceId", {}, {}, "LINGMOU_INSTANCE_ID_REQUIRED", { instanceId: "" }]
];

describe("Lingmou credentials", () => {
  it("rejects a model that is not provided by LINGMOU", () => {
    expect(() => resolveLingmouCredentials(
      resolvedModel({ providerType: "TONGYI" }),
      () => configSecret
    )).toThrowError(expect.objectContaining({
      name: "MediaConfigurationError",
      code: "LINGMOU_PROVIDER_REQUIRED"
    }));
  });

  it.each(invalidCredentialCases)("rejects a missing or invalid %s", (
    _field,
    credentialOverrides,
    providerSettings,
    code,
    modelSettings = {}
  ) => {
    const model = resolvedModel({
      credentials: {
        accessKeyId: "lingmou-ak-id",
        accessKeySecret: "lingmou-ak-secret",
        ...credentialOverrides
      },
      providerSettings: { region: "cn-beijing", ...providerSettings },
      modelSettings: {
        configId: "chat-config-id",
        instanceId: "paid-instance-id",
        renderMode: "cloud",
        integrationMode: "audio-driven",
        ...modelSettings
      }
    });

    expect(() => resolveLingmouCredentials(model, () => configSecret))
      .toThrowError(expect.objectContaining({
        name: "MediaConfigurationError",
        code
      }));
  });

  it("returns only the decrypted official API credentials and required IDs", () => {
    const credentials = resolveLingmouCredentials(
      resolvedModel(),
      () => configSecret
    );

    expect(credentials).toEqual({
      accessKeyId: "lingmou-ak-id",
      accessKeySecret: "lingmou-ak-secret",
      region: "cn-beijing",
      configId: "chat-config-id",
      instanceId: "paid-instance-id"
    });
  });
});

describe("Lingmou OpenAPI adapter", () => {
  it("creates an official request and returns only the RTC white-list DTO", async () => {
    const client = fakeClient();
    const createClient = vi.fn(() => client);
    const provider = createLingmouProvider(resolvedModel(), {
      createClient,
      readConfigSecret: () => configSecret
    });

    const result = await provider.createSession();

    expect(createClient).toHaveBeenCalledWith({
      accessKeyId: "lingmou-ak-id",
      accessKeySecret: "lingmou-ak-secret",
      region: "cn-beijing",
      configId: "chat-config-id",
      instanceId: "paid-instance-id"
    });
    expect(client.createChatSession).toHaveBeenCalledWith(
      "chat-config-id",
      expect.any(CreateChatSessionRequest)
    );
    const request = client.createChatSession.mock.calls[0][1];
    expect(request).toMatchObject({ instanceId: "paid-instance-id" });
    expect(result).toEqual({
      providerSessionId: "provider-session-id",
      connection: {
        appId: "rtc-app",
        avatarUserId: "avatar-user",
        channel: "rtc-channel",
        clientUserId: "client-user",
        serverUserId: "server-user",
        timestamp: 1_782_000_000,
        token: "short-lived-rtc-token",
        sessionId: "provider-session-id"
      }
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("gslb");
    expect(serialized).not.toContain("nonce");
    expect(serialized).not.toContain("lingmou-ak-id");
    expect(serialized).not.toContain("lingmou-ak-secret");
    expect(serialized).not.toContain("raw-response-sentinel");
  });

  it.each([
    "success",
    "sessionId",
    "appId",
    "avatarUserId",
    "channel",
    "clientUserId",
    "serverUserId",
    "timestamp",
    "token"
  ])("rejects a response missing required field %s", async (field) => {
    const response = successfulResponse();
    if (field === "success") {
      response.body.success = false;
    } else if (field === "sessionId") {
      Reflect.deleteProperty(response.body.data, "sessionId");
    } else {
      Reflect.deleteProperty(response.body.data.rtcParams, field);
    }
    const client = fakeClient(response);
    const provider = createLingmouProvider(resolvedModel(), {
      createClient: () => client,
      readConfigSecret: () => configSecret
    });

    await expect(provider.createSession()).rejects.toMatchObject({
      name: "MediaProviderError",
      code: "LINGMOU_UPSTREAM_FAILED"
    });
  });

  it("closes exactly the requested provider session once per adapter call", async () => {
    const client = fakeClient();
    const provider = createLingmouProvider(resolvedModel(), {
      createClient: () => client,
      readConfigSecret: () => configSecret
    });

    await provider.closeSession("provider-session-id");
    await provider.closeSession("provider-session-id");

    expect(client.closeChatInstanceSessions).toHaveBeenCalledTimes(2);
    for (const call of client.closeChatInstanceSessions.mock.calls) {
      expect(call[0]).toBe("paid-instance-id");
      expect(call[1]).toBeInstanceOf(CloseChatInstanceSessionsRequest);
      expect(call[1]).toMatchObject({ sessionIds: ["provider-session-id"] });
    }
  });

  it.each([
    [{ code: "InvalidAccessKeyId", message: "raw-auth-secret" }, "LINGMOU_AUTH_FAILED"],
    [{ code: "ChatConfigNotFound", message: "raw-config-secret" }, "LINGMOU_CONFIG_NOT_FOUND"],
    [{ code: "InstanceUnavailable", message: "raw-instance-secret" }, "LINGMOU_INSTANCE_UNAVAILABLE"],
    [{ code: "UnexpectedCloudFailure", message: "raw-upstream-secret" }, "LINGMOU_UPSTREAM_FAILED"]
  ])("maps SDK errors without exposing raw details", async (sdkError, code) => {
    const client = fakeClient();
    client.createChatSession.mockRejectedValue(sdkError);
    const provider = createLingmouProvider(resolvedModel(), {
      createClient: () => client,
      readConfigSecret: () => configSecret
    });

    let caught: unknown;
    try {
      await provider.createSession();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MediaProviderError);
    expect(caught).toMatchObject({ code, provider: "LINGMOU" });
    expect(JSON.stringify(caught)).not.toContain(sdkError.message);
    expect((caught as Error).message).not.toContain(sdkError.message);
  });

  it("maps close failures through the same safe error boundary", async () => {
    const client = fakeClient();
    client.closeChatInstanceSessions.mockRejectedValue({
      statusCode: 403,
      message: "raw-close-auth-secret"
    });
    const provider = createLingmouProvider(resolvedModel(), {
      createClient: () => client,
      readConfigSecret: () => configSecret
    });

    await expect(provider.closeSession("provider-session-id")).rejects
      .toMatchObject({ code: "LINGMOU_AUTH_FAILED" });
  });
});

function successfulResponse() {
  return {
    rawResponse: "raw-response-sentinel",
    body: {
      success: true,
      data: {
        sessionId: "provider-session-id",
        rtcParams: { ...rtcParams }
      }
    }
  };
}

function fakeClient(response = successfulResponse()) {
  return {
    createChatSession: vi.fn().mockResolvedValue(response),
    closeChatInstanceSessions: vi.fn().mockResolvedValue({
      body: { success: true }
    })
  };
}

function resolvedModel(overrides: {
  providerType?: string;
  credentials?: Record<string, string>;
  providerSettings?: Record<string, unknown>;
  modelSettings?: Record<string, unknown>;
} = {}): ResolvedMediaModel {
  const credentials = encryptCredentialMap(
    overrides.credentials ?? {
      accessKeyId: "lingmou-ak-id",
      accessKeySecret: "lingmou-ak-secret"
    },
    configSecret
  );

  return {
    capability: "DIGITAL_HUMAN_REALTIME",
    providerId: "lingmou-provider",
    providerName: "灵眸数字人",
    providerType: overrides.providerType ?? "LINGMOU",
    baseUrl: null,
    providerSettings: overrides.providerSettings ?? { region: "cn-beijing" },
    modelId: "lingmou-model",
    modelDisplayName: "灵眸云渲染数字人",
    modelName: "lingmou-2d-cloud-audio-driven",
    modelSettings: overrides.modelSettings ?? {
      configId: "chat-config-id",
      instanceId: "paid-instance-id",
      renderMode: "cloud",
      integrationMode: "audio-driven"
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
