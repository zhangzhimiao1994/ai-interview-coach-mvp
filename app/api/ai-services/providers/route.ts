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
    const hasStructuredCredentials = Object.keys(input.credentials).length > 0;
    const configSecret = input.apiKey || hasStructuredCredentials
      ? readAiConfigSecret()
      : null;
    const encryptedApiKey = input.apiKey && configSecret
      ? encryptSecret(input.apiKey, configSecret)
      : null;
    const encryptedCredentials = hasStructuredCredentials && configSecret
      ? encryptCredentialMap(input.credentials, configSecret)
      : null;
    const provider = await prisma.aiServiceProvider.create({
      data: {
        displayName: input.displayName,
        providerType: input.providerType,
        baseUrl: input.baseUrl,
        ...(encryptedApiKey
          ? {
              apiKeyCiphertext: encryptedApiKey.ciphertext,
              apiKeyIv: encryptedApiKey.iv,
              apiKeyTag: encryptedApiKey.tag,
              apiKeyPreview: maskSecret(input.apiKey!)
            }
          : {}),
        ...(encryptedCredentials
          ? {
              credentialsCiphertext: encryptedCredentials.ciphertext,
              credentialsIv: encryptedCredentials.iv,
              credentialsTag: encryptedCredentials.tag,
              credentialsPreviewJson: JSON.stringify(previewCredentialMap(input.credentials))
            }
          : {}),
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
