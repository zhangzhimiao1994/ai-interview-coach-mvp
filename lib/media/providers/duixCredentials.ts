import {
  decryptCredentialMap,
  readAiConfigSecret
} from "@/lib/domain/aiServices";
import type { ResolvedMediaModel } from "@/lib/media/config";
import { MediaConfigurationError } from "@/lib/media/errors";

export type DuixCredentials = {
  appId: string;
  appSecret: string;
  conversationId: string;
  platform: string;
};

export const duixAdapterContract = {
  modelName: "duix-h5-realtime",
  adapter: "DUIX_H5_SDK",
  client: "web",
  interactionMode: "direct-drive",
  speechMode: "duix-managed",
  defaultPlatform: "duix.com"
} as const;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function configurationError(
  model: Pick<ResolvedMediaModel, "providerType">,
  code: string,
  message: string
) {
  return new MediaConfigurationError(message, {
    provider: model.providerType,
    code
  });
}

export function hasCompleteDuixConfiguration(
  modelName: string,
  providerSettings: Record<string, unknown>,
  modelSettings: Record<string, unknown>,
  credentials: Record<string, string>
) {
  return (
    modelName === duixAdapterContract.modelName &&
    text(credentials.appId).length > 0 &&
    text(credentials.appSecret).length > 0 &&
    text(modelSettings.conversationId).length > 0 &&
    (text(providerSettings.platform) || duixAdapterContract.defaultPlatform)
      .length > 0 &&
    modelSettings.client === duixAdapterContract.client &&
    modelSettings.interactionMode === duixAdapterContract.interactionMode &&
    modelSettings.speechMode === duixAdapterContract.speechMode
  );
}

export function resolveDuixCredentials(
  model: ResolvedMediaModel,
  readConfigSecret: () => string = readAiConfigSecret
): DuixCredentials {
  if (
    model.capability !== "DIGITAL_HUMAN_REALTIME" ||
    model.providerType !== "DUIX"
  ) {
    throw configurationError(
      model,
      "DUIX_PROVIDER_REQUIRED",
      "The selected digital-human model is not a DUIX model"
    );
  }

  if (
    model.modelName !== duixAdapterContract.modelName ||
    model.modelSettings.client !== duixAdapterContract.client ||
    model.modelSettings.interactionMode !==
      duixAdapterContract.interactionMode ||
    model.modelSettings.speechMode !== duixAdapterContract.speechMode
  ) {
    throw configurationError(
      model,
      "DUIX_ADAPTER_CONFIG_INVALID",
      "The selected DUIX adapter configuration is unsupported"
    );
  }

  let credentials: Record<string, string> = {};
  const envelope = model.credentialEnvelopes.structured;
  if (envelope) {
    try {
      credentials = decryptCredentialMap(envelope, readConfigSecret());
    } catch {
      throw configurationError(
        model,
        "DUIX_CREDENTIAL_DECRYPTION_FAILED",
        "DUIX credentials could not be decrypted"
      );
    }
  }

  const appId = text(credentials.appId);
  if (!appId) {
    throw configurationError(
      model,
      "DUIX_APP_ID_REQUIRED",
      "DUIX appId is required"
    );
  }

  const appSecret = text(credentials.appSecret);
  if (!appSecret) {
    throw configurationError(
      model,
      "DUIX_APP_SECRET_REQUIRED",
      "DUIX appSecret is required"
    );
  }

  const conversationId = text(model.modelSettings.conversationId);
  if (!conversationId) {
    throw configurationError(
      model,
      "DUIX_CONVERSATION_ID_REQUIRED",
      "DUIX conversationId is required"
    );
  }

  return {
    appId,
    appSecret,
    conversationId,
    platform:
      text(model.providerSettings.platform) ||
      duixAdapterContract.defaultPlatform
  };
}
