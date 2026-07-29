import {
  decryptCredentialMap,
  decryptSecret,
  readAiConfigSecret,
  type CredentialMap
} from "@/lib/domain/aiServices";
import type { ResolvedMediaModel } from "@/lib/media/config";
import { MediaConfigurationError } from "@/lib/media/errors";

export const alibabaRealtimeRegions = [
  "cn-beijing",
  "ap-southeast-1"
] as const;

export type AlibabaRealtimeRegion = (typeof alibabaRealtimeRegions)[number];

export type AlibabaAsrCredentials = {
  apiKey: string;
  workspaceId: string;
  region: AlibabaRealtimeRegion;
};

export type AlibabaTtsCredentials = {
  apiKey: string;
  workspaceId: string;
  region: AlibabaRealtimeRegion;
};

export type AlibabaEmoCredentials = {
  apiKey: string;
};

export function isAlibabaWorkspaceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})$/.test(value.trim())
  );
}

export function isAlibabaRegion(
  value: unknown
): value is AlibabaRealtimeRegion {
  return (
    typeof value === "string" &&
    alibabaRealtimeRegions.includes(value.trim() as AlibabaRealtimeRegion)
  );
}

function textSetting(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function decryptCredentials(
  model: ResolvedMediaModel,
  readConfigSecret: () => string
) {
  const { apiKey, structured } = model.credentialEnvelopes;

  if (!apiKey && !structured) {
    return { apiKey: "", credentials: {} as CredentialMap };
  }

  try {
    const configSecret = readConfigSecret();
    return {
      apiKey: apiKey ? decryptSecret(apiKey, configSecret).trim() : "",
      credentials: structured
        ? decryptCredentialMap(structured, configSecret)
        : {}
    };
  } catch {
    throw new MediaConfigurationError(
      "Alibaba credentials could not be decrypted",
      {
        provider: model.providerType,
        code: "ALIBABA_CREDENTIAL_DECRYPTION_FAILED"
      }
    );
  }
}

export function resolveAlibabaAsrCredentials(
  model: ResolvedMediaModel,
  readConfigSecret: () => string = readAiConfigSecret
): AlibabaAsrCredentials {
  if (
    model.capability !== "SPEECH_TO_TEXT" ||
    model.providerType !== "TONGYI"
  ) {
    throw new MediaConfigurationError(
      "The selected speech model is not an Alibaba ASR model",
      {
        provider: model.providerType,
        code: "ALIBABA_ASR_PROVIDER_REQUIRED"
      }
    );
  }

  const workspaceId = textSetting(model.providerSettings.workspaceId);
  if (!workspaceId) {
    throw new MediaConfigurationError("Alibaba workspace ID is required", {
      provider: model.providerType,
      code: "ALIBABA_WORKSPACE_REQUIRED"
    });
  }

  if (!isAlibabaWorkspaceId(workspaceId)) {
    throw new MediaConfigurationError("Alibaba workspace ID is invalid", {
      provider: model.providerType,
      code: "ALIBABA_WORKSPACE_INVALID"
    });
  }

  const region = textSetting(model.providerSettings.region);
  if (!isAlibabaRegion(region)) {
    throw new MediaConfigurationError("Alibaba realtime region is invalid", {
      provider: model.providerType,
      code: "ALIBABA_REGION_INVALID"
    });
  }

  const decrypted = decryptCredentials(model, readConfigSecret);
  const apiKey = textSetting(decrypted.credentials.asrApiKey) || decrypted.apiKey;

  if (!apiKey) {
    throw new MediaConfigurationError("Alibaba ASR API key is required", {
      provider: model.providerType,
      code: "ALIBABA_ASR_API_KEY_REQUIRED"
    });
  }

  return {
    apiKey,
    workspaceId,
    region: region as AlibabaRealtimeRegion
  };
}

export function resolveAlibabaTtsCredentials(
  model: ResolvedMediaModel,
  readConfigSecret: () => string = readAiConfigSecret
): AlibabaTtsCredentials {
  if (
    model.capability !== "TEXT_TO_SPEECH" ||
    model.providerType !== "TONGYI"
  ) {
    throw new MediaConfigurationError(
      "The selected speech model is not an Alibaba TTS model",
      {
        provider: model.providerType,
        code: "ALIBABA_TTS_PROVIDER_REQUIRED"
      }
    );
  }

  const workspaceId = textSetting(model.providerSettings.workspaceId);
  if (!workspaceId) {
    throw new MediaConfigurationError("Alibaba workspace ID is required", {
      provider: model.providerType,
      code: "ALIBABA_WORKSPACE_REQUIRED"
    });
  }

  if (!isAlibabaWorkspaceId(workspaceId)) {
    throw new MediaConfigurationError("Alibaba workspace ID is invalid", {
      provider: model.providerType,
      code: "ALIBABA_WORKSPACE_INVALID"
    });
  }

  const region = textSetting(model.providerSettings.region);
  if (!isAlibabaRegion(region)) {
    throw new MediaConfigurationError("Alibaba TTS region is invalid", {
      provider: model.providerType,
      code: "ALIBABA_REGION_INVALID"
    });
  }

  const decrypted = decryptCredentials(model, readConfigSecret);
  const apiKey = textSetting(decrypted.credentials.ttsApiKey) || decrypted.apiKey;

  if (!apiKey) {
    throw new MediaConfigurationError("Alibaba TTS API key is required", {
      provider: model.providerType,
      code: "ALIBABA_TTS_API_KEY_REQUIRED"
    });
  }

  return {
    apiKey,
    workspaceId,
    region: region as AlibabaRealtimeRegion
  };
}

export function resolveAlibabaEmoCredentials(
  model: ResolvedMediaModel,
  readConfigSecret: () => string = readAiConfigSecret
): AlibabaEmoCredentials {
  if (
    model.capability !== "DIGITAL_HUMAN_VIDEO" ||
    model.providerType !== "TONGYI"
  ) {
    throw new MediaConfigurationError(
      "The selected video model is not an Alibaba EMO model",
      {
        provider: model.providerType,
        code: "ALIBABA_EMO_PROVIDER_REQUIRED"
      }
    );
  }

  const decrypted = decryptCredentials(model, readConfigSecret);
  const apiKey =
    decrypted.apiKey || textSetting(decrypted.credentials.ttsApiKey);

  if (!apiKey) {
    throw new MediaConfigurationError(
      "Alibaba DashScope API key is required",
      {
        provider: model.providerType,
        code: "ALIBABA_EMO_API_KEY_REQUIRED"
      }
    );
  }

  return { apiKey };
}
