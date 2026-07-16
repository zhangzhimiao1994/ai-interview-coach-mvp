type SeedAiModelClient = {
  aiModelConfig: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
};

const mockCapabilities = [
  ["mock-outline", "面试提纲 Mock", "mock-outline", "INTERVIEW_OUTLINE"],
  ["mock-follow-up", "面试追问 Mock", "mock-follow-up", "INTERVIEW_FOLLOW_UP"],
  ["mock-report", "报告分析 Mock", "mock-report", "REPORT_ANALYSIS"]
] as const;

export async function seedMockAiModels(prisma: SeedAiModelClient) {
  for (const [id, displayName, modelName, capability] of mockCapabilities) {
    const [recommendedModel, selectedModel] = await Promise.all([
      prisma.aiModelConfig.findFirst({
        where: { capability, isDefault: true },
        select: { id: true }
      }),
      prisma.aiModelConfig.findFirst({
        where: { capability, isSelected: true },
        select: { id: true }
      })
    ]);
    const seedAsDefault = recommendedModel === null;
    const seedAsSelected = selectedModel === null;

    await prisma.aiModelConfig.upsert({
      where: { id },
      update: {
        displayName,
        modelName,
        capability,
        enabled: true,
        ...(seedAsDefault ? { isDefault: true } : {}),
        ...(seedAsSelected ? { isSelected: true } : {})
      },
      create: {
        id,
        providerId: "mock-provider",
        displayName,
        modelName,
        capability,
        enabled: true,
        isDefault: seedAsDefault,
        isSelected: seedAsSelected
      }
    });
  }
}
