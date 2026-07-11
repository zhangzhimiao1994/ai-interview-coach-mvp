import { describe, expect, it, vi } from "vitest";

describe("AI service API routes", () => {
  it("creates a provider with an encrypted key and returns only a masked preview", async () => {
    vi.resetModules();
    const prisma = {
      aiServiceProvider: {
        findMany: vi.fn(),
        create: vi.fn().mockResolvedValue({
          id: "provider-1",
          displayName: "DeepSeek",
          providerType: "OPENAI_COMPATIBLE",
          baseUrl: "https://api.deepseek.com/v1",
          apiKeyCiphertext: "cipher",
          apiKeyIv: "iv",
          apiKeyTag: "tag",
          apiKeyPreview: "sk-d****abcd",
          enabled: true,
          notes: "report model",
          createdAt: new Date("2026-07-07T00:00:00.000Z"),
          updatedAt: new Date("2026-07-07T00:00:00.000Z")
        })
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
          baseUrl: "https://api.deepseek.com/v1",
          apiKey: "sk-deepseek-secret-abcd",
          enabled: true,
          notes: "report model"
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(prisma.aiServiceProvider.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        displayName: "DeepSeek",
        providerType: "OPENAI_COMPATIBLE",
        apiKeyPreview: "sk-d****abcd"
      })
    });
    expect(JSON.stringify(payload)).not.toContain("sk-deepseek-secret-abcd");
    expect(JSON.stringify(payload)).not.toContain("cipher");
    expect(payload.provider.apiKeyPreview).toBe("sk-d****abcd");
  });

  it("returns a clear setup error when production API key encryption is not configured", async () => {
    vi.resetModules();
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
          baseUrl: "https://api.deepseek.com/v1",
          apiKey: "sk-deepseek-secret-abcd",
          enabled: true,
          notes: ""
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("AI service encryption is not configured");
    expect(payload.message).toContain("AI_CONFIG_SECRET");
    expect(prisma.aiServiceProvider.create).not.toHaveBeenCalled();
  });

  it("creates a default model and clears existing defaults for the same capability", async () => {
    vi.resetModules();
    const prisma = {
      aiModelConfig: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({
          id: "model-1",
          providerId: "provider-1",
          displayName: "DeepSeek Chat",
          modelName: "deepseek-chat",
          capability: "REPORT_ANALYSIS",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 30000,
          costNote: "low cost",
          enabled: true,
          isDefault: true,
          createdAt: new Date("2026-07-07T00:00:00.000Z"),
          updatedAt: new Date("2026-07-07T00:00:00.000Z"),
          provider: {
            id: "provider-1",
            displayName: "DeepSeek",
            providerType: "OPENAI_COMPATIBLE",
            enabled: true
          }
        })
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/models/route");
    const response = await route.POST(
      new Request("http://localhost/api/ai-services/models", {
        method: "POST",
        body: JSON.stringify({
          providerId: "provider-1",
          displayName: "DeepSeek Chat",
          modelName: "deepseek-chat",
          capability: "REPORT_ANALYSIS",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 30000,
          costNote: "low cost",
          enabled: true,
          isDefault: true
        })
      })
    );

    expect(response.status).toBe(201);
    expect(prisma.aiModelConfig.updateMany).toHaveBeenCalledWith({
      where: { capability: "REPORT_ANALYSIS" },
      data: { isDefault: false }
    });
    expect(prisma.aiModelConfig.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        modelName: "deepseek-chat",
        capability: "REPORT_ANALYSIS",
        isDefault: true
      }),
      include: expect.any(Object)
    });
  });

  it("sets an existing model as the default for its capability", async () => {
    vi.resetModules();
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
      aiModelConfig: {
        findUnique: vi.fn().mockResolvedValue({
          id: "model-2",
          capability: "INTERVIEW_FOLLOW_UP"
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({
          id: "model-2",
          providerId: "provider-1",
          displayName: "DeepSeek Follow-up",
          modelName: "deepseek-chat",
          capability: "INTERVIEW_FOLLOW_UP",
          temperature: 0.4,
          maxTokens: 1200,
          timeoutMs: 30000,
          costNote: null,
          enabled: true,
          isDefault: true,
          provider: {
            id: "provider-1",
            displayName: "DeepSeek",
            providerType: "OPENAI_COMPATIBLE",
            enabled: true
          }
        })
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/models/[modelId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/ai-services/models/model-2", {
        method: "PATCH",
        body: JSON.stringify({ isDefault: true })
      }),
      { params: Promise.resolve({ modelId: "model-2" }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(prisma.aiModelConfig.updateMany).toHaveBeenCalledWith({
      where: { capability: "INTERVIEW_FOLLOW_UP" },
      data: { isDefault: false }
    });
    expect(prisma.aiModelConfig.update).toHaveBeenCalledWith({
      where: { id: "model-2" },
      data: {
        isDefault: true,
        enabled: true
      },
      include: expect.any(Object)
    });
    expect(payload.model.isDefault).toBe(true);
  });

  it("deletes a model configuration", async () => {
    vi.resetModules();
    const prisma = {
      aiModelConfig: {
        delete: vi.fn().mockResolvedValue({
          id: "model-3",
          providerId: "provider-1",
          displayName: "Old model",
          modelName: "old-model",
          capability: "REPORT_ANALYSIS",
          temperature: 0.4,
          maxTokens: 1200,
          timeoutMs: 30000,
          costNote: null,
          enabled: false,
          isDefault: false,
          provider: {
            id: "provider-1",
            displayName: "DeepSeek",
            providerType: "OPENAI_COMPATIBLE",
            enabled: true
          }
        })
      }
    };
    vi.doMock("@/lib/db/prisma", () => ({ prisma }));

    const route = await import("@/app/api/ai-services/models/[modelId]/route");
    const response = await route.DELETE(new Request("http://localhost/api/ai-services/models/model-3"), {
      params: Promise.resolve({ modelId: "model-3" })
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(prisma.aiModelConfig.delete).toHaveBeenCalledWith({
      where: { id: "model-3" },
      include: expect.any(Object)
    });
    expect(payload.model.id).toBe("model-3");
  });
});
