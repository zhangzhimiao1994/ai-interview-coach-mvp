import {
  decryptCredentialMap,
  readAiConfigSecret
} from "@/lib/domain/aiServices";
import type { ResolvedMediaModel } from "@/lib/media/config";
import { MediaConfigurationError } from "@/lib/media/errors";

export type LingmouCredentials = {
  accessKeyId: string;
  accessKeySecret: string;
  region: "cn-beijing";
  configId: string;
  instanceId: string;
};

export type LingmouCloseCredentials = Omit<LingmouCredentials, "configId">;

export type LingmouCloseCredentialSource = Pick<
  ResolvedMediaModel,
  "providerType" | "providerSettings" | "credentialEnvelopes"
>;

export const lingmouAdapterContract = {
  modelName: "lingmou-2d-cloud-audio-driven",
  renderMode: "cloud",
  integrationMode: "audio-driven",
  client: "web"
} as const;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function configurationError(
  model: LingmouCloseCredentialSource,
  code: string,
  message: string
) {
  return new MediaConfigurationError(message, {
    provider: model.providerType,
    code
  });
}

export function resolveLingmouCloseCredentials(
  source: LingmouCloseCredentialSource,
  persistedInstanceId: string,
  readConfigSecret: () => string = readAiConfigSecret
): LingmouCloseCredentials {
  if (source.providerType !== "LINGMOU") {
    throw configurationError(
      source,
      "LINGMOU_PROVIDER_REQUIRED",
      "The digital-human session was not created by Lingmou"
    );
  }

  let credentials: Record<string, string> = {};
  const envelope = source.credentialEnvelopes.structured;
  if (envelope) {
    try {
      credentials = decryptCredentialMap(envelope, readConfigSecret());
    } catch {
      throw configurationError(
        source,
        "LINGMOU_CREDENTIAL_DECRYPTION_FAILED",
        "Lingmou credentials could not be decrypted"
      );
    }
  }

  const accessKeyId = text(credentials.accessKeyId);
  if (!accessKeyId) {
    throw configurationError(
      source,
      "LINGMOU_ACCESS_KEY_ID_REQUIRED",
      "Lingmou AccessKey ID is required"
    );
  }

  const accessKeySecret = text(credentials.accessKeySecret);
  if (!accessKeySecret) {
    throw configurationError(
      source,
      "LINGMOU_ACCESS_KEY_SECRET_REQUIRED",
      "Lingmou AccessKey Secret is required"
    );
  }

  const region = text(source.providerSettings.region);
  if (region !== "cn-beijing") {
    throw configurationError(
      source,
      "LINGMOU_REGION_INVALID",
      "Lingmou region must be cn-beijing"
    );
  }

  const instanceId = text(persistedInstanceId);
  if (!instanceId) {
    throw configurationError(
      source,
      "LINGMOU_INSTANCE_ID_REQUIRED",
      "Lingmou instance ID is required"
    );
  }

  return {
    accessKeyId,
    accessKeySecret,
    region: "cn-beijing",
    instanceId
  };
}

export function resolveLingmouCredentials(
  model: ResolvedMediaModel,
  readConfigSecret: () => string = readAiConfigSecret
): LingmouCredentials {
  if (
    model.capability !== "DIGITAL_HUMAN_REALTIME" ||
    model.providerType !== "LINGMOU"
  ) {
    throw configurationError(
      model,
      "LINGMOU_PROVIDER_REQUIRED",
      "The selected digital-human model is not a Lingmou model"
    );
  }

  if (
    model.modelName !== lingmouAdapterContract.modelName ||
    model.modelSettings.renderMode !== lingmouAdapterContract.renderMode ||
    model.modelSettings.integrationMode !==
      lingmouAdapterContract.integrationMode ||
    model.modelSettings.client !== lingmouAdapterContract.client
  ) {
    throw configurationError(
      model,
      "LINGMOU_ADAPTER_CONFIG_INVALID",
      "The selected Lingmou adapter configuration is unsupported"
    );
  }

  const closeCredentials = resolveLingmouCloseCredentials(
    model,
    text(model.modelSettings.instanceId),
    readConfigSecret
  );

  const configId = text(model.modelSettings.configId);
  if (!configId) {
    throw configurationError(
      model,
      "LINGMOU_CONFIG_ID_REQUIRED",
      "Lingmou config ID is required"
    );
  }

  return {
    ...closeCredentials,
    configId
  };
}
