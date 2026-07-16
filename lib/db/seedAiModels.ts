type SeedAiModelClient = {
  aiModelConfig: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
};

type SeedAlibabaMediaClient = {
  aiServiceProvider: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  aiModelConfig: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<unknown>;
  };
};

const mockCapabilities = [
  ["mock-outline", "面试提纲 Mock", "mock-outline", "INTERVIEW_OUTLINE"],
  ["mock-follow-up", "面试追问 Mock", "mock-follow-up", "INTERVIEW_FOLLOW_UP"],
  ["mock-report", "报告分析 Mock", "mock-report", "REPORT_ANALYSIS"]
] as const;

const alibabaMediaReferences = [
  {
    seedKey: "speech-to-text",
    displayName: "阿里百炼 实时语音识别",
    modelName: "qwen3-asr-flash-realtime",
    capability: "SPEECH_TO_TEXT",
    settings: { language: "zh-CN", sampleRate: 16000, encoding: "pcm" }
  },
  {
    seedKey: "text-to-speech",
    displayName: "阿里百炼 实时语音合成",
    modelName: "qwen3-tts-instruct-flash-realtime",
    capability: "TEXT_TO_SPEECH",
    settings: { voice: "Cherry", sampleRate: 24000, format: "pcm" }
  },
  {
    seedKey: "digital-human-realtime",
    displayName: "阿里云 Avatar 实时数字人",
    modelName: "avatar-dialog",
    capability: "DIGITAL_HUMAN_REALTIME",
    settings: { avatarId: "", voiceId: "", rtcMode: "web" }
  },
  {
    seedKey: "behavior-analysis",
    displayName: "阿里百炼 行为分析",
    modelName: "qwen3.6-flash",
    capability: "VISION_BEHAVIOR_ANALYSIS",
    settings: { minimumConfidence: 0.6, frameIntervalMs: 1000, maxFrames: 12 }
  }
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

export async function seedAlibabaMediaModels(prisma: SeedAlibabaMediaClient) {
  const provider = await prisma.aiServiceProvider.findFirst({
    where: { providerType: "TONGYI", enabled: true },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });

  if (!provider) {
    return;
  }

  for (const reference of alibabaMediaReferences) {
    const existing = await prisma.aiModelConfig.findFirst({
      where: { id: `alibaba-media-${provider.id}-${reference.seedKey}` },
      select: { id: true }
    });

    if (existing) {
      continue;
    }

    const recommended = await prisma.aiModelConfig.findFirst({
      where: { capability: reference.capability, isDefault: true },
      select: { id: true }
    });

    await prisma.aiModelConfig.create({
      data: {
        id: `alibaba-media-${provider.id}-${reference.seedKey}`,
        providerId: provider.id,
        displayName: reference.displayName,
        modelName: reference.modelName,
        capability: reference.capability,
        temperature: 0.2,
        maxTokens: 1200,
        timeoutMs: reference.capability === "DIGITAL_HUMAN_REALTIME" ? 60000 : 45000,
        settingsJson: JSON.stringify(reference.settings),
        enabled: true,
        isDefault: recommended === null,
        isSelected: false
      }
    });
  }
}
