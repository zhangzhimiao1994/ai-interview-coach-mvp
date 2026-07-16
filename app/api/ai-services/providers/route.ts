import { NextResponse } from "next/server";
import { postErrorResponse } from "@/lib/api/errors";
import {
  encryptCredentialMap,
  encryptSecret,
  maskSecret,
  previewCredentialMap,
  readAiConfigSecret
} from "@/lib/domain/aiServices";
import { prisma } from "@/lib/db/prisma";
import { parseAiServiceProviderInput } from "@/lib/validators/aiServices";
import { serializeModel, serializeProvider } from "../serialization";

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
      models: provider.models.map(serializeModel)
    }))
  });
}

export async function POST(request: Request) {
  try {
    const input = parseAiServiceProviderInput(await request.json());
    const configSecret = readAiConfigSecret();
    const encryptedApiKey = input.apiKey
      ? encryptSecret(input.apiKey, configSecret)
      : null;
    const encryptedCredentials = encryptCredentialMap(input.credentials, configSecret);
    const provider = await prisma.aiServiceProvider.create({
      data: {
        displayName: input.displayName,
        providerType: input.providerType,
        baseUrl: input.baseUrl,
        apiKeyCiphertext: encryptedApiKey?.ciphertext,
        apiKeyIv: encryptedApiKey?.iv,
        apiKeyTag: encryptedApiKey?.tag,
        apiKeyPreview: input.apiKey ? maskSecret(input.apiKey) : undefined,
        credentialsCiphertext: encryptedCredentials.ciphertext,
        credentialsIv: encryptedCredentials.iv,
        credentialsTag: encryptedCredentials.tag,
        credentialsPreviewJson: JSON.stringify(previewCredentialMap(input.credentials)),
        settingsJson: JSON.stringify(input.settings),
        enabled: input.enabled,
        notes: input.notes
      }
    });

    return NextResponse.json({ provider: serializeProvider(provider) }, { status: 201 });
  } catch (error) {
    return postErrorResponse(error);
  }
}
