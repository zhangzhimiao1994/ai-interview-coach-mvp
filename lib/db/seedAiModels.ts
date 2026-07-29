type SeedAiModelClient = {
  aiModelConfig: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
};

export type SeedAlibabaMediaClient = {
  aiServiceProvider: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  aiModelConfig: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<unknown>;
  };
};

export type SeedLingmouMediaClient = SeedAlibabaMediaClient;

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
    displayName: "阿里百炼 Qwen-Audio-TTS 情绪语音合成",
    modelName: "qwen-audio-3.0-tts-flash",
    capability: "TEXT_TO_SPEECH",
    settings: {
      voice: "longanhuan_v3.6",
      format: "pcm",
      sampleRate: 48000,
      channels: 1,
      instruction: "像专业面试官一样自然、清晰地表达；可根据文本中的 [whisper]、[laughs]、[angry] 等标签添加情绪。"
    }
  },
  {
    seedKey: "text-to-speech-cosyvoice",
    displayName: "阿里百炼 CosyVoice 语音合成备选",
    modelName: "cosyvoice-v3-flash",
    capability: "TEXT_TO_SPEECH",
    settings: {
      voice: "longanhuan",
      format: "pcm",
      sampleRate: 48000,
      channels: 1,
      instruction: "你说话的情感是 neutral."
    }
  },
  {
    seedKey: "digital-human-video-emo",
    displayName: "阿里百炼 EMO 数字人视频",
    modelName: "emo-v1",
    capability: "DIGITAL_HUMAN_VIDEO",
    settings: {
      model: "emo-v1",
      ratio: "1:1"
    }
  },
  {
    seedKey: "behavior-analysis",
    displayName: "阿里百炼 行为分析",
    modelName: "qwen3.6-flash",
    capability: "VISION_BEHAVIOR_ANALYSIS",
    settings: { minimumConfidence: 0.6, frameIntervalMs: 1000, maxFrames: 12 }
  },
  {
    seedKey: "omni-follow-up-takeover",
    displayName: "阿里百炼 Qwen-Omni 全模态接管调试",
    modelName: "qwen3.5-omni-plus",
    capability: "INTERVIEW_FOLLOW_UP",
    settings: {
      debugMode: "omni-takeover",
      takeoverScope: "follow-up",
      modalities: ["text", "audio", "image", "video"]
    }
  },
  {
    seedKey: "omni-behavior-debug",
    displayName: "阿里百炼 Qwen-Omni 全模态行为调试",
    modelName: "qwen3.5-omni-plus",
    capability: "VISION_BEHAVIOR_ANALYSIS",
    settings: {
      minimumConfidence: 0.6,
      frameIntervalMs: 1000,
      maxFrames: 12,
      debugMode: "omni-observe",
      modalities: ["text", "audio", "image", "video"]
    }
  }
] as const;

const lingmouReference = {
  seedKey: "digital-human-realtime",
  displayName: "灵眸 2D 云渲染音频驱动数字人",
  modelName: "lingmou-2d-cloud-audio-driven",
  capability: "DIGITAL_HUMAN_REALTIME",
  settings: {
    configId: "",
    instanceId: "",
    renderMode: "cloud",
    integrationMode: "audio-driven",
    client: "web"
  }
} as const;

const lingmouVideoReference = {
  seedKey: "digital-human-video",
  displayName: "灵眸播报数字人视频",
  modelName: "lingmou-broadcast-video",
  capability: "DIGITAL_HUMAN_VIDEO",
  settings: {
    templateId: "",
    audioVariableName: "audio_url",
    portraitVariableName: null,
    resolution: "1080p",
    fps: 30,
    watermark: false,
    mode: "broadcast"
  }
} as const;

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

export async function seedAlibabaMediaModels(prisma: SeedAlibabaMediaClient): Promise<void> {
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
        timeoutMs: 45000,
        settingsJson: JSON.stringify(reference.settings),
        enabled: true,
        isDefault: recommended === null,
        isSelected: false
      }
    });
  }
}

export async function seedLingmouDigitalHumanModels(prisma: SeedLingmouMediaClient): Promise<void> {
  const provider = await prisma.aiServiceProvider.findFirst({
    where: { providerType: "LINGMOU", enabled: true },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });

  if (!provider) {
    return;
  }

  for (const reference of [lingmouReference, lingmouVideoReference]) {
    const existing = await prisma.aiModelConfig.findFirst({
      where: { id: `lingmou-media-${provider.id}-${reference.seedKey}` },
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
        id: `lingmou-media-${provider.id}-${reference.seedKey}`,
        providerId: provider.id,
        displayName: reference.displayName,
        modelName: reference.modelName,
        capability: reference.capability,
        temperature: 0.2,
        maxTokens: 1200,
        timeoutMs:
          reference.capability === "DIGITAL_HUMAN_VIDEO" ? 120000 : 60000,
        settingsJson: JSON.stringify(reference.settings),
        enabled: true,
        isDefault: recommended === null,
        isSelected: false
      }
    });
  }
}
