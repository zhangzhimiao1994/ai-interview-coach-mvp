import { NextResponse } from "next/server";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { parseAiModelConfigInput } from "@/lib/validators/aiServices";
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
    const input = parseAiModelConfigInput(await request.json());
    const { settings, ...modelInput } = input;

    const model = await prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.aiModelConfig.updateMany({
          where: { capability: input.capability },
          data: { isDefault: false }
        });
      }

      return tx.aiModelConfig.create({
        data: {
          ...modelInput,
          enabled: input.isDefault ? true : modelInput.enabled,
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
