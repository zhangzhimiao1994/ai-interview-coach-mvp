import {
  findAiModelById,
  findSelectedAiModel
} from "@/lib/ai/configResolver";
import type { AiCapability } from "@/lib/domain/aiServiceConstants";
import { MediaConfigurationError } from "@/lib/media/errors";

type JsonObject = Record<string, unknown>;

type CredentialEnvelope = {
  ciphertext: string;
  iv: string;
  tag: string;
};

type SelectedMediaModel = {
  id: string;
  providerId: string;
  displayName: string;
  modelName: string;
  capability: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  settingsJson?: string | null;
  enabled: boolean;
  isSelected: boolean;
  provider: {
    id: string;
    displayName: string;
    providerType: string;
    baseUrl: string | null;
    settingsJson?: string | null;
    enabled: boolean;
    apiKeyCiphertext: string | null;
    apiKeyIv: string | null;
    apiKeyTag: string | null;
    credentialsCiphertext?: string | null;
    credentialsIv?: string | null;
    credentialsTag?: string | null;
  };
};

export type FindSelectedMediaModel = (
  capability: AiCapability
) => Promise<SelectedMediaModel | null>;

export type FindMediaModelById = (
  modelId: string
) => Promise<SelectedMediaModel | null>;

export type ResolvedMediaModel = {
  capability: AiCapability;
  providerId: string;
  providerName: string;
  providerType: string;
  baseUrl: string | null;
  providerSettings: JsonObject;
  modelId: string;
  modelDisplayName: string;
  modelName: string;
  modelSettings: JsonObject;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  credentialEnvelopes: {
    apiKey: CredentialEnvelope | null;
    structured: CredentialEnvelope | null;
  };
};

function parseSettings(
  value: string | null | undefined,
  kind: "provider" | "model",
  provider?: string
): JsonObject {
  try {
    const parsed: unknown = JSON.parse(value ?? "{}");

    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("Settings must be an object");
    }

    return parsed as JsonObject;
  } catch {
    throw new MediaConfigurationError(
      `Stored ${kind} settings are invalid`,
      {
        provider,
        code: kind === "provider"
          ? "INVALID_PROVIDER_SETTINGS"
          : "INVALID_MODEL_SETTINGS"
      }
    );
  }
}

function credentialEnvelope(
  ciphertext: string | null | undefined,
  iv: string | null | undefined,
  tag: string | null | undefined
): CredentialEnvelope | null {
  if (!ciphertext && !iv && !tag) {
    return null;
  }

  if (!ciphertext || !iv || !tag) {
    throw new MediaConfigurationError("Stored credential metadata is incomplete", {
      code: "INVALID_CREDENTIAL_ENVELOPE"
    });
  }

  return { ciphertext, iv, tag };
}

export async function resolveMediaModel(
  capability: AiCapability,
  findModel: FindSelectedMediaModel = findSelectedAiModel
): Promise<ResolvedMediaModel> {
  let selected: SelectedMediaModel | null;

  try {
    selected = await findModel(capability);
  } catch {
    throw new MediaConfigurationError("Unable to load the selected media model", {
      code: "MEDIA_CONFIGURATION_UNAVAILABLE",
      retryable: true
    });
  }

  if (
    !selected ||
    !selected.enabled ||
    !selected.isSelected ||
    !selected.provider.enabled ||
    selected.capability !== capability
  ) {
    throw new MediaConfigurationError(
      `No enabled currently selected model is configured for ${capability}`,
      { code: "MEDIA_MODEL_NOT_SELECTED" }
    );
  }

  return resolvedMediaModel(selected, capability);
}

function resolvedMediaModel(
  selected: SelectedMediaModel,
  capability: AiCapability
): ResolvedMediaModel {
  const providerSettings = parseSettings(
    selected.provider.settingsJson,
    "provider",
    selected.provider.providerType
  );
  const modelSettings = parseSettings(
    selected.settingsJson,
    "model",
    selected.provider.providerType
  );

  return {
    capability,
    providerId: selected.provider.id,
    providerName: selected.provider.displayName,
    providerType: selected.provider.providerType,
    baseUrl: selected.provider.baseUrl,
    providerSettings,
    modelId: selected.id,
    modelDisplayName: selected.displayName,
    modelName: selected.modelName,
    modelSettings,
    temperature: selected.temperature,
    maxTokens: selected.maxTokens,
    timeoutMs: selected.timeoutMs,
    credentialEnvelopes: {
      apiKey: credentialEnvelope(
        selected.provider.apiKeyCiphertext,
        selected.provider.apiKeyIv,
        selected.provider.apiKeyTag
      ),
      structured: credentialEnvelope(
        selected.provider.credentialsCiphertext,
        selected.provider.credentialsIv,
        selected.provider.credentialsTag
      )
    }
  };
}

export async function resolveMediaModelById(
  modelId: string,
  capability: AiCapability,
  findModel: FindMediaModelById = findAiModelById
): Promise<ResolvedMediaModel> {
  let model: SelectedMediaModel | null;

  try {
    model = await findModel(modelId);
  } catch {
    throw new MediaConfigurationError("Unable to load the realtime media model", {
      code: "MEDIA_CONFIGURATION_UNAVAILABLE",
      retryable: true
    });
  }

  if (
    !model ||
    !model.enabled ||
    !model.provider.enabled ||
    model.capability !== capability
  ) {
    throw new MediaConfigurationError(
      "The realtime media model is no longer available",
      { code: "MEDIA_MODEL_UNAVAILABLE" }
    );
  }

  return resolvedMediaModel(model, capability);
}
