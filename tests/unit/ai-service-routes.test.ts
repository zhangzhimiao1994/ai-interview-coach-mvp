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
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma)),
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve(providerRow({
          ...existing,
          ...data
        })))
      }
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
    const updateData = prisma.aiServiceProvider.update.mock.calls[0][0].data;

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
  });

  it("replaces the legacy API key only when a nonblank value is supplied", async () => {
    vi.stubEnv("AI_CONFIG_SECRET", "route-test-config-secret");
    const existing = providerRow({
      apiKeyCiphertext: "stored-legacy-ciphertext",
      apiKeyIv: "stored-legacy-iv",
      apiKeyTag: "stored-legacy-tag",
      apiKeyPreview: "stor****-key"
    });
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma)),
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve(providerRow({
          ...existing,
          ...data
        })))
      }
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
    const updateData = prisma.aiServiceProvider.update.mock.calls[0][0].data;

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
  });

  it("replaces provider settings only when settings are supplied", async () => {
    const existing = providerRow({ settingsJson: JSON.stringify({ region: "cn-beijing" }) });
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma)),
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve(providerRow({
          ...existing,
          ...data
        })))
      }
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
    expect(prisma.aiServiceProvider.update).toHaveBeenCalledWith({
      where: { id: "provider-1" },
      data: { settingsJson: JSON.stringify({ region: "us-west", retries: 4 }) }
    });
    expect(payload.provider.settings).toEqual({ region: "us-west", retries: 4 });
  });

  it("returns 404 when updating a missing provider", async () => {
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma)),
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn()
      }
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
    expect(prisma.aiServiceProvider.update).not.toHaveBeenCalled();
  });

  it("rejects an incomplete stored credential envelope without erasing it", async () => {
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma)),
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(providerRow({
          credentialsCiphertext: "stored-ciphertext",
          credentialsIv: null,
          credentialsTag: "stored-tag"
        })),
        update: vi.fn()
      }
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
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma)),
      aiServiceProvider: {
        findUnique: vi.fn().mockResolvedValue(providerRow(envelope)),
        update: vi.fn()
      }
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

  it("creates a default model with settings in one transaction", async () => {
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma)),
      aiModelConfig: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue(modelRow())
      }
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
    expect(prisma.aiModelConfig.updateMany).toHaveBeenCalledWith({
      where: { capability: "VISION_BEHAVIOR_ANALYSIS" },
      data: { isDefault: false }
    });
    expect(prisma.aiModelConfig.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        modelName: "qwen-vl-max",
        capability: "VISION_BEHAVIOR_ANALYSIS",
        settingsJson: JSON.stringify({ enableThinking: false }),
        isDefault: true
      }),
      include: expect.any(Object)
    });
    expect(prisma.aiModelConfig.create.mock.calls[0][0].data).not.toHaveProperty("settings");
    expect(payload.model.settings).toEqual({ enableThinking: false });
    expect(payload.model).not.toHaveProperty("settingsJson");
  });

  it("edits model settings and clears defaults in the target capability", async () => {
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma)),
      aiModelConfig: {
        findUnique: vi.fn().mockResolvedValue({
          id: "model-1",
          capability: "REPORT_ANALYSIS",
          isDefault: true
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(modelRow({
          modelName: "qwen-vl-plus",
          settingsJson: JSON.stringify({ topK: 40 })
        }))
      }
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
    expect(prisma.aiModelConfig.updateMany).toHaveBeenCalledWith({
      where: {
        capability: "VISION_BEHAVIOR_ANALYSIS",
        id: { not: "model-1" }
      },
      data: { isDefault: false }
    });
    expect(prisma.aiModelConfig.update).toHaveBeenCalledWith({
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
  });

  it("patches every editable model field and enforces target default uniqueness", async () => {
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma)),
      aiModelConfig: {
        findUnique: vi.fn().mockResolvedValue({
          id: "model-2",
          capability: "INTERVIEW_FOLLOW_UP",
          isDefault: false
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(modelRow({
          id: "model-2",
          capability: "INTERVIEW_FOLLOW_UP",
          isDefault: true
        }))
      }
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
    expect(prisma.aiModelConfig.updateMany).toHaveBeenCalledWith({
      where: {
        capability: "VISION_BEHAVIOR_ANALYSIS",
        id: { not: "model-2" }
      },
      data: { isDefault: false }
    });
    expect(prisma.aiModelConfig.update).toHaveBeenCalledWith({
      where: { id: "model-2" },
      data: {
        displayName: "Qwen Follow-up Updated",
        modelName: "qwen-plus-latest",
        capability: "VISION_BEHAVIOR_ANALYSIS",
        temperature: 0.7,
        maxTokens: 4096,
        timeoutMs: 45000,
        costNote: "updated pricing",
        enabled: true,
        isDefault: true
      },
      include: expect.any(Object)
    });
    expect(prisma.aiModelConfig.update.mock.calls[0][0].data).not.toHaveProperty("settingsJson");
  });

  it("deletes a model configuration with safe settings serialization", async () => {
    const prisma = {
      aiModelConfig: {
        delete: vi.fn().mockResolvedValue(modelRow({
          id: "model-3",
          settingsJson: "malformed",
          enabled: false,
          isDefault: false
        }))
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/models/[modelId]/route");
    const response = await route.DELETE(
      new Request("http://localhost/api/ai-services/models/model-3"),
      { params: Promise.resolve({ modelId: "model-3" }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(prisma.aiModelConfig.delete).toHaveBeenCalledWith({
      where: { id: "model-3" },
      include: expect.any(Object)
    });
    expect(payload.model.id).toBe("model-3");
    expect(payload.model.settings).toEqual({});
    expect(payload.model).not.toHaveProperty("settingsJson");
  });
});
