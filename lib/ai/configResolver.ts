import { prisma } from "@/lib/db/prisma";
import type { AiCapability } from "@/lib/domain/aiServiceConstants";
import {
  multimodalTakeoverSettingKey,
  parseMultimodalTakeoverSettings,
  selectModelWithMultimodalTakeover
} from "@/lib/domain/multimodalTakeover";

const runtimeProviderSelect = {
  id: true,
  displayName: true,
  providerType: true,
  baseUrl: true,
  apiKeyPreview: true,
  apiKeyCiphertext: true,
  apiKeyIv: true,
  apiKeyTag: true,
  credentialsCiphertext: true,
  credentialsIv: true,
  credentialsTag: true,
  closeConfigVersion: true,
  settingsJson: true,
  enabled: true
} as const;

export async function findRecommendedAiModel(capability: AiCapability) {
  return prisma.aiModelConfig.findFirst({
    where: {
      capability,
      enabled: true,
      isDefault: true,
      provider: {
        enabled: true
      }
    },
    include: {
      provider: {
        select: {
          id: true,
          displayName: true,
          providerType: true,
          baseUrl: true,
          apiKeyPreview: true,
          apiKeyCiphertext: true,
          apiKeyIv: true,
          apiKeyTag: true,
          enabled: true
        }
      }
    }
  });
}

export async function findSelectedAiModel(capability: AiCapability) {
  const directModel = await prisma.aiModelConfig.findFirst({
    where: {
      capability,
      enabled: true,
      isSelected: true,
      provider: {
        enabled: true
      }
    },
    include: {
      provider: { select: runtimeProviderSelect }
    }
  });

  if (directModel) {
    return directModel;
  }

  return findMultimodalTakeoverAiModel(capability);
}

export async function findAiModelById(modelId: string) {
  return prisma.aiModelConfig.findUnique({
    where: { id: modelId },
    include: {
      provider: { select: runtimeProviderSelect }
    }
  });
}

async function findMultimodalTakeoverAiModel(capability: AiCapability) {
  try {
    const row = await prisma.aiRuntimeSetting.findUnique({
      where: { key: multimodalTakeoverSettingKey }
    });
    const settings = parseMultimodalTakeoverSettings(row?.valueJson);

    if (!settings.enabled || !settings.modelId) {
      return null;
    }

    const takeoverModel = await prisma.aiModelConfig.findUnique({
      where: { id: settings.modelId },
      include: {
        provider: { select: runtimeProviderSelect }
      }
    });

    return selectModelWithMultimodalTakeover({
      capability,
      directModel: null,
      takeoverModel,
      settings
    });
  } catch {
    return null;
  }
}

export async function resolveAiProviderLabel(capability: AiCapability) {
  const configuredModel = await findSelectedAiModel(capability).catch(() => null);

  if (!configuredModel) {
    return process.env.AI_PROVIDER || "mock";
  }

  return `${configuredModel.provider.displayName}/${configuredModel.modelName}`;
}
