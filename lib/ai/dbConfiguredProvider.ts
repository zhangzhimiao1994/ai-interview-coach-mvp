import { decryptSecret, readAiConfigSecret, type EncryptedSecret } from "@/lib/domain/aiServices";
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

    if (!model.provider.baseUrl || !encrypted) {
      return null;
    }

    return createOpenAiCompatibleProvider({
      baseUrl: model.provider.baseUrl,
      apiKey: decryptSecret(encrypted, readAiConfigSecret()),
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
