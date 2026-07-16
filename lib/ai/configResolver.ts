import { prisma } from "@/lib/db/prisma";
import type { AiCapability } from "@/lib/domain/aiServiceConstants";

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
  return prisma.aiModelConfig.findFirst({
    where: {
      capability,
      enabled: true,
      isSelected: true,
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
          credentialsCiphertext: true,
          credentialsIv: true,
          credentialsTag: true,
          settingsJson: true,
          enabled: true
        }
      }
    }
  });
}

export async function findAiModelById(modelId: string) {
  return prisma.aiModelConfig.findUnique({
    where: { id: modelId },
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
          credentialsCiphertext: true,
          credentialsIv: true,
          credentialsTag: true,
          settingsJson: true,
          enabled: true
        }
      }
    }
  });
}

export async function resolveAiProviderLabel(capability: AiCapability) {
  const configuredModel = await findSelectedAiModel(capability).catch(() => null);

  if (!configuredModel) {
    return process.env.AI_PROVIDER || "mock";
  }

  return `${configuredModel.provider.displayName}/${configuredModel.modelName}`;
}
