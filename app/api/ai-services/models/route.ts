import { NextResponse } from "next/server";
import { ApiConflictError, postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { isSelectableAiProviderType } from "@/lib/domain/aiServiceConstants";
import {
  aiModelConfigInputSchema,
  validateAiModelConfigForProvider
} from "@/lib/validators/aiServices";
import { serializeModel } from "../serialization";

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

export async function GET() {
  const models = await prisma.aiModelConfig.findMany({
    orderBy: [{ capability: "asc" }, { createdAt: "desc" }],
    include: modelInclude
  });

  return NextResponse.json({ models: models.map(serializeModel) });
}

export async function POST(request: Request) {
  try {
    const unvalidatedInput = aiModelConfigInputSchema.parse(await request.json());

    const model = await prisma.$transaction(async (tx) => {
      const provider = await tx.aiServiceProvider.findUnique({
        where: { id: unvalidatedInput.providerId },
        select: { enabled: true, providerType: true }
      });

      if (!provider) {
        throw new ApiConflictError("The selected provider is unavailable.");
      }

      if (!isSelectableAiProviderType(provider.providerType)) {
        throw new ApiConflictError("The selected provider type is retired.");
      }

      const input = validateAiModelConfigForProvider(
        unvalidatedInput,
        provider.providerType
      );
      const { settings, ...modelInput } = input;

      if (input.isSelected) {
        if (!provider.enabled) {
          throw new ApiConflictError("Enable the provider before selecting this model for runtime use.");
        }

        await tx.aiModelConfig.updateMany({
          where: { capability: input.capability },
          data: { isSelected: false }
        });
      }

      return tx.aiModelConfig.create({
        data: {
          ...modelInput,
          enabled: input.isSelected ? true : modelInput.enabled,
          settingsJson: JSON.stringify(settings)
        },
        include: modelInclude
      });
    });

    return NextResponse.json({ model: serializeModel(model) }, { status: 201 });
  } catch (error) {
    return postErrorResponse(error);
  }
}
