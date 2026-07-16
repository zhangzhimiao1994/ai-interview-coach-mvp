import { describe, expect, it, vi } from "vitest";
import { seedMockAiModels } from "@/lib/db/seedAiModels";

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
