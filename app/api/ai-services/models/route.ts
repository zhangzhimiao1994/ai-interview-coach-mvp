import { NextResponse } from "next/server";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { parseAiModelConfigInput } from "@/lib/validators/aiServices";

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

  return NextResponse.json({ models });
}

export async function POST(request: Request) {
  try {
    const input = parseAiModelConfigInput(await request.json());

    if (input.isDefault) {
      await prisma.aiModelConfig.updateMany({
        where: { capability: input.capability },
        data: { isDefault: false }
      });
    }

    const model = await prisma.aiModelConfig.create({
      data: input,
      include: modelInclude
    });

    return NextResponse.json({ model }, { status: 201 });
  } catch (error) {
    return postErrorResponse(error);
  }
}
