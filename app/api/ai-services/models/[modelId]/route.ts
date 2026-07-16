import { NextResponse } from "next/server";
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

const updateModelSchema = aiModelConfigInputSchema
  .omit({ providerId: true })
  .partial()
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
        select: { id: true, capability: true, isDefault: true }
      });

      if (!existing) {
        return null;
      }

      const targetCapability = input.capability ?? existing.capability;
      const targetIsDefault = input.isDefault ?? existing.isDefault;

      if (targetIsDefault) {
        await tx.aiModelConfig.updateMany({
          where: {
            capability: targetCapability,
            id: { not: normalizedModelId }
          },
          data: { isDefault: false }
        });
      }

      const { settings, ...updateInput } = input;

      return tx.aiModelConfig.update({
        where: { id: normalizedModelId },
        data: {
          ...updateInput,
          ...(settings === undefined ? {} : { settingsJson: JSON.stringify(settings) }),
          ...(input.isDefault === true ? { enabled: true } : {})
        },
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
