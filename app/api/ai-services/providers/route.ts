import { NextResponse } from "next/server";
import { postErrorResponse } from "@/lib/api/errors";
import { encryptSecret, maskSecret, readAiConfigSecret } from "@/lib/domain/aiServices";
import { prisma } from "@/lib/db/prisma";
import { parseAiServiceProviderInput } from "@/lib/validators/aiServices";

function serializeProvider(provider: {
  id: string;
  displayName: string;
  providerType: string;
  baseUrl: string | null;
  apiKeyPreview: string | null;
  enabled: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: provider.id,
    displayName: provider.displayName,
    providerType: provider.providerType,
    baseUrl: provider.baseUrl,
    apiKeyPreview: provider.apiKeyPreview,
    enabled: provider.enabled,
    notes: provider.notes,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt
  };
}

export async function GET() {
  const providers = await prisma.aiServiceProvider.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      models: {
        orderBy: { createdAt: "desc" }
      }
    }
  });

  return NextResponse.json({
    providers: providers.map((provider) => ({
      ...serializeProvider(provider),
      models: provider.models
    }))
  });
}

export async function POST(request: Request) {
  try {
    const input = parseAiServiceProviderInput(await request.json());
    const encrypted = input.apiKey ? encryptSecret(input.apiKey, readAiConfigSecret()) : null;
    const provider = await prisma.aiServiceProvider.create({
      data: {
        displayName: input.displayName,
        providerType: input.providerType,
        baseUrl: input.baseUrl,
        apiKeyCiphertext: encrypted?.ciphertext,
        apiKeyIv: encrypted?.iv,
        apiKeyTag: encrypted?.tag,
        apiKeyPreview: input.apiKey ? maskSecret(input.apiKey) : undefined,
        enabled: input.enabled,
        notes: input.notes
      }
    });

    return NextResponse.json({ provider: serializeProvider(provider) }, { status: 201 });
  } catch (error) {
    return postErrorResponse(error);
  }
}
