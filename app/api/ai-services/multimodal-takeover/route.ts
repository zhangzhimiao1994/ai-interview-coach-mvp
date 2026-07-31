import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiConflictError, postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import {
  aiCapabilities,
  isSelectableAiProviderType,
  type AiCapability
} from "@/lib/domain/aiServiceConstants";
import {
  defaultMultimodalTakeoverCapabilities,
  isSupportedMultimodalTakeoverModel,
  multimodalTakeoverSettingKey,
  parseMultimodalTakeoverSettings,
  serializeMultimodalTakeoverSettings,
  type MultimodalTakeoverSettings
} from "@/lib/domain/multimodalTakeover";

const takeoverSchema = z
  .object({
    enabled: z.boolean().default(false),
    modelId: z.string().trim().min(1).nullable().optional(),
    coveredCapabilities: z
      .array(z.enum(aiCapabilities))
      .default([...defaultMultimodalTakeoverCapabilities])
  })
  .strict();

function normalizeSettings(input: z.infer<typeof takeoverSchema>): MultimodalTakeoverSettings {
  return {
    enabled: input.enabled,
    modelId: input.modelId?.trim() || null,
    coveredCapabilities: [...new Set(input.coveredCapabilities)] as AiCapability[]
  };
}

export async function GET() {
  const row = await prisma.aiRuntimeSetting.findUnique({
    where: { key: multimodalTakeoverSettingKey }
  });

  return NextResponse.json({
    settings: parseMultimodalTakeoverSettings(row?.valueJson)
  });
}

export async function PUT(request: Request) {
  try {
    const settings = normalizeSettings(takeoverSchema.parse(await request.json()));

    if (settings.enabled) {
      if (!settings.modelId) {
        throw new ApiConflictError("Select an Omni model before enabling multimodal takeover.");
      }

      const model = await prisma.aiModelConfig.findUnique({
        where: { id: settings.modelId },
        select: {
          id: true,
          modelName: true,
          enabled: true,
          provider: { select: { enabled: true, providerType: true } }
        }
      });

      if (
        !model ||
        !model.enabled ||
        !model.provider.enabled ||
        !isSelectableAiProviderType(model.provider.providerType) ||
        !isSupportedMultimodalTakeoverModel(model.modelName)
      ) {
        throw new ApiConflictError("Select an enabled Qwen Omni model before enabling multimodal takeover.");
      }
    }

    const valueJson = serializeMultimodalTakeoverSettings(settings);
    const row = await prisma.aiRuntimeSetting.upsert({
      where: { key: multimodalTakeoverSettingKey },
      create: {
        key: multimodalTakeoverSettingKey,
        valueJson
      },
      update: { valueJson }
    });

    return NextResponse.json({
      settings: parseMultimodalTakeoverSettings(row.valueJson)
    });
  } catch (error) {
    return postErrorResponse(error);
  }
}
