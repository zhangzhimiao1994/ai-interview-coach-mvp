import { prisma } from "@/lib/db/prisma";
import {
  decryptCredentialMap,
  decryptSecret,
  readAiConfigSecret,
  type CredentialMap,
  type EncryptedSecret
} from "@/lib/domain/aiServices";
import {
  aiCapabilities,
  type AiCapability
} from "@/lib/domain/aiServiceConstants";
import {
  isTextDiagnosticCapability,
  type AiDiagnosticCheckMode,
  type AiDiagnosticResult,
  type AiDiagnosticStatus
} from "./diagnosticTypes";
import {
  probeOpenAiCompatibleModel,
  type OpenAiCompatibleProbeResult,
  type OpenAiCompatibleProviderConfig
} from "./openAiCompatibleProvider";
import {
  isAlibabaRegion,
  isAlibabaWorkspaceId
} from "@/lib/media/providers/alibabaCredentials";
import { validateAlibabaHttpTtsModelName } from "@/lib/media/providers/alibabaTts";
import { MediaConfigurationError } from "@/lib/media/errors";

type JsonObject = Record<string, unknown>;

type DiagnosticModel = {
  id: string;
  providerId: string;
  displayName: string;
  modelName: string;
  capability: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  settingsJson: string;
  enabled: boolean;
  isSelected: boolean;
  provider: {
    id: string;
    displayName: string;
    providerType: string;
    baseUrl: string | null;
    settingsJson: string;
    enabled: boolean;
    apiKeyCiphertext: string | null;
    apiKeyIv: string | null;
    apiKeyTag: string | null;
    credentialsCiphertext: string | null;
    credentialsIv: string | null;
    credentialsTag: string | null;
  };
};

type FindDiagnosticModel = (
  capability: AiCapability
) => Promise<DiagnosticModel | null>;

export type AiDiagnosticDependencies = {
  findModel: FindDiagnosticModel;
  readConfigSecret: () => string;
  probeTextModel: (
    config: OpenAiCompatibleProviderConfig
  ) => Promise<OpenAiCompatibleProbeResult>;
  now: () => number;
};

export type DiagnoseAiCapabilityOptions = {
  liveCheck: boolean;
  dependencies?: Partial<AiDiagnosticDependencies>;
};

class DiagnosticConfigurationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "DiagnosticConfigurationError";
  }
}

export async function findDiagnosticModel(capability: AiCapability) {
  return prisma.aiModelConfig.findFirst({
    where: { capability, isSelected: true },
    include: { provider: true }
  });
}

function dependencies(
  overrides: Partial<AiDiagnosticDependencies> | undefined
): AiDiagnosticDependencies {
  return {
    findModel: findDiagnosticModel,
    readConfigSecret: () => readAiConfigSecret(),
    probeTextModel: probeOpenAiCompatibleModel,
    now: Date.now,
    ...overrides
  };
}

function parseSettings(
  value: string | null | undefined,
  code: "INVALID_PROVIDER_SETTINGS" | "INVALID_MODEL_SETTINGS"
): JsonObject {
  try {
    const parsed: unknown = JSON.parse(value ?? "{}");

    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("Settings are not an object");
    }

    return parsed as JsonObject;
  } catch {
    throw new DiagnosticConfigurationError(
      code,
      code === "INVALID_PROVIDER_SETTINGS"
        ? "服务商配置无法安全解析。"
        : "模型配置无法安全解析。"
    );
  }
}

function credentialEnvelope(
  ciphertext: string | null | undefined,
  iv: string | null | undefined,
  tag: string | null | undefined
): EncryptedSecret | null {
  if (!ciphertext && !iv && !tag) {
    return null;
  }

  if (!ciphertext || !iv || !tag) {
    throw new DiagnosticConfigurationError(
      "INVALID_CREDENTIAL_ENVELOPE",
      "保存的凭据元数据不完整。"
    );
  }

  return { ciphertext, iv, tag };
}

function readCredentials(
  model: DiagnosticModel,
  readConfigSecret: () => string
): { apiKey: string; credentials: CredentialMap } {
  const apiKeyEnvelope = credentialEnvelope(
    model.provider.apiKeyCiphertext,
    model.provider.apiKeyIv,
    model.provider.apiKeyTag
  );
  const structuredEnvelope = credentialEnvelope(
    model.provider.credentialsCiphertext,
    model.provider.credentialsIv,
    model.provider.credentialsTag
  );

  if (!apiKeyEnvelope && !structuredEnvelope) {
    return { apiKey: "", credentials: {} };
  }

  try {
    const configSecret = readConfigSecret();
    return {
      apiKey: apiKeyEnvelope
        ? decryptSecret(apiKeyEnvelope, configSecret).trim()
        : "",
      credentials: structuredEnvelope
        ? decryptCredentialMap(structuredEnvelope, configSecret)
        : {}
    };
  } catch {
    throw new DiagnosticConfigurationError(
      "CREDENTIAL_DECRYPTION_FAILED",
      "保存的凭据无法解密，请重新保存服务商凭据。"
    );
  }
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value: unknown) {
  return isPositiveNumber(value) && Number.isInteger(value);
}

function isUnitInterval(value: unknown) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isHttpUrl(value: string | null) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function requiredConfiguration(
  capability: AiCapability,
  model: DiagnosticModel,
  providerSettings: JsonObject,
  modelSettings: JsonObject,
  apiKey: string,
  credentials: CredentialMap
) {
  const missing: string[] = [];
  const isMock = model.provider.providerType === "MOCK";
  const usesAlibabaMediaEndpoint =
    (capability === "SPEECH_TO_TEXT" || capability === "TEXT_TO_SPEECH") &&
    model.provider.providerType === "TONGYI";

  if (!hasText(model.modelName)) {
    missing.push("模型名称");
  }

  if (!isMock && !usesAlibabaMediaEndpoint && !model.provider.baseUrl) {
    missing.push("Base URL");
  } else if (
    !isMock &&
    !usesAlibabaMediaEndpoint &&
    !isHttpUrl(model.provider.baseUrl)
  ) {
    throw new DiagnosticConfigurationError(
      "INVALID_BASE_URL",
      "Base URL 必须使用有效的 HTTP 或 HTTPS 地址。"
    );
  }

  const usesAsrCredential =
    capability === "SPEECH_TO_TEXT" && hasText(credentials.asrApiKey);
  const usesTtsCredential =
    capability === "TEXT_TO_SPEECH" && hasText(credentials.ttsApiKey);

  if (
    !isMock &&
    !hasText(apiKey) &&
    !usesAsrCredential &&
    !usesTtsCredential
  ) {
    missing.push("主 API Key");
  }

  if (model.provider.providerType === "TONGYI") {
    switch (capability) {
      case "SPEECH_TO_TEXT":
        if (!hasText(apiKey) && !hasText(credentials.asrApiKey)) {
          missing.push("主 API Key 或 ASR API Key");
        }
        if (!isAlibabaWorkspaceId(providerSettings.workspaceId)) {
          missing.push("Workspace ID");
        }
        if (!isAlibabaRegion(providerSettings.region)) {
          missing.push("实时服务地域");
        }
        if (!hasText(modelSettings.language)) missing.push("识别语言");
        if (!isPositiveInteger(modelSettings.sampleRate)) missing.push("采样率");
        if (modelSettings.encoding !== "pcm") {
          missing.push("音频编码（当前仅支持 PCM）");
        }
        break;
      case "TEXT_TO_SPEECH":
        if (!hasText(apiKey) && !hasText(credentials.ttsApiKey)) {
          missing.push("主 API Key 或 TTS API Key");
        }
        if (!isAlibabaWorkspaceId(providerSettings.workspaceId)) {
          missing.push("Workspace ID");
        }
        if (!isAlibabaRegion(providerSettings.region)) {
          missing.push("服务地域");
        }
        if (!hasText(modelSettings.voice)) missing.push("音色");
        try {
          validateAlibabaHttpTtsModelName(model.modelName);
        } catch (error) {
          if (error instanceof MediaConfigurationError) {
            throw new DiagnosticConfigurationError(
              error.code,
              error.code === "ALIBABA_TTS_HTTP_MODEL_REQUIRED"
                ? "当前播放链路使用 HTTP，请选择不带 -realtime 的阿里 TTS 模型。"
                : "阿里 TTS 模型名称无效。"
            );
          }

          throw error;
        }
        break;
      case "DIGITAL_HUMAN_REALTIME":
        if (!hasText(providerSettings.rtcAppId)) missing.push("RTC App ID");
        if (!hasText(credentials.rtcAppKey)) missing.push("RTC App Key");
        if (!hasText(modelSettings.avatarId)) missing.push("Avatar ID");
        if (!hasText(modelSettings.rtcMode)) missing.push("RTC 模式");
        break;
      case "VISION_BEHAVIOR_ANALYSIS":
        if (!isUnitInterval(modelSettings.minimumConfidence)) {
          missing.push("最低置信度");
        }
        if (!isPositiveInteger(modelSettings.frameIntervalMs)) {
          missing.push("抽帧间隔");
        }
        if (!isPositiveInteger(modelSettings.maxFrames)) {
          missing.push("最大帧数");
        }
        break;
    }
  }

  if (missing.length > 0) {
    throw new DiagnosticConfigurationError(
      "MISSING_REQUIRED_CONFIGURATION",
      `配置缺少或无效：${[...new Set(missing)].join("、")}。`
    );
  }
}

type ResultContext = {
  capability: AiCapability;
  checkMode: AiDiagnosticCheckMode;
  startedAt: number;
  model: DiagnosticModel | null;
};

function result(
  context: ResultContext,
  status: AiDiagnosticStatus,
  code: string,
  message: string,
  now: () => number
): AiDiagnosticResult {
  const finishedAt = now();

  return {
    capability: context.capability,
    providerName: context.model?.provider.displayName ?? null,
    modelDisplayName: context.model?.displayName ?? null,
    modelName: context.model?.modelName ?? null,
    checkMode: context.checkMode,
    status,
    code,
    latencyMs: Math.max(0, finishedAt - context.startedAt),
    message,
    checkedAt: new Date(finishedAt).toISOString()
  };
}

export async function diagnoseAiCapability(
  capability: AiCapability,
  options: DiagnoseAiCapabilityOptions
): Promise<AiDiagnosticResult> {
  const deps = dependencies(options.dependencies);
  const context: ResultContext = {
    capability,
    checkMode: options.liveCheck ? "LIVE" : "CONFIG",
    startedAt: deps.now(),
    model: null
  };

  try {
    try {
      context.model = await deps.findModel(capability);
    } catch {
      return result(
        context,
        "UNREACHABLE",
        "CONFIGURATION_LOOKUP_FAILED",
        "暂时无法读取 AI 配置。",
        deps.now
      );
    }

    const model = context.model;

    if (!model || !model.isSelected || model.capability !== capability) {
      return result(
        context,
        "NOT_SELECTED",
        "MODEL_NOT_SELECTED",
        "该能力尚未选择当前使用模型。",
        deps.now
      );
    }

    if (!model.enabled) {
      return result(
        context,
        "MISCONFIGURED",
        "MODEL_DISABLED",
        "当前使用模型已停用。",
        deps.now
      );
    }

    if (!model.provider.enabled) {
      return result(
        context,
        "MISCONFIGURED",
        "PROVIDER_DISABLED",
        "当前模型所属服务商已停用。",
        deps.now
      );
    }

    const providerSettings = parseSettings(
      model.provider.settingsJson,
      "INVALID_PROVIDER_SETTINGS"
    );
    const modelSettings = parseSettings(
      model.settingsJson,
      "INVALID_MODEL_SETTINGS"
    );
    const { apiKey, credentials } = readCredentials(
      model,
      deps.readConfigSecret
    );

    requiredConfiguration(
      capability,
      model,
      providerSettings,
      modelSettings,
      apiKey,
      credentials
    );

    if (capability === "SPEECH_TO_TEXT") {
      if (model.provider.providerType !== "TONGYI") {
        return result(
          context,
          "CONFIGURED_NOT_ADAPTED",
          "ADAPTER_NOT_IMPLEMENTED",
          "配置完整，当前实时语音适配器仅支持阿里百炼。",
          deps.now
        );
      }

      return result(
        context,
        "CONFIG_VALID",
        options.liveCheck
          ? "LIVE_CHECK_REQUIRES_AUDIO"
          : "ADAPTER_AVAILABLE",
        options.liveCheck
          ? "实时语音连通需要麦克风音频，将在面试间内按需验证。"
          : "配置检查通过，实时语音连接将在面试间内按需建立。",
        deps.now
      );
    }

    if (capability === "TEXT_TO_SPEECH") {
      if (model.provider.providerType !== "TONGYI") {
        return result(
          context,
          "CONFIGURED_NOT_ADAPTED",
          "ADAPTER_NOT_IMPLEMENTED",
          "配置完整，当前语音合成适配器仅支持阿里百炼。",
          deps.now
        );
      }

      return result(
        context,
        "CONFIG_VALID",
        options.liveCheck
          ? "LIVE_CHECK_REQUIRES_TEXT"
          : "ADAPTER_AVAILABLE",
        options.liveCheck
          ? "语音合成真实连通需要生成测试音频，将在面试间内按需验证。"
          : "配置检查通过，语音合成将在面试间内按需调用。",
        deps.now
      );
    }

    if (!isTextDiagnosticCapability(capability)) {
      return result(
        context,
        "CONFIGURED_NOT_ADAPTED",
        "ADAPTER_NOT_IMPLEMENTED",
        "配置完整，等待真实服务适配器。",
        deps.now
      );
    }

    if (!options.liveCheck) {
      return result(
        context,
        "CONFIG_VALID",
        "CONFIG_VALID",
        "配置检查通过，未执行真实请求。",
        deps.now
      );
    }

    if (model.provider.providerType === "MOCK") {
      return result(
        context,
        "CONFIGURED_NOT_ADAPTED",
        "MOCK_PROVIDER_NOT_LIVE",
        "Mock 模型不能证明真实服务可用。",
        deps.now
      );
    }

    const probe = await deps.probeTextModel({
      baseUrl: model.provider.baseUrl!,
      apiKey,
      modelName: model.modelName,
      temperature: model.temperature,
      maxTokens: model.maxTokens,
      timeoutMs: model.timeoutMs
    });

    return result(
      context,
      probe.ok ? "AVAILABLE" : "UNREACHABLE",
      probe.code,
      probe.message,
      deps.now
    );
  } catch (error) {
    if (error instanceof DiagnosticConfigurationError) {
      return result(
        context,
        "MISCONFIGURED",
        error.code,
        error.message,
        deps.now
      );
    }

    return result(
      context,
      "UNREACHABLE",
      "DIAGNOSTIC_FAILED",
      "诊断执行失败，请稍后重试。",
      deps.now
    );
  }
}

export async function getAllAiDiagnostics(
  dependencyOverrides: Partial<AiDiagnosticDependencies> = {}
): Promise<AiDiagnosticResult[]> {
  return Promise.all(
    aiCapabilities.map((capability) =>
      diagnoseAiCapability(capability, {
        liveCheck: false,
        dependencies: dependencyOverrides
      })
    )
  );
}
