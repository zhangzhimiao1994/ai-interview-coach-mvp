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

export function serializeModel<
  T extends { settingsJson: string }
>(model: T): Omit<T, "settingsJson"> & { settings: JsonObject } {
  const { settingsJson, ...safeModel } = model;

  return {
    ...safeModel,
    settings: parseJsonObject(settingsJson)
  };
}
