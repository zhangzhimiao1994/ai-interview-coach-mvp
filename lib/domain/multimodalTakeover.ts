import {
  aiCapabilities,
  isSelectableAiProviderType,
  type AiCapability
} from "@/lib/domain/aiServiceConstants";

export const multimodalTakeoverSettingKey = "ai.multimodalTakeover";

export const defaultMultimodalTakeoverCapabilities = [
  "INTERVIEW_FOLLOW_UP",
  "VISION_BEHAVIOR_ANALYSIS"
] satisfies AiCapability[];

export type MultimodalTakeoverSettings = {
  enabled: boolean;
  modelId: string | null;
  coveredCapabilities: AiCapability[];
};

type TakeoverCandidateModel = {
  id: string;
  capability: string;
  modelName: string;
  enabled: boolean;
  provider: { enabled: boolean; providerType: string };
};

const aiCapabilitySet = new Set<string>(aiCapabilities);

export function parseMultimodalTakeoverSettings(
  value: string | null | undefined
): MultimodalTakeoverSettings {
  try {
    const parsed: unknown = JSON.parse(value ?? "{}");
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("Settings must be an object");
    }

    const object = parsed as Record<string, unknown>;
    return {
      enabled: object.enabled === true,
      modelId: typeof object.modelId === "string" && object.modelId.trim()
        ? object.modelId.trim()
        : null,
      coveredCapabilities: Array.isArray(object.coveredCapabilities)
        ? object.coveredCapabilities.filter(isAiCapability)
        : [...defaultMultimodalTakeoverCapabilities]
    };
  } catch {
    return {
      enabled: false,
      modelId: null,
      coveredCapabilities: [...defaultMultimodalTakeoverCapabilities]
    };
  }
}

export function serializeMultimodalTakeoverSettings(
  settings: MultimodalTakeoverSettings
) {
  return JSON.stringify({
    enabled: settings.enabled,
    modelId: settings.modelId,
    coveredCapabilities: settings.coveredCapabilities.filter(isAiCapability)
  });
}

export function isAiCapability(value: unknown): value is AiCapability {
  return typeof value === "string" && aiCapabilitySet.has(value);
}

export function isSupportedMultimodalTakeoverModel(modelName: string) {
  const normalized = modelName.trim().toLowerCase();
  return /^qwen3(?:\.5)?-omni-(?:plus|flash)(?:-realtime)?(?:-\d{4}-\d{2}-\d{2})?$/.test(
    normalized
  );
}

export function canMultimodalTakeOverCapability(
  capability: AiCapability,
  settings: MultimodalTakeoverSettings
) {
  return (
    settings.enabled &&
    Boolean(settings.modelId) &&
    settings.coveredCapabilities.includes(capability)
  );
}

export function selectModelWithMultimodalTakeover<T extends TakeoverCandidateModel>({
  capability,
  directModel,
  takeoverModel,
  settings
}: {
  capability: AiCapability;
  directModel: T | null;
  takeoverModel: T | null;
  settings: MultimodalTakeoverSettings;
}): T | null {
  if (directModel) {
    return directModel;
  }

  if (!canMultimodalTakeOverCapability(capability, settings)) {
    return null;
  }

  if (
    !takeoverModel ||
    !takeoverModel.enabled ||
    !takeoverModel.provider.enabled ||
    !isSelectableAiProviderType(takeoverModel.provider.providerType) ||
    !isSupportedMultimodalTakeoverModel(takeoverModel.modelName)
  ) {
    return null;
  }

  return takeoverModel;
}
