import { describe, expect, it, vi } from "vitest";
import { seedAlibabaMediaModels, seedMockAiModels } from "@/lib/db/seedAiModels";

describe("AI model seed selection", () => {
  it("does not overwrite an existing recommendation or runtime selection", async () => {
    const prisma = {
      aiModelConfig: {
        findFirst: vi.fn().mockResolvedValue({ id: "user-model" }),
        upsert: vi.fn().mockResolvedValue({})
      }
    };

    await seedMockAiModels(prisma);

    expect(prisma.aiModelConfig.upsert).toHaveBeenCalledTimes(3);
    for (const [args] of prisma.aiModelConfig.upsert.mock.calls) {
      expect(args.update).not.toHaveProperty("isDefault");
      expect(args.update).not.toHaveProperty("isSelected");
      expect(args.create).toMatchObject({ isDefault: false, isSelected: false });
    }
  });

  it("uses Mock as the initial recommendation and selection only when neither exists", async () => {
    const prisma = {
      aiModelConfig: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({})
      }
    };

    await seedMockAiModels(prisma);

    for (const [args] of prisma.aiModelConfig.upsert.mock.calls) {
      expect(args.update).toMatchObject({ isDefault: true, isSelected: true });
      expect(args.create).toMatchObject({ isDefault: true, isSelected: true });
    }
  });
});

describe("Alibaba media model seed references", () => {
  it("does nothing when no enabled TONGYI provider exists", async () => {
    const prisma = {
      aiServiceProvider: { findFirst: vi.fn().mockResolvedValue(null) },
      aiModelConfig: {
        findFirst: vi.fn(),
        create: vi.fn()
      }
    };

    await seedAlibabaMediaModels(prisma);

    expect(prisma.aiModelConfig.findFirst).not.toHaveBeenCalled();
    expect(prisma.aiModelConfig.create).not.toHaveBeenCalled();
  });

  it("adds editable references without changing current model selections", async () => {
    const prisma = {
      aiServiceProvider: {
        findFirst: vi.fn().mockResolvedValue({ id: "tongyi-provider" })
      },
      aiModelConfig: {
        findFirst: vi.fn().mockImplementation((args: { where: { capability: string; isDefault?: boolean } }) =>
          Promise.resolve(
            args.where.isDefault && args.where.capability === "TEXT_TO_SPEECH"
              ? { id: "existing-recommendation" }
              : null
          )
        ),
        create: vi.fn().mockResolvedValue({})
      }
    };

    await seedAlibabaMediaModels(prisma);

    expect(prisma.aiModelConfig.create).toHaveBeenCalledTimes(4);
    const created = prisma.aiModelConfig.create.mock.calls.map(([args]) => args.data);
    expect(created.map((model) => model.modelName)).toEqual([
      "qwen3-asr-flash-realtime",
      "qwen3-tts-instruct-flash",
      "avatar-dialog",
      "qwen3.6-flash"
    ]);
    expect(created[1].settingsJson).toBe(JSON.stringify({
      voice: "Cherry",
      instructions: "语气专业、自然、清晰。"
    }));
    expect(created.every((model) => model.isSelected === false)).toBe(true);
    expect(created[0].isDefault).toBe(true);
    expect(created[1].isDefault).toBe(false);
  });
});
