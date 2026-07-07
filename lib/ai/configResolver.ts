import { prisma } from "@/lib/db/prisma";
import type { AiCapability } from "@/lib/domain/aiServiceConstants";

export async function findDefaultAiModel(capability: AiCapability) {
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

export async function resolveAiProviderLabel(capability: AiCapability) {
  const configuredModel = await findDefaultAiModel(capability).catch(() => null);

  if (!configuredModel) {
    return process.env.AI_PROVIDER || "mock";
  }

  return `${configuredModel.provider.displayName}/${configuredModel.modelName}`;
}
