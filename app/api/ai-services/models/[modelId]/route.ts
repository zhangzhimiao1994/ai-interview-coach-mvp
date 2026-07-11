import { NextResponse } from "next/server";
import { z } from "zod";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";

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

const updateModelSchema = z
  .object({
    enabled: z.boolean().optional(),
    isDefault: z.boolean().optional()
  })
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
        select: { id: true, capability: true }
      });

      if (!existing) {
        return null;
      }

      if (input.isDefault === true) {
        await tx.aiModelConfig.updateMany({
          where: { capability: existing.capability },
          data: { isDefault: false }
        });
      }

      return tx.aiModelConfig.update({
        where: { id: normalizedModelId },
        data: {
          ...input,
          enabled: input.isDefault === true ? true : input.enabled
        },
        include: modelInclude
      });
    });

    if (!model) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }

    return NextResponse.json({ model });
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

    return NextResponse.json({ model });
  } catch (error) {
    return postErrorResponse(error);
  }
}
