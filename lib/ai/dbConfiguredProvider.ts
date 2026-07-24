import {
  decryptCredentialMap,
  decryptSecret,
  readAiConfigSecret,
  type CredentialMap,
  type EncryptedSecret
} from "@/lib/domain/aiServices";
import { findSelectedAiModel } from "./configResolver";
import { mockAiProvider } from "./mockProvider";
import { createOpenAiCompatibleProvider } from "./openAiCompatibleProvider";
import type { AiProvider, CoachingReportInput, FollowUpCoachingInput, TrainingOutlineRequest } from "./types";

type ConfiguredModel = NonNullable<Awaited<ReturnType<typeof findSelectedAiModel>>>;

export type DbConfiguredAiProviderOptions = {
  findModel?: typeof findSelectedAiModel;
  fallbackProvider?: AiProvider;
};

function secretFromModel(model: ConfiguredModel): EncryptedSecret | null {
  if (!model.provider.apiKeyCiphertext || !model.provider.apiKeyIv || !model.provider.apiKeyTag) {
    return null;
  }

  return {
    ciphertext: model.provider.apiKeyCiphertext,
    iv: model.provider.apiKeyIv,
    tag: model.provider.apiKeyTag
  };
}

function structuredSecretFromModel(model: ConfiguredModel): EncryptedSecret | null {
  if (
    !model.provider.credentialsCiphertext ||
    !model.provider.credentialsIv ||
    !model.provider.credentialsTag
  ) {
    return null;
  }

  return {
    ciphertext: model.provider.credentialsCiphertext,
    iv: model.provider.credentialsIv,
    tag: model.provider.credentialsTag
  };
}

function parseProviderSettings(model: ConfiguredModel) {
  if (!model.provider.settingsJson) {
    return {};
  }

  const parsed = JSON.parse(model.provider.settingsJson) as unknown;

  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function tongyiCompatibleBaseUrl(model: ConfiguredModel) {
  if (model.provider.providerType !== "TONGYI") {
    return null;
  }

  const settings = parseProviderSettings(model);
  const workspaceId = typeof settings.workspaceId === "string"
    ? settings.workspaceId.trim()
    : typeof settings.workspace === "string"
      ? settings.workspace.trim()
      : "";
  const region = typeof settings.region === "string" && settings.region.trim()
    ? settings.region.trim()
    : "cn-beijing";

  if (!workspaceId) {
    return null;
  }

  return `https://${workspaceId}.${region}.maas.aliyuncs.com/compatible-mode/v1`;
}

function structuredCredentialsFromModel(
  encrypted: EncryptedSecret | null,
  configSecret: string
): CredentialMap {
  return encrypted ? decryptCredentialMap(encrypted, configSecret) : {};
}

function providerForModel(model: ConfiguredModel): AiProvider | null {
  if (model.provider.providerType === "MOCK") {
    return mockAiProvider;
  }

  if (
    model.provider.providerType === "OPENAI_COMPATIBLE" ||
    model.provider.providerType === "DEEPSEEK" ||
    model.provider.providerType === "TONGYI" ||
    model.provider.providerType === "VOLCANO_ARK" ||
    model.provider.providerType === "ZHIPU" ||
    model.provider.providerType === "MINIMAX" ||
    model.provider.providerType === "CUSTOM" ||
    model.provider.providerType === "OPENAI"
  ) {
    const encrypted = secretFromModel(model);
    const encryptedStructuredCredentials = structuredSecretFromModel(model);

    if (!encrypted && !encryptedStructuredCredentials) {
      return null;
    }

    const configSecret = readAiConfigSecret();
    const structuredCredentials = structuredCredentialsFromModel(
      encryptedStructuredCredentials,
      configSecret
    );
    const apiKey = encrypted
      ? decryptSecret(encrypted, configSecret)
      : structuredCredentials.apiKey;
    const baseUrl = model.provider.baseUrl || tongyiCompatibleBaseUrl(model);

    if (!baseUrl || !apiKey) {
      return null;
    }

    return createOpenAiCompatibleProvider({
      baseUrl,
      apiKey,
      modelName: model.modelName,
      temperature: model.temperature,
      maxTokens: model.maxTokens,
      timeoutMs: model.timeoutMs,
      thinkingMode:
        model.provider.providerType === "DEEPSEEK" ? "disabled" : undefined
    });
  }

  return null;
}

async function withFallback<T>(
  findModel: typeof findSelectedAiModel,
  capability: "INTERVIEW_OUTLINE" | "INTERVIEW_FOLLOW_UP" | "REPORT_ANALYSIS",
  fallbackProvider: AiProvider,
  invoke: (provider: AiProvider) => Promise<T>
) {
  const model = await findModel(capability);

  if (!model) {
    return invoke(fallbackProvider);
  }

  const provider = providerForModel(model);

  if (!provider) {
    throw new Error(
      `Selected AI model ${model.provider.displayName}/${model.modelName} cannot be initialized.`
    );
  }

  return invoke(provider);
}

export function createDbConfiguredAiProvider({
  findModel = findSelectedAiModel,
  fallbackProvider = mockAiProvider
}: DbConfiguredAiProviderOptions = {}): AiProvider {
  return {
    async generateTrainingOutline(request: TrainingOutlineRequest) {
      return withFallback(findModel, "INTERVIEW_OUTLINE", fallbackProvider, (provider) =>
        provider.generateTrainingOutline(request)
      );
    },
    async generateFollowUpCoaching(input: FollowUpCoachingInput) {
      return withFallback(findModel, "INTERVIEW_FOLLOW_UP", fallbackProvider, (provider) =>
        provider.generateFollowUpCoaching(input)
      );
    },
    async generateCoachingReport(input: CoachingReportInput) {
      return withFallback(findModel, "REPORT_ANALYSIS", fallbackProvider, (provider) =>
        provider.generateCoachingReport(input)
      );
    }
  };
}
