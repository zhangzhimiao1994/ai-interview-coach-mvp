import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiConflictError, postErrorResponse } from "@/lib/api/errors";
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
        select: {
          id: true,
          providerId: true,
          capability: true,
          enabled: true,
          isDefault: true,
          isSelected: true
        }
      });

      if (!existing) {
        return null;
      }

      const targetCapability = input.capability ?? existing.capability;
      let targetEnabled = input.enabled ?? existing.enabled;
      let targetIsDefault = input.isDefault ?? existing.isDefault;
      let targetIsSelected = input.isSelected ?? existing.isSelected;

      if (existing.isSelected && input.isSelected === false) {
        throw new ApiConflictError("Select another model for this capability before clearing the current model.");
      }

      if (existing.isSelected && input.enabled === false) {
        throw new ApiConflictError("Select another model for this capability before disabling the current model.");
      }

      if (
        existing.isSelected &&
        input.capability !== undefined &&
        input.capability !== existing.capability
      ) {
        throw new ApiConflictError("Select another model for this capability before changing the current model capability.");
      }

      if (input.isSelected === true) {
        const provider = await tx.aiServiceProvider.findUnique({
          where: { id: existing.providerId },
          select: { enabled: true }
        });

        if (!provider?.enabled) {
          throw new ApiConflictError("Enable the provider before selecting this model for runtime use.");
        }

        targetEnabled = true;
      } else if (input.enabled === false) {
        targetIsSelected = false;
      }

      if (!targetEnabled) {
        targetIsSelected = false;
      }

      if (targetIsSelected && input.isSelected === true) {
        await tx.aiModelConfig.updateMany({
          where: {
            capability: targetCapability,
            id: { not: normalizedModelId }
          },
          data: { isSelected: false }
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

      if (input.isSelected !== undefined || targetIsSelected !== existing.isSelected) {
        data.isSelected = targetIsSelected;
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

    const model = await prisma.$transaction(async (tx) => {
      const existing = await tx.aiModelConfig.findUnique({
        where: { id: normalizedModelId },
        select: { isSelected: true }
      });

      if (!existing) {
        return null;
      }

      if (existing.isSelected) {
        throw new ApiConflictError("Select another model for this capability before deleting the current model.");
      }

      return tx.aiModelConfig.delete({
        where: { id: normalizedModelId },
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
