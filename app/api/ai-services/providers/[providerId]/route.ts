import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiConflictError, postErrorResponse } from "@/lib/api/errors";
import {
  decryptCredentialMap,
  encryptCredentialMap,
  encryptSecret,
  maskSecret,
  previewCredentialMap,
  readAiConfigSecret
} from "@/lib/domain/aiServices";
import {
  asProviderCloseConfigurationConflict,
  assertProviderCloseConfigurationMutable,
  changesProviderCloseConfiguration
} from "@/lib/domain/aiServiceProviderSafety";
import { prisma } from "@/lib/db/prisma";
import { aiServiceProviderInputSchema } from "@/lib/validators/aiServices";
import { serializeProvider } from "../../serialization";

type RouteContext = {
  params: Promise<{
    providerId: string;
  }>;
};

const clearableNullableText = z.preprocess(
  (value) => typeof value === "string"
    ? (value.trim() ? value.trim() : null)
    : value,
  z.string().nullable()
);

const updateProviderSchema = aiServiceProviderInputSchema
  .omit({ baseUrl: true, notes: true })
  .partial()
  .extend({
    baseUrl: clearableNullableText.optional(),
    notes: clearableNullableText.optional()
  })
  .strict();

function normalizeBlankCredentials(input: unknown) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { input, blankCredentialKeys: new Set<string>() };
  }

  const payload = input as Record<string, unknown>;
  const credentials = payload.credentials;

  if (credentials === null || typeof credentials !== "object" || Array.isArray(credentials)) {
    return { input, blankCredentialKeys: new Set<string>() };
  }

  const blankCredentialKeys = new Set<string>();
  const normalizedCredentials = Object.fromEntries(
    Object.entries(credentials).map(([key, value]) => {
      if (typeof value === "string" && !value.trim()) {
        blankCredentialKeys.add(key);
        return [key, "blank-credential-value"];
      }

      return [key, value];
    })
  );

  return {
    input: { ...payload, credentials: normalizedCredentials },
    blankCredentialKeys
  };
}

function completeCredentialEnvelope(provider: {
  credentialsCiphertext: string | null;
  credentialsIv: string | null;
  credentialsTag: string | null;
}) {
  const fields = [
    provider.credentialsCiphertext,
    provider.credentialsIv,
    provider.credentialsTag
  ];
  const hasAnyField = fields.some((field) => field !== null);
  const hasEveryField = fields.every((field) => typeof field === "string" && field.length > 0);

  if (hasAnyField && !hasEveryField) {
    throw new Error("Stored credential envelope is incomplete");
  }

  if (!hasEveryField) {
    return null;
  }

  return {
    ciphertext: provider.credentialsCiphertext!,
    iv: provider.credentialsIv!,
    tag: provider.credentialsTag!
  };
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { providerId } = await context.params;
    const normalizedProviderId = providerId.trim();

    if (!normalizedProviderId) {
      return NextResponse.json({ error: "Provider is required" }, { status: 400 });
    }

    const normalized = normalizeBlankCredentials(await request.json());
    const input = updateProviderSchema.parse(normalized.input);
    const credentials = input.credentials
      ? Object.fromEntries(
          Object.entries(input.credentials).filter(([key]) => !normalized.blankCredentialKeys.has(key))
        )
      : undefined;

    const provider = await prisma.$transaction(async (tx) => {
      const existing = await tx.aiServiceProvider.findUnique({
        where: { id: normalizedProviderId }
      });

      if (!existing) {
        return null;
      }

      if (input.enabled === false && existing.enabled) {
        const selectedModelCount = await tx.aiModelConfig.count({
          where: { providerId: normalizedProviderId, isSelected: true }
        });

        if (selectedModelCount > 0) {
          throw new ApiConflictError("Select replacement models before disabling this provider.");
        }
      }

      const { apiKey, settings } = input;
      const data: Record<string, unknown> = {};

      for (const field of [
        "displayName",
        "providerType",
        "baseUrl",
        "enabled",
        "notes"
      ] as const) {
        if (input[field] !== undefined) {
          data[field] = input[field];
        }
      }

      if (apiKey) {
        const encryptedApiKey = encryptSecret(apiKey, readAiConfigSecret());
        Object.assign(data, {
          apiKeyCiphertext: encryptedApiKey.ciphertext,
          apiKeyIv: encryptedApiKey.iv,
          apiKeyTag: encryptedApiKey.tag,
          apiKeyPreview: maskSecret(apiKey)
        });
      }

      if (credentials && Object.keys(credentials).length > 0) {
        const configSecret = readAiConfigSecret();
        const envelope = completeCredentialEnvelope(existing);
        const storedCredentials = envelope
          ? decryptCredentialMap(envelope, configSecret)
          : {};
        const mergedCredentials = { ...storedCredentials, ...credentials };
        const encryptedCredentials = encryptCredentialMap(mergedCredentials, configSecret);

        Object.assign(data, {
          credentialsCiphertext: encryptedCredentials.ciphertext,
          credentialsIv: encryptedCredentials.iv,
          credentialsTag: encryptedCredentials.tag,
          credentialsPreviewJson: JSON.stringify(previewCredentialMap(mergedCredentials))
        });
      }

      if (settings !== undefined) {
        data.settingsJson = JSON.stringify(settings);
      }

      if (Object.keys(data).length === 0) {
        return existing;
      }

      if (changesProviderCloseConfiguration(existing, data)) {
        await assertProviderCloseConfigurationMutable(
          tx,
          normalizedProviderId
        );
      }

      return tx.aiServiceProvider.update({
        where: { id: normalizedProviderId },
        data
      });
    });

    if (!provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    return NextResponse.json({ provider: serializeProvider(provider) });
  } catch (error) {
    return postErrorResponse(asProviderCloseConfigurationConflict(error));
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  void _request;
  try {
    const { providerId } = await context.params;
    const normalizedProviderId = providerId.trim();
    if (!normalizedProviderId) {
      return NextResponse.json(
        { error: "Provider is required" },
        { status: 400 }
      );
    }

    const provider = await prisma.$transaction(async (tx) => {
      const existing = await tx.aiServiceProvider.findUnique({
        where: { id: normalizedProviderId }
      });
      if (!existing) return null;

      await assertProviderCloseConfigurationMutable(tx, normalizedProviderId);
      return tx.aiServiceProvider.delete({
        where: { id: normalizedProviderId }
      });
    });

    if (!provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }
    return NextResponse.json({ provider: serializeProvider(provider) });
  } catch (error) {
    return postErrorResponse(asProviderCloseConfigurationConflict(error));
  }
}
