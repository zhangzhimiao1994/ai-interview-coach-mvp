import { NextResponse } from "next/server";
import { z } from "zod";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { aiModelConfigInputSchema } from "@/lib/validators/aiServices";
import { serializeModel } from "../../serialization";

type RouteContext = {
  params: Promise<{
    modelId: string;
  }>;
};

const modelInclude = {
  provider: {
    select: {
      id: true,
      displayName: true,
      providerType: true,
      enabled: true
    }
  }
} as const;

const clearableNullableText = z.preprocess(
  (value) => typeof value === "string"
    ? (value.trim() ? value.trim() : null)
    : value,
  z.string().nullable()
);

const updateModelSchema = aiModelConfigInputSchema
  .omit({ providerId: true, costNote: true })
  .partial()
  .extend({ costNote: clearableNullableText.optional() })
  .strict();

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { modelId } = await context.params;
    const normalizedModelId = modelId.trim();

    if (!normalizedModelId) {
      return NextResponse.json({ error: "Model is required" }, { status: 400 });
    }

    const input = updateModelSchema.parse(await request.json());

    const model = await prisma.$transaction(async (tx) => {
      const existing = await tx.aiModelConfig.findUnique({
        where: { id: normalizedModelId },
        select: { id: true, capability: true, enabled: true, isDefault: true }
      });

      if (!existing) {
        return null;
      }

      const targetCapability = input.capability ?? existing.capability;
      let targetEnabled = input.enabled ?? existing.enabled;
      let targetIsDefault = input.isDefault ?? existing.isDefault;

      if (input.isDefault === true) {
        targetEnabled = true;
      } else if (input.enabled === false) {
        targetIsDefault = false;
      }

      if (!targetEnabled) {
        targetIsDefault = false;
      }

      if (targetIsDefault) {
        await tx.aiModelConfig.updateMany({
          where: {
            capability: targetCapability,
            id: { not: normalizedModelId }
          },
          data: { isDefault: false }
        });
      }

      const data: Record<string, unknown> = {};

      for (const field of [
        "displayName",
        "modelName",
        "capability",
        "temperature",
        "maxTokens",
        "timeoutMs",
        "costNote"
      ] as const) {
        if (input[field] !== undefined) {
          data[field] = input[field];
        }
      }

      if (input.settings !== undefined) {
        data.settingsJson = JSON.stringify(input.settings);
      }

      if (input.enabled !== undefined || targetEnabled !== existing.enabled) {
        data.enabled = targetEnabled;
      }

      if (input.isDefault !== undefined || targetIsDefault !== existing.isDefault) {
        data.isDefault = targetIsDefault;
      }

      return tx.aiModelConfig.update({
        where: { id: normalizedModelId },
        data,
        include: modelInclude
      });
    });

    if (!model) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }

    return NextResponse.json({ model: serializeModel(model) });
  } catch (error) {
    return postErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { modelId } = await context.params;
    const normalizedModelId = modelId.trim();

    if (!normalizedModelId) {
      return NextResponse.json({ error: "Model is required" }, { status: 400 });
    }

    const model = await prisma.aiModelConfig.delete({
      where: { id: normalizedModelId },
      include: modelInclude
    });

    return NextResponse.json({ model: serializeModel(model) });
  } catch (error) {
    return postErrorResponse(error);
  }
}
