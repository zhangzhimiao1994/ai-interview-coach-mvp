import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptCredentialMap,
  decryptSecret,
  encryptCredentialMap
} from "@/lib/domain/aiServices";

const timestamp = new Date("2026-07-07T00:00:00.000Z");

function providerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "provider-1",
    displayName: "Alibaba Cloud",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyCiphertext: "legacy-ciphertext",
    apiKeyIv: "legacy-iv",
    apiKeyTag: "legacy-tag",
    apiKeyPreview: "sk-l****cdef",
    credentialsCiphertext: "credentials-ciphertext",
    credentialsIv: "credentials-iv",
    credentialsTag: "credentials-tag",
    credentialsPreviewJson: JSON.stringify({
      apiKey: "sk-a****7890",
      workspace: "work****pace"
    }),
    settingsJson: JSON.stringify({ region: "cn-beijing", retries: 2 }),
    enabled: true,
    notes: "vision provider",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function modelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "model-1",
    providerId: "provider-1",
    displayName: "Qwen VL Max",
    modelName: "qwen-vl-max",
    capability: "VISION_BEHAVIOR_ANALYSIS",
    temperature: 0.2,
    maxTokens: 1600,
    timeoutMs: 30000,
    costNote: "multimodal",
    settingsJson: JSON.stringify({ enableThinking: false }),
    enabled: true,
    isDefault: true,
    isSelected: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    provider: {
      id: "provider-1",
      displayName: "Alibaba Cloud",
      providerType: "OPENAI_COMPATIBLE",
      enabled: true
    },
    ...overrides
  };
}

function transactionMock<T>(tx: T) {
  return vi.fn(async (callback: (delegate: T) => unknown) => callback(tx));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("AI service API routes", () => {
  it("creates an Alibaba provider with encrypted credentials and public settings", async () => {
    vi.stubEnv("AI_CONFIG_SECRET", "route-test-config-secret");
    const prisma = {
      aiServiceProvider: {
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve(providerRow({
            ...data,
            credentialsPreviewJson: data.credentialsPreviewJson
          }))
        )
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/route");
    const response = await route.POST(
      new Request("http://localhost/api/ai-services/providers", {
        method: "POST",
        body: JSON.stringify({
          displayName: "Alibaba Cloud",
          providerType: "OPENAI_COMPATIBLE",
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          apiKey: "legacy-api-key-secret",
          credentials: {
            apiKey: "sk-alibaba-private-7890",
            workspace: "private-workspace"
          },
          settings: { region: "cn-beijing", retries: 2 },
          enabled: true,
          notes: "vision provider"
        })
      })
    );
    const payload = await response.json();
    const createData = prisma.aiServiceProvider.create.mock.calls[0][0].data;

    expect(response.status).toBe(201);
    expect(createData).toEqual(expect.objectContaining({
      apiKeyCiphertext: expect.any(String),
      apiKeyIv: expect.any(String),
      apiKeyTag: expect.any(String),
      apiKeyPreview: "lega****cret",
      credentialsCiphertext: expect.any(String),
      credentialsIv: expect.any(String),
      credentialsTag: expect.any(String),
      credentialsPreviewJson: JSON.stringify({
        apiKey: "sk-a****7890",
        workspace: "priv****pace"
      }),
      settingsJson: JSON.stringify({ region: "cn-beijing", retries: 2 })
    }));
    expect(decryptCredentialMap({
      ciphertext: createData.credentialsCiphertext,
      iv: createData.credentialsIv,
      tag: createData.credentialsTag
    }, "route-test-config-secret")).toEqual({
      apiKey: "sk-alibaba-private-7890",
      workspace: "private-workspace"
    });
    expect(payload.provider.credentialsPreview).toEqual({
      apiKey: "sk-a****7890",
      workspace: "priv****pace"
    });
    expect(payload.provider.settings).toEqual({ region: "cn-beijing", retries: 2 });

    const serialized = JSON.stringify(payload);
    for (const forbidden of [
      "legacy-api-key-secret",
      "sk-alibaba-private-7890",
      "private-workspace",
      createData.apiKeyCiphertext,
      createData.apiKeyIv,
      createData.apiKeyTag,
      createData.credentialsCiphertext,
      createData.credentialsIv,
      createData.credentialsTag,
      "route-test-config-secret",
      "settingsJson",
      "credentialsPreviewJson"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("returns a clear setup error when production API key encryption is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_CONFIG_SECRET", "");
    const prisma = {
      aiServiceProvider: {
        create: vi.fn()
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/route");
    const response = await route.POST(
      new Request("http://localhost/api/ai-services/providers", {
        method: "POST",
        body: JSON.stringify({
          displayName: "DeepSeek",
          providerType: "OPENAI_COMPATIBLE",
          apiKey: "sk-deepseek-secret-abcd"
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("AI service encryption is not configured");
    expect(payload.message).toContain("AI_CONFIG_SECRET");
    expect(prisma.aiServiceProvider.create).not.toHaveBeenCalled();
  });

  it("creates a credential-free provider without reading a production config secret", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_CONFIG_SECRET", "");
    const prisma = {
      aiServiceProvider: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve(providerRow({
          ...data,
          apiKeyCiphertext: null,
          apiKeyIv: null,
          apiKeyTag: null,
          apiKeyPreview: null,
          credentialsCiphertext: null,
          credentialsIv: null,
          credentialsTag: null,
          credentialsPreviewJson: null
        })))
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/route");
    const response = await route.POST(
      new Request("http://localhost/api/ai-services/providers", {
        method: "POST",
        body: JSON.stringify({
          displayName: "Credential-free provider",
          providerType: "OPENAI_COMPATIBLE",
          settings: { region: "local" }
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(prisma.aiServiceProvider.create).toHaveBeenCalledTimes(1);
    const data = prisma.aiServiceProvider.create.mock.calls[0][0].data;
    expect(data.apiKeyCiphertext).toBeUndefined();
    expect(data.apiKeyIv).toBeUndefined();
    expect(data.apiKeyTag).toBeUndefined();
    expect(data.credentialsCiphertext).toBeUndefined();
    expect(data.credentialsIv).toBeUndefined();
    expect(data.credentialsTag).toBeUndefined();
    expect(data.credentialsPreviewJson).toBeUndefined();
    expect(payload.provider.credentialsPreview).toEqual({});
    expect(payload.provider.settings).toEqual({ region: "local" });
  });

  it("safely parses provider and included model settings on GET", async () => {
    const prisma = {
      aiServiceProvider: {
        findMany: vi.fn().mockResolvedValue([
          providerRow({
            credentialsPreviewJson: "not-json",
            settingsJson: JSON.stringify(["not", "an", "object"]),
            models: [
              modelRow({ settingsJson: JSON.stringify({ topK: 20 }) }),
              modelRow({ id: "model-2", settingsJson: "malformed" })
            ]
          })
        ])
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/route");
    const response = await route.GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.providers[0]).toMatchObject({
      id: "provider-1",
      credentialsPreview: {},
      settings: {},
      models: [
        expect.objectContaining({ settings: { topK: 20 } }),
        expect.objectContaining({ settings: {} })
      ]
    });
    const serialized = JSON.stringify(payload);
    for (const forbidden of [
      "apiKeyCiphertext",
      "apiKeyIv",
      "apiKeyTag",
      "credentialsCiphertext",
      "credentialsIv",
      "credentialsTag",
      "credentialsPreviewJson",
      "settingsJson",
      "legacy-ciphertext",
      "credentials-ciphertext"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("allowlists provider and included model response fields", async () => {
    const prisma = {
      aiServiceProvider: {
        findMany: vi.fn().mockResolvedValue([
          providerRow({
            providerSecretSentinel: "provider-secret-sentinel",
            auditJson: "provider-raw-json-sentinel",
            models: [modelRow({
              modelSecretSentinel: "model-secret-sentinel",
              diagnosticsJson: "model-raw-json-sentinel"
            })]
          })
        ])
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/route");
    const response = await route.GET();
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    for (const forbidden of [
      "provider-secret-sentinel",
      "provider-raw-json-sentinel",
      "model-secret-sentinel",
      "model-raw-json-sentinel",
      "providerSecretSentinel",
      "auditJson",
      "modelSecretSentinel",
      "diagnosticsJson"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("allowlists model and nested provider response fields", async () => {
    const prisma = {
      aiModelConfig: {
        findMany: vi.fn().mockResolvedValue([
          modelRow({
            modelSecretSentinel: "model-list-secret-sentinel",
            metadataJson: "model-list-raw-json-sentinel",
            provider: {
              id: "provider-1",
              displayName: "Alibaba Cloud",
              providerType: "OPENAI_COMPATIBLE",
              enabled: true,
              apiKeyCiphertext: "nested-provider-ciphertext-sentinel",
              credentialsPreviewJson: "nested-provider-raw-json-sentinel",
              nestedProviderSecret: "nested-provider-secret-sentinel"
            }
          })
        ])
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/models/route");
    const response = await route.GET();
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.models[0].provider).toEqual({
      id: "provider-1",
      displayName: "Alibaba Cloud",
      providerType: "OPENAI_COMPATIBLE",
      enabled: true
    });
    for (const forbidden of [
      "model-list-secret-sentinel",
      "model-list-raw-json-sentinel",
      "nested-provider-ciphertext-sentinel",
      "nested-provider-raw-json-sentinel",
      "nested-provider-secret-sentinel",
      "modelSecretSentinel",
      "metadataJson",
      "apiKeyCiphertext",
      "credentialsPreviewJson",
      "nestedProviderSecret"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("preserves blank legacy keys and merges changed structured credentials", async () => {
    vi.stubEnv("AI_CONFIG_SECRET", "route-test-config-secret");
    const storedEnvelope = encryptCredentialMap({
      apiKey: "old-structured-key",
      workspace: "old-workspace"
    }, "route-test-config-secret");
    const existing = providerRow({
      ...Object.fromEntries(
        Object.entries(storedEnvelope).map(([key, value]) => [
          `credentials${key[0].toUpperCase()}${key.slice(1)}`,
          value
        ])
      ),
      apiKeyCiphertext: "stored-legacy-ciphertext",
      apiKeyIv: "stored-legacy-iv",
      apiKeyTag: "stored-legacy-tag"
    });
    const tx = {
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve(providerRow({
          ...existing,
          ...data
        })))
      },
      digitalHumanSession: { count: vi.fn().mockResolvedValue(0) },
      providerSessionCloseRecovery: { count: vi.fn().mockResolvedValue(0) }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiServiceProvider: { findUnique: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/[providerId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/providers/provider-1", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: "Alibaba Cloud Updated",
          apiKey: "   ",
          credentials: { apiKey: "new-structured-key", workspace: "   " }
        })
      }),
      { params: Promise.resolve({ providerId: "provider-1" }) }
    );
    const payload = await response.json();
    const updateData = tx.aiServiceProvider.update.mock.calls[0][0].data;

    expect(response.status).toBe(200);
    expect(updateData).not.toHaveProperty("apiKeyCiphertext");
    expect(updateData).not.toHaveProperty("apiKeyIv");
    expect(updateData).not.toHaveProperty("apiKeyTag");
    expect(updateData).not.toHaveProperty("settingsJson");
    expect(decryptCredentialMap({
      ciphertext: updateData.credentialsCiphertext,
      iv: updateData.credentialsIv,
      tag: updateData.credentialsTag
    }, "route-test-config-secret")).toEqual({
      apiKey: "new-structured-key",
      workspace: "old-workspace"
    });
    expect(payload.provider.displayName).toBe("Alibaba Cloud Updated");
    expect(payload.provider.credentialsPreview).toEqual({
      apiKey: "new-****-key",
      workspace: "old-****pace"
    });
    expect(payload.provider.settings).toEqual({ region: "cn-beijing", retries: 2 });
    expect(JSON.stringify(payload)).not.toContain("new-structured-key");
    expect(JSON.stringify(payload)).not.toContain(updateData.credentialsCiphertext);
    expect(prisma.aiServiceProvider.findUnique).not.toHaveBeenCalled();
    expect(prisma.aiServiceProvider.update).not.toHaveBeenCalled();
  });

  it("replaces the legacy API key only when a nonblank value is supplied", async () => {
    vi.stubEnv("AI_CONFIG_SECRET", "route-test-config-secret");
    const existing = providerRow({
      apiKeyCiphertext: "stored-legacy-ciphertext",
      apiKeyIv: "stored-legacy-iv",
      apiKeyTag: "stored-legacy-tag",
      apiKeyPreview: "stor****-key"
    });
    const tx = {
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve(providerRow({
          ...existing,
          ...data
        })))
      },
      aiModelConfig: { count: vi.fn().mockResolvedValue(0) }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiServiceProvider: { findUnique: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/[providerId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/providers/provider-1", {
        method: "PATCH",
        body: JSON.stringify({ apiKey: "new-legacy-api-key" })
      }),
      { params: Promise.resolve({ providerId: "provider-1" }) }
    );
    const payload = await response.json();
    const updateData = tx.aiServiceProvider.update.mock.calls[0][0].data;

    expect(response.status).toBe(200);
    expect(updateData).toEqual(expect.objectContaining({
      apiKeyCiphertext: expect.any(String),
      apiKeyIv: expect.any(String),
      apiKeyTag: expect.any(String),
      apiKeyPreview: "new-****-key"
    }));
    expect(updateData.apiKeyCiphertext).not.toBe("stored-legacy-ciphertext");
    expect(decryptSecret({
      ciphertext: updateData.apiKeyCiphertext,
      iv: updateData.apiKeyIv,
      tag: updateData.apiKeyTag
    }, "route-test-config-secret")).toBe("new-legacy-api-key");
    expect(payload.provider.apiKeyPreview).toBe("new-****-key");
    expect(JSON.stringify(payload)).not.toContain("new-legacy-api-key");
    expect(JSON.stringify(payload)).not.toContain(updateData.apiKeyCiphertext);
    expect(prisma.aiServiceProvider.update).not.toHaveBeenCalled();
  });

  it("replaces provider settings only when settings are supplied", async () => {
    const existing = providerRow({ settingsJson: JSON.stringify({ region: "cn-beijing" }) });
    const tx = {
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve(providerRow({
          ...existing,
          ...data
        })))
      },
      digitalHumanSession: { count: vi.fn().mockResolvedValue(0) },
      providerSessionCloseRecovery: { count: vi.fn().mockResolvedValue(0) }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiServiceProvider: { findUnique: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/[providerId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/providers/provider-1", {
        method: "PATCH",
        body: JSON.stringify({ settings: { region: "us-west", retries: 4 } })
      }),
      { params: Promise.resolve({ providerId: "provider-1" }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(tx.aiServiceProvider.update).toHaveBeenCalledWith({
      where: { id: "provider-1" },
      data: { settingsJson: JSON.stringify({ region: "us-west", retries: 4 }) }
    });
    expect(payload.provider.settings).toEqual({ region: "us-west", retries: 4 });
    expect(prisma.aiServiceProvider.update).not.toHaveBeenCalled();
  });

  it.each([
    ["provider type", { providerType: "LINGMOU" }],
    ["provider settings", { settings: { region: "us-west" } }],
    ["structured credentials", { credentials: { accessKeyId: "new-access-key-id" } }]
  ])("rejects changing close-critical %s while a cloud session may need closing", async (_case, body) => {
    vi.stubEnv("AI_CONFIG_SECRET", "route-test-config-secret");
    const existing = providerRow({
      credentialsCiphertext: null,
      credentialsIv: null,
      credentialsTag: null,
      credentialsPreviewJson: null
    });
    const tx = {
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn()
      },
      digitalHumanSession: { count: vi.fn().mockResolvedValue(1) }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiServiceProvider: { findUnique: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/[providerId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/providers/provider-1", {
        method: "PATCH",
        body: JSON.stringify(body)
      }),
      { params: Promise.resolve({ providerId: "provider-1" }) }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Conflict" });
    expect(tx.digitalHumanSession.count).toHaveBeenCalledWith({
      where: {
        providerId: "provider-1",
        mode: "LINGMOU_CLOUD",
        status: { not: "STOPPED" }
      }
    });
    expect(tx.aiServiceProvider.update).not.toHaveBeenCalled();
  });

  it("allows a display-name-only update while a cloud session is active", async () => {
    const existing = providerRow();
    const tx = {
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve(providerRow({ ...existing, ...data }))
        )
      },
      digitalHumanSession: { count: vi.fn().mockResolvedValue(1) }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiServiceProvider: { findUnique: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/[providerId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/providers/provider-1", {
        method: "PATCH",
        body: JSON.stringify({ displayName: "Safe display rename" })
      }),
      { params: Promise.resolve({ providerId: "provider-1" }) }
    );

    expect(response.status).toBe(200);
    expect((await response.json()).provider.displayName).toBe("Safe display rename");
    expect(tx.digitalHumanSession.count).not.toHaveBeenCalled();
  });

  it("rejects deleting a provider while a cloud session may need closing", async () => {
    const existing = providerRow();
    const tx = {
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(existing),
        delete: vi.fn()
      },
      digitalHumanSession: { count: vi.fn().mockResolvedValue(1) }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiServiceProvider: { findUnique: vi.fn(), delete: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/[providerId]/route");
    expect(route.DELETE).toBeTypeOf("function");
    const response = await route.DELETE(
      new Request("http://localhost/api/ai-services/providers/provider-1", {
        method: "DELETE"
      }),
      { params: Promise.resolve({ providerId: "provider-1" }) }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Conflict" });
    expect(tx.aiServiceProvider.delete).not.toHaveBeenCalled();
  });

  it("rejects close-critical mutation while a durable provider close is pending", async () => {
    const existing = providerRow();
    const tx = {
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn()
      },
      digitalHumanSession: { count: vi.fn().mockResolvedValue(0) },
      providerSessionCloseRecovery: { count: vi.fn().mockResolvedValue(1) }
    };
    const prisma = { $transaction: transactionMock(tx) };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/[providerId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/providers/provider-1", {
        method: "PATCH",
        body: JSON.stringify({ settings: { region: "us-west" } })
      }),
      { params: Promise.resolve({ providerId: "provider-1" }) }
    );

    expect(response.status).toBe(409);
    expect(tx.providerSessionCloseRecovery.count).toHaveBeenCalledWith({
      where: { providerId: "provider-1" }
    });
    expect(tx.aiServiceProvider.update).not.toHaveBeenCalled();
  });

  it("maps the database provider-in-use race guard to a bounded 409", async () => {
    const prisma = {
      $transaction: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "DIGITAL_HUMAN_PROVIDER_IN_USE raw access-key-sentinel"
          )
        )
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/[providerId]/route");
    const response = await route.DELETE(
      new Request("http://localhost/api/ai-services/providers/provider-1", {
        method: "DELETE"
      }),
      { params: Promise.resolve({ providerId: "provider-1" }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toMatchObject({ error: "Conflict" });
    expect(JSON.stringify(payload)).not.toContain("access-key-sentinel");
  });

  it("deletes a provider after all cloud sessions are confirmed stopped", async () => {
    const existing = providerRow();
    const tx = {
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(existing),
        delete: vi.fn().mockResolvedValue(existing)
      },
      digitalHumanSession: { count: vi.fn().mockResolvedValue(0) },
      providerSessionCloseRecovery: { count: vi.fn().mockResolvedValue(0) }
    };
    const prisma = { $transaction: transactionMock(tx) };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/[providerId]/route");
    const response = await route.DELETE(
      new Request("http://localhost/api/ai-services/providers/provider-1", {
        method: "DELETE"
      }),
      { params: Promise.resolve({ providerId: "provider-1" }) }
    );

    expect(response.status).toBe(200);
    expect((await response.json()).provider.id).toBe("provider-1");
    expect(tx.aiServiceProvider.delete).toHaveBeenCalledWith({
      where: { id: "provider-1" }
    });
  });

  it("clears nullable provider text fields while preserving omitted fields", async () => {
    const existing = providerRow({
      baseUrl: "https://old.example/v1",
      notes: "old notes"
    });
    const tx = {
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve(providerRow({
          ...existing,
          ...data
        })))
      }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiServiceProvider: { findUnique: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/[providerId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/providers/provider-1", {
        method: "PATCH",
        body: JSON.stringify({ baseUrl: "   ", notes: null })
      }),
      { params: Promise.resolve({ providerId: "provider-1" }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(tx.aiServiceProvider.update).toHaveBeenCalledWith({
      where: { id: "provider-1" },
      data: { baseUrl: null, notes: null }
    });
    expect(payload.provider.baseUrl).toBeNull();
    expect(payload.provider.notes).toBeNull();
    expect(prisma.aiServiceProvider.update).not.toHaveBeenCalled();
  });

  it("returns an unchanged provider for an empty patch without issuing an update", async () => {
    const existing = providerRow();
    const tx = {
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn()
      }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiServiceProvider: { findUnique: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/[providerId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/providers/provider-1", {
        method: "PATCH",
        body: JSON.stringify({})
      }),
      { params: Promise.resolve({ providerId: "provider-1" }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.provider.id).toBe("provider-1");
    expect(tx.aiServiceProvider.update).not.toHaveBeenCalled();
    expect(prisma.aiServiceProvider.update).not.toHaveBeenCalled();
  });

  it("adds structured credentials when the stored envelope is entirely null", async () => {
    vi.stubEnv("AI_CONFIG_SECRET", "route-test-config-secret");
    const existing = providerRow({
      credentialsCiphertext: null,
      credentialsIv: null,
      credentialsTag: null,
      credentialsPreviewJson: null
    });
    const tx = {
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve(providerRow({
          ...existing,
          ...data
        })))
      },
      digitalHumanSession: { count: vi.fn().mockResolvedValue(0) },
      providerSessionCloseRecovery: { count: vi.fn().mockResolvedValue(0) }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiServiceProvider: { findUnique: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/[providerId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/providers/provider-1", {
        method: "PATCH",
        body: JSON.stringify({ credentials: { apiKey: "first-structured-key" } })
      }),
      { params: Promise.resolve({ providerId: "provider-1" }) }
    );
    const data = tx.aiServiceProvider.update.mock.calls[0][0].data;

    expect(response.status).toBe(200);
    expect(decryptCredentialMap({
      ciphertext: data.credentialsCiphertext,
      iv: data.credentialsIv,
      tag: data.credentialsTag
    }, "route-test-config-secret")).toEqual({ apiKey: "first-structured-key" });
    expect(prisma.aiServiceProvider.update).not.toHaveBeenCalled();
  });

  it("updates public fields without decrypting credentials under a different config key", async () => {
    const envelope = encryptCredentialMap(
      { apiKey: "stored-structured-key" },
      "original-config-secret"
    );
    vi.stubEnv("AI_CONFIG_SECRET", "different-config-secret");
    const existing = providerRow({
      credentialsCiphertext: envelope.ciphertext,
      credentialsIv: envelope.iv,
      credentialsTag: envelope.tag
    });
    const tx = {
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve(providerRow({
          ...existing,
          ...data
        })))
      },
      aiModelConfig: { count: vi.fn().mockResolvedValue(0) }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiServiceProvider: { findUnique: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/[providerId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/providers/provider-1", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false })
      }),
      { params: Promise.resolve({ providerId: "provider-1" }) }
    );

    expect(response.status).toBe(200);
    expect(tx.aiServiceProvider.update).toHaveBeenCalledWith({
      where: { id: "provider-1" },
      data: { enabled: false }
    });
    expect(prisma.aiServiceProvider.update).not.toHaveBeenCalled();
  });

  it("rejects disabling a provider that still owns a selected model", async () => {
    const existing = providerRow({ enabled: true });
    const tx = {
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn()
      },
      aiModelConfig: { count: vi.fn().mockResolvedValue(1) }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiServiceProvider: { findUnique: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/[providerId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/providers/provider-1", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false })
      }),
      { params: Promise.resolve({ providerId: "provider-1" }) }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Conflict" });
    expect(tx.aiModelConfig.count).toHaveBeenCalledWith({
      where: { providerId: "provider-1", isSelected: true }
    });
    expect(tx.aiServiceProvider.update).not.toHaveBeenCalled();
  });

  it("returns 404 when updating a missing provider", async () => {
    const tx = {
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn()
      }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiServiceProvider: { findUnique: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/[providerId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/providers/missing", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false })
      }),
      { params: Promise.resolve({ providerId: "missing" }) }
    );

    expect(response.status).toBe(404);
    expect(tx.aiServiceProvider.update).not.toHaveBeenCalled();
    expect(prisma.aiServiceProvider.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an incomplete stored credential envelope without erasing it", async () => {
    const tx = {
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(providerRow({
          credentialsCiphertext: "stored-ciphertext",
          credentialsIv: null,
          credentialsTag: "stored-tag"
        })),
        update: vi.fn()
      }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiServiceProvider: { findUnique: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/[providerId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/providers/provider-1", {
        method: "PATCH",
        body: JSON.stringify({ credentials: { apiKey: "replacement-key" } })
      }),
      { params: Promise.resolve({ providerId: "provider-1" }) }
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
    expect(tx.aiServiceProvider.update).not.toHaveBeenCalled();
    expect(prisma.aiServiceProvider.update).not.toHaveBeenCalled();
  });

  it.each([
    ["empty string with null components", {
      credentialsCiphertext: "",
      credentialsIv: null,
      credentialsTag: null
    }],
    ["empty string with populated components", {
      credentialsCiphertext: "",
      credentialsIv: "stored-iv",
      credentialsTag: "stored-tag"
    }]
  ])("rejects a stored credential envelope containing %s", async (_case, envelope) => {
    const tx = {
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(providerRow(envelope)),
        update: vi.fn()
      }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiServiceProvider: { findUnique: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/providers/[providerId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/providers/provider-1", {
        method: "PATCH",
        body: JSON.stringify({ credentials: { apiKey: "replacement-key" } })
      }),
      { params: Promise.resolve({ providerId: "provider-1" }) }
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
    expect(tx.aiServiceProvider.update).not.toHaveBeenCalled();
    expect(prisma.aiServiceProvider.update).not.toHaveBeenCalled();
  });

  it.each([
    ["provider", "@/app/api/ai-services/providers/[providerId]/route", { enabled: false, unknown: true }],
    ["model", "@/app/api/ai-services/models/[modelId]/route", { enabled: false, unknown: true }]
  ])("strictly rejects unknown %s update fields", async (kind, modulePath, body) => {
    const prisma = {
      $transaction: vi.fn(),
      aiServiceProvider: { findUnique: vi.fn(), update: vi.fn() },
      aiModelConfig: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import(modulePath);
    const response = await route.PATCH(
      new Request(`http://localhost/api/ai-services/${kind}s/item-1`, {
        method: "PATCH",
        body: JSON.stringify(body)
      }),
      { params: Promise.resolve(kind === "provider" ? { providerId: "item-1" } : { modelId: "item-1" }) }
    );

    expect(response.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates a recommended model without changing other recommendations", async () => {
    const tx = {
      aiModelConfig: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue(modelRow())
      }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiModelConfig: { updateMany: vi.fn(), create: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/models/route");
    const response = await route.POST(
      new Request("http://localhost/api/ai-services/models", {
        method: "POST",
        body: JSON.stringify({
          providerId: "provider-1",
          displayName: "Qwen VL Max",
          modelName: "qwen-vl-max",
          capability: "VISION_BEHAVIOR_ANALYSIS",
          settings: { enableThinking: false },
          isDefault: true
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.aiModelConfig.updateMany).not.toHaveBeenCalled();
    expect(tx.aiModelConfig.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        modelName: "qwen-vl-max",
        capability: "VISION_BEHAVIOR_ANALYSIS",
        settingsJson: JSON.stringify({ enableThinking: false }),
        isDefault: true
      }),
      include: expect.any(Object)
    });
    expect(tx.aiModelConfig.create.mock.calls[0][0].data).not.toHaveProperty("settings");
    expect(prisma.aiModelConfig.updateMany).not.toHaveBeenCalled();
    expect(prisma.aiModelConfig.create).not.toHaveBeenCalled();
    expect(payload.model.settings).toEqual({ enableThinking: false });
    expect(payload.model).not.toHaveProperty("settingsJson");
  });

  it("keeps recommendation metadata independent from model enablement", async () => {
    const tx = {
      aiModelConfig: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue(modelRow({ enabled: false, isDefault: true, isSelected: false }))
      }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiModelConfig: { updateMany: vi.fn(), create: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/models/route");
    const response = await route.POST(
      new Request("http://localhost/api/ai-services/models", {
        method: "POST",
        body: JSON.stringify({
          providerId: "provider-1",
          displayName: "Default model",
          modelName: "default-model",
          capability: "REPORT_ANALYSIS",
          enabled: false,
          isDefault: true
        })
      })
    );

    expect(response.status).toBe(201);
    expect(tx.aiModelConfig.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ enabled: false, isDefault: true, isSelected: false }),
      include: expect.any(Object)
    });
    expect(prisma.aiModelConfig.create).not.toHaveBeenCalled();
  });

  it("clears model cost notes while preserving an omitted cost note", async () => {
    const existing = {
      id: "model-1",
      capability: "REPORT_ANALYSIS",
      enabled: true,
      isDefault: false,
      isSelected: false
    };
    const tx = {
      aiModelConfig: {
        findUnique: vi.fn().mockResolvedValue(existing),
        updateMany: vi.fn(),
        update: vi.fn()
          .mockResolvedValueOnce(modelRow({ costNote: null }))
          .mockResolvedValueOnce(modelRow({ displayName: "Renamed", costNote: "preserved" }))
      }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiModelConfig: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/models/[modelId]/route");
    const clearResponse = await route.PATCH(
      new Request("http://localhost/api/ai-services/models/model-1", {
        method: "PATCH",
        body: JSON.stringify({ costNote: "   " })
      }),
      { params: Promise.resolve({ modelId: "model-1" }) }
    );
    const omitResponse = await route.PATCH(
      new Request("http://localhost/api/ai-services/models/model-1", {
        method: "PATCH",
        body: JSON.stringify({ displayName: "Renamed" })
      }),
      { params: Promise.resolve({ modelId: "model-1" }) }
    );

    expect(clearResponse.status).toBe(200);
    expect(omitResponse.status).toBe(200);
    expect(tx.aiModelConfig.update.mock.calls[0][0].data).toEqual({ costNote: null });
    expect(tx.aiModelConfig.update.mock.calls[1][0].data).toEqual({ displayName: "Renamed" });
    expect(prisma.aiModelConfig.update).not.toHaveBeenCalled();
  });

  it("rejects disabling the currently selected model", async () => {
    const tx = {
      aiModelConfig: {
        findUnique: vi.fn().mockResolvedValue({
          id: "model-1",
          capability: "REPORT_ANALYSIS",
          enabled: true,
          isDefault: true,
          isSelected: true
        }),
        updateMany: vi.fn(),
        update: vi.fn()
      }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiModelConfig: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/models/[modelId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/models/model-1", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false })
      }),
      { params: Promise.resolve({ modelId: "model-1" }) }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Conflict" });
    expect(tx.aiModelConfig.updateMany).not.toHaveBeenCalled();
    expect(tx.aiModelConfig.update).not.toHaveBeenCalled();
    expect(prisma.aiModelConfig.update).not.toHaveBeenCalled();
  });

  it("preserves recommendation metadata when editing a disabled model", async () => {
    const tx = {
      aiModelConfig: {
        findUnique: vi.fn().mockResolvedValue({
          id: "model-legacy",
          capability: "REPORT_ANALYSIS",
          enabled: false,
          isDefault: true,
          isSelected: false
        }),
        updateMany: vi.fn(),
        update: vi.fn().mockResolvedValue(modelRow({
          id: "model-legacy",
          displayName: "Legacy renamed",
          enabled: false,
          isDefault: true,
          isSelected: false
        }))
      }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiModelConfig: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/models/[modelId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/models/model-legacy", {
        method: "PATCH",
        body: JSON.stringify({ displayName: "Legacy renamed" })
      }),
      { params: Promise.resolve({ modelId: "model-legacy" }) }
    );

    expect(response.status).toBe(200);
    expect(tx.aiModelConfig.updateMany).not.toHaveBeenCalled();
    expect(tx.aiModelConfig.update).toHaveBeenCalledWith({
      where: { id: "model-legacy" },
      data: { displayName: "Legacy renamed" },
      include: expect.any(Object)
    });
    expect(prisma.aiModelConfig.findUnique).not.toHaveBeenCalled();
    expect(prisma.aiModelConfig.updateMany).not.toHaveBeenCalled();
    expect(prisma.aiModelConfig.update).not.toHaveBeenCalled();
  });

  it("selects the runtime model without changing its recommendation state", async () => {
    const tx = {
      aiModelConfig: {
        findUnique: vi.fn().mockResolvedValue({
          id: "model-2",
          providerId: "provider-1",
          capability: "REPORT_ANALYSIS",
          enabled: false,
          isDefault: false,
          isSelected: false
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(modelRow({
          id: "model-2",
          capability: "REPORT_ANALYSIS",
          enabled: true,
          isDefault: false,
          isSelected: true
        }))
      },
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue({ enabled: true })
      }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiModelConfig: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/models/[modelId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/models/model-2", {
        method: "PATCH",
        body: JSON.stringify({ isSelected: true })
      }),
      { params: Promise.resolve({ modelId: "model-2" }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(tx.aiModelConfig.updateMany).toHaveBeenCalledWith({
      where: {
        capability: "REPORT_ANALYSIS",
        id: { not: "model-2" }
      },
      data: { isSelected: false }
    });
    expect(tx.aiModelConfig.update).toHaveBeenCalledWith({
      where: { id: "model-2" },
      data: { enabled: true, isSelected: true },
      include: expect.any(Object)
    });
    expect(tx.aiModelConfig.update.mock.calls[0][0].data).not.toHaveProperty("isDefault");
    expect(payload.model).toMatchObject({
      isDefault: false,
      isSelected: true
    });
  });

  it("rejects selecting a model whose provider is disabled", async () => {
    const tx = {
      aiModelConfig: {
        findUnique: vi.fn().mockResolvedValue({
          id: "model-2",
          providerId: "provider-1",
          capability: "REPORT_ANALYSIS",
          enabled: true,
          isDefault: false,
          isSelected: false
        }),
        updateMany: vi.fn(),
        update: vi.fn()
      },
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue({ enabled: false })
      }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiModelConfig: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/models/[modelId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/models/model-2", {
        method: "PATCH",
        body: JSON.stringify({ isSelected: true })
      }),
      { params: Promise.resolve({ modelId: "model-2" }) }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Conflict" });
    expect(tx.aiModelConfig.updateMany).not.toHaveBeenCalled();
    expect(tx.aiModelConfig.update).not.toHaveBeenCalled();
  });

  it("rejects clearing the currently selected model without a replacement", async () => {
    const tx = {
      aiModelConfig: {
        findUnique: vi.fn().mockResolvedValue({
          id: "model-1",
          providerId: "provider-1",
          capability: "REPORT_ANALYSIS",
          enabled: true,
          isDefault: false,
          isSelected: true
        }),
        updateMany: vi.fn(),
        update: vi.fn()
      }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiModelConfig: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/models/[modelId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/models/model-1", {
        method: "PATCH",
        body: JSON.stringify({ isSelected: false })
      }),
      { params: Promise.resolve({ modelId: "model-1" }) }
    );

    expect(response.status).toBe(409);
    expect(tx.aiModelConfig.update).not.toHaveBeenCalled();
  });

  it("edits recommended model settings without changing other recommendations", async () => {
    const tx = {
      aiModelConfig: {
        findUnique: vi.fn().mockResolvedValue({
          id: "model-1",
          capability: "REPORT_ANALYSIS",
          enabled: true,
          isDefault: true,
          isSelected: false
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(modelRow({
          modelName: "qwen-vl-plus",
          settingsJson: JSON.stringify({ topK: 40 })
        }))
      }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiModelConfig: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/models/[modelId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/models/model-1", {
        method: "PATCH",
        body: JSON.stringify({
          modelName: "qwen-vl-plus",
          capability: "VISION_BEHAVIOR_ANALYSIS",
          settings: { topK: 40 }
        })
      }),
      { params: Promise.resolve({ modelId: "model-1" }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(tx.aiModelConfig.updateMany).not.toHaveBeenCalled();
    expect(tx.aiModelConfig.update).toHaveBeenCalledWith({
      where: { id: "model-1" },
      data: {
        modelName: "qwen-vl-plus",
        capability: "VISION_BEHAVIOR_ANALYSIS",
        settingsJson: JSON.stringify({ topK: 40 })
      },
      include: expect.any(Object)
    });
    expect(payload.model.settings).toEqual({ topK: 40 });
    expect(payload.model).not.toHaveProperty("settingsJson");
    expect(prisma.aiModelConfig.findUnique).not.toHaveBeenCalled();
    expect(prisma.aiModelConfig.updateMany).not.toHaveBeenCalled();
    expect(prisma.aiModelConfig.update).not.toHaveBeenCalled();
  });

  it("patches every editable model field without coupling recommendation to selection", async () => {
    const tx = {
      aiModelConfig: {
        findUnique: vi.fn().mockResolvedValue({
          id: "model-2",
          capability: "INTERVIEW_FOLLOW_UP",
          enabled: false,
          isDefault: false,
          isSelected: false
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(modelRow({
          id: "model-2",
          capability: "INTERVIEW_FOLLOW_UP",
          isDefault: true
        }))
      }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiModelConfig: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/models/[modelId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/models/model-2", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: "Qwen Follow-up Updated",
          modelName: "qwen-plus-latest",
          capability: "VISION_BEHAVIOR_ANALYSIS",
          temperature: 0.7,
          maxTokens: 4096,
          timeoutMs: 45000,
          costNote: "updated pricing",
          enabled: false,
          isDefault: true
        })
      }),
      { params: Promise.resolve({ modelId: "model-2" }) }
    );

    expect(response.status).toBe(200);
    expect(tx.aiModelConfig.updateMany).not.toHaveBeenCalled();
    expect(tx.aiModelConfig.update).toHaveBeenCalledWith({
      where: { id: "model-2" },
      data: {
        displayName: "Qwen Follow-up Updated",
        modelName: "qwen-plus-latest",
        capability: "VISION_BEHAVIOR_ANALYSIS",
        temperature: 0.7,
        maxTokens: 4096,
        timeoutMs: 45000,
        costNote: "updated pricing",
        enabled: false,
        isDefault: true
      },
      include: expect.any(Object)
    });
    expect(tx.aiModelConfig.update.mock.calls[0][0].data).not.toHaveProperty("settingsJson");
    expect(prisma.aiModelConfig.findUnique).not.toHaveBeenCalled();
    expect(prisma.aiModelConfig.updateMany).not.toHaveBeenCalled();
    expect(prisma.aiModelConfig.update).not.toHaveBeenCalled();
  });

  it("deletes a non-selected model configuration with safe settings serialization", async () => {
    const tx = {
      aiModelConfig: {
        findUnique: vi.fn().mockResolvedValue({ isSelected: false }),
        delete: vi.fn().mockResolvedValue(modelRow({
          id: "model-3",
          settingsJson: "malformed",
          enabled: false,
          isDefault: false,
          isSelected: false
        }))
      }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiModelConfig: { findUnique: vi.fn(), delete: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/models/[modelId]/route");
    const response = await route.DELETE(
      new Request("http://localhost/api/ai-services/models/model-3"),
      { params: Promise.resolve({ modelId: "model-3" }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(tx.aiModelConfig.delete).toHaveBeenCalledWith({
      where: { id: "model-3" },
      include: expect.any(Object)
    });
    expect(payload.model.id).toBe("model-3");
    expect(payload.model.settings).toEqual({});
    expect(payload.model).not.toHaveProperty("settingsJson");
    expect(prisma.aiModelConfig.delete).not.toHaveBeenCalled();
  });

  it("rejects deleting the currently selected model", async () => {
    const tx = {
      aiModelConfig: {
        findUnique: vi.fn().mockResolvedValue({ isSelected: true }),
        delete: vi.fn()
      }
    };
    const prisma = {
      $transaction: transactionMock(tx),
      aiModelConfig: { findUnique: vi.fn(), delete: vi.fn() }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/models/[modelId]/route");
    const response = await route.DELETE(
      new Request("http://localhost/api/ai-services/models/model-1"),
      { params: Promise.resolve({ modelId: "model-1" }) }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Conflict" });
    expect(tx.aiModelConfig.delete).not.toHaveBeenCalled();
  });
});
