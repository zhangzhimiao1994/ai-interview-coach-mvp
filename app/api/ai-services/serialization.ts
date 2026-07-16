type JsonObject = Record<string, unknown>;

function parseJsonObject(value: string | null | undefined): JsonObject {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonObject
      : {};
  } catch {
    return {};
  }
}

type ProviderForSerialization = {
  id: string;
  displayName: string;
  providerType: string;
  baseUrl: string | null;
  apiKeyPreview: string | null;
  credentialsPreviewJson: string | null;
  settingsJson: string;
  enabled: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ModelProviderForSerialization = {
  id: string;
  displayName: string;
  providerType: string;
  enabled: boolean;
};

type ModelForSerialization = {
  id: string;
  providerId: string;
  displayName: string;
  modelName: string;
  capability: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  costNote: string | null;
  settingsJson: string;
  enabled: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  provider?: ModelProviderForSerialization | null;
};

export function serializeProvider(provider: ProviderForSerialization) {
  return {
    id: provider.id,
    displayName: provider.displayName,
    providerType: provider.providerType,
    baseUrl: provider.baseUrl,
    apiKeyPreview: provider.apiKeyPreview,
    credentialsPreview: parseJsonObject(provider.credentialsPreviewJson),
    settings: parseJsonObject(provider.settingsJson),
    enabled: provider.enabled,
    notes: provider.notes,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt
  };
}

export function serializeModel(model: ModelForSerialization) {
  return {
    id: model.id,
    providerId: model.providerId,
    displayName: model.displayName,
    modelName: model.modelName,
    capability: model.capability,
    temperature: model.temperature,
    maxTokens: model.maxTokens,
    timeoutMs: model.timeoutMs,
    costNote: model.costNote,
    enabled: model.enabled,
    isDefault: model.isDefault,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
    settings: parseJsonObject(model.settingsJson),
    ...(model.provider
      ? {
          provider: {
            id: model.provider.id,
            displayName: model.provider.displayName,
            providerType: model.provider.providerType,
            enabled: model.provider.enabled
          }
        }
      : {})
  };
}
