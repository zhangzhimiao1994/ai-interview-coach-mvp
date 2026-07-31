import LingMouClient, {
  CreateBroadcastVideoFromTemplateRequest,
  GetBroadcastTemplateRequest,
  ListBroadcastVideosByIdRequest
} from "@alicloud/lingmou20250527";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import {
  decryptCredentialMap,
  readAiConfigSecret
} from "@/lib/domain/aiServices";
import type { ResolvedMediaModel } from "@/lib/media/config";
import {
  MediaConfigurationError,
  MediaProviderError
} from "@/lib/media/errors";
import type {
  AsyncAvatarVideoProvider,
  VideoSubmitInput
} from "@/lib/media/video/types";
import {
  buildLingmouCreateRequest,
  parseLingmouBroadcastSubmission,
  parseLingmouBroadcastVideo
} from "./lingmouBroadcastProtocol";

type LingmouBroadcastCredentials = {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
};

export type LingmouBroadcastConfiguration = {
  credentials: LingmouBroadcastCredentials;
  templateId: string;
  audioVariableName: string;
  portraitVariableName: string | null;
  resolution: string;
  fps: number;
  watermark: boolean;
  mode: string;
};

export interface LingmouBroadcastSdkClient {
  getBroadcastTemplate(request: GetBroadcastTemplateRequest): Promise<unknown>;
  createBroadcastVideoFromTemplate(
    request: CreateBroadcastVideoFromTemplateRequest
  ): Promise<unknown>;
  listBroadcastVideosById(request: ListBroadcastVideosByIdRequest): Promise<unknown>;
}

export type LingmouBroadcastDependencies = {
  createClient: (credentials: LingmouBroadcastCredentials) => LingmouBroadcastSdkClient;
  readConfigSecret: () => string;
};

export interface LingmouBroadcastProvider extends AsyncAvatarVideoProvider {
  diagnoseTemplate(): Promise<{
    templateId: string;
    traceId: string | null;
    variableNames: string[];
  }>;
}

export function resolveLingmouBroadcastConfiguration(
  model: ResolvedMediaModel,
  readConfigSecret: () => string = readAiConfigSecret
): LingmouBroadcastConfiguration {
  if (model.providerType !== "LINGMOU") {
    throw configurationError(model, "LINGMOU_BROADCAST_PROVIDER_REQUIRED", "A Lingmou broadcast provider is required");
  }
  if (model.capability !== "DIGITAL_HUMAN_VIDEO") {
    throw configurationError(model, "LINGMOU_BROADCAST_CAPABILITY_REQUIRED", "A Lingmou broadcast video model is required");
  }
  if (model.modelName !== "lingmou-broadcast-video") {
    throw configurationError(model, "LINGMOU_BROADCAST_ADAPTER_CONFIG_INVALID", "The selected Lingmou broadcast adapter is unsupported");
  }

  const credentials = readCredentials(model, readConfigSecret);
  const settings = model.modelSettings;
  const templateId = requiredSetting(model, settings.templateId, "LINGMOU_BROADCAST_TEMPLATE_ID_REQUIRED");
  const audioVariableName = requiredSetting(model, settings.audioVariableName, "LINGMOU_BROADCAST_AUDIO_VARIABLE_REQUIRED");
  const portraitSetting = settings.portraitVariableName;
  const portraitVariableName = portraitSetting === null ? null : text(portraitSetting);
  if (portraitSetting !== null && !portraitVariableName) {
    throw configurationError(model, "LINGMOU_BROADCAST_PORTRAIT_VARIABLE_INVALID", "The Lingmou portrait variable must be a name or null");
  }
  const resolution = requiredSetting(model, settings.resolution, "LINGMOU_BROADCAST_RESOLUTION_REQUIRED");
  const mode = requiredSetting(model, settings.mode, "LINGMOU_BROADCAST_MODE_REQUIRED");
  const fps = settings.fps;
  if (typeof fps !== "number" || !Number.isInteger(fps) || fps < 1 || fps > 60) {
    throw configurationError(model, "LINGMOU_BROADCAST_FPS_INVALID", "Lingmou broadcast FPS must be an integer from 1 to 60");
  }
  if (typeof settings.watermark !== "boolean") {
    throw configurationError(model, "LINGMOU_BROADCAST_WATERMARK_INVALID", "Lingmou broadcast watermark must be a boolean");
  }

  return {
    credentials,
    templateId,
    audioVariableName,
    portraitVariableName,
    resolution,
    fps,
    watermark: settings.watermark,
    mode
  };
}

export function createLingmouBroadcastProvider(
  model: ResolvedMediaModel,
  dependencyOverrides: Partial<LingmouBroadcastDependencies> = {}
): LingmouBroadcastProvider {
  const config = resolveLingmouBroadcastConfiguration(
    model,
    dependencyOverrides.readConfigSecret ?? readAiConfigSecret
  );
  const client = (dependencyOverrides.createClient ?? createSdkClient)(config.credentials);

  return {
    async submit(input) {
      validateSubmitInput(input, config.portraitVariableName);
      let response: unknown;
      try {
        response = await client.createBroadcastVideoFromTemplate(buildLingmouCreateRequest({
          name: input.requestName.trim(),
          templateId: config.templateId,
          audioVariableName: config.audioVariableName,
          audioUrl: input.audioUrl.trim(),
          portraitVariableName: config.portraitVariableName,
          portraitUrl: input.portraitUrl?.trim() ?? null,
          resolution: config.resolution,
          fps: config.fps,
          watermark: config.watermark,
          mode: config.mode
        }));
      } catch (error) {
        throw providerError(error);
      }

      const submission = parseLingmouBroadcastSubmission(response as never);
      if (!submission) {
        throw new MediaProviderError(
          "Lingmou broadcast submission returned an invalid response",
          "LINGMOU",
          "LINGMOU_BROADCAST_SUBMIT_INVALID_RESPONSE"
        );
      }
      return submission;
    },

    async query(upstreamTaskId) {
      const taskId = text(upstreamTaskId);
      if (!taskId) {
        throw new MediaConfigurationError("Lingmou broadcast task ID is required", {
          provider: "LINGMOU",
          code: "LINGMOU_BROADCAST_TASK_ID_REQUIRED"
        });
      }

      let response: unknown;
      try {
        response = await client.listBroadcastVideosById(
          new ListBroadcastVideosByIdRequest({ videoIds: [taskId] })
        );
      } catch (error) {
        throw providerError(error);
      }
      return parseLingmouBroadcastVideo(response as never, taskId);
    },

    async diagnoseTemplate() {
      let response: unknown;
      try {
        response = await client.getBroadcastTemplate(
          new GetBroadcastTemplateRequest({ templateId: config.templateId })
        );
      } catch (error) {
        throw providerError(error);
      }

      const body = responseBody(response);
      const template = object(body?.data);
      const templateId = text(template?.id);
      if (body?.success !== true || !templateId) {
        throw new MediaProviderError(
          "Lingmou broadcast template diagnostics returned an invalid response",
          "LINGMOU",
          "LINGMOU_BROADCAST_TEMPLATE_INVALID_RESPONSE"
        );
      }
      const variables = template && Array.isArray(template.variables)
        ? template.variables
        : [];
      return {
        templateId,
        traceId: text(body.requestId),
        variableNames: variables
          .map(object)
          .map((variable) => text(variable?.name))
          .filter((name): name is string => name !== null)
      };
    }
  };
}

function createSdkClient(credentials: LingmouBroadcastCredentials): LingmouBroadcastSdkClient {
  return new LingMouClient(new $OpenApiUtil.Config({
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    regionId: credentials.region
  }));
}

function readCredentials(
  model: ResolvedMediaModel,
  readConfigSecret: () => string
): LingmouBroadcastCredentials {
  const envelope = model.credentialEnvelopes.structured;
  let credentialMap: Record<string, string> = {};
  if (envelope) {
    try {
      credentialMap = decryptCredentialMap(envelope, readConfigSecret());
    } catch {
      throw configurationError(model, "LINGMOU_CREDENTIAL_DECRYPTION_FAILED", "Lingmou credentials could not be decrypted");
    }
  }
  const accessKeyId = text(credentialMap.accessKeyId);
  if (!accessKeyId) {
    throw configurationError(model, "LINGMOU_ACCESS_KEY_ID_REQUIRED", "Lingmou AccessKey ID is required");
  }
  const accessKeySecret = text(credentialMap.accessKeySecret);
  if (!accessKeySecret) {
    throw configurationError(model, "LINGMOU_ACCESS_KEY_SECRET_REQUIRED", "Lingmou AccessKey Secret is required");
  }
  return {
    accessKeyId,
    accessKeySecret,
    region: text(model.providerSettings.region) ?? "cn-beijing"
  };
}

function requiredSetting(model: ResolvedMediaModel, value: unknown, code: string): string {
  const setting = text(value);
  if (!setting) throw configurationError(model, code, "Lingmou broadcast configuration is incomplete");
  return setting;
}

function validateSubmitInput(input: VideoSubmitInput, portraitVariableName: string | null) {
  if (!text(input.requestName)) {
    throw new MediaConfigurationError("Lingmou broadcast request name is required", {
      provider: "LINGMOU",
      code: "LINGMOU_BROADCAST_REQUEST_NAME_REQUIRED"
    });
  }
  if (!httpsUrl(input.audioUrl)) {
    throw new MediaConfigurationError("Lingmou broadcast audio URL must use HTTPS", {
      provider: "LINGMOU",
      code: "LINGMOU_BROADCAST_AUDIO_URL_INVALID"
    });
  }
  if (!portraitVariableName) {
    if (input.portraitUrl !== null) {
      throw new MediaConfigurationError("The Lingmou broadcast template has no portrait variable", {
        provider: "LINGMOU",
        code: "LINGMOU_BROADCAST_PORTRAIT_NOT_CONFIGURED"
      });
    }
    return;
  }
  if (input.portraitUrl === null) {
    throw new MediaConfigurationError("Lingmou broadcast portrait URL is required", {
      provider: "LINGMOU",
      code: "LINGMOU_BROADCAST_PORTRAIT_URL_REQUIRED"
    });
  }
  if (!httpsUrl(input.portraitUrl)) {
    throw new MediaConfigurationError("Lingmou broadcast portrait URL must use HTTPS", {
      provider: "LINGMOU",
      code: "LINGMOU_BROADCAST_PORTRAIT_URL_INVALID"
    });
  }
}

function httpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function configurationError(model: ResolvedMediaModel, code: string, message: string) {
  return new MediaConfigurationError(message, { provider: model.providerType, code });
}

function providerError(error: unknown) {
  const code = errorCode(error);
  const statusCode = errorStatus(error);
  const safeCode = statusCode === 401 || statusCode === 403 || /accesskey|signature|auth|forbidden|unauthorized/.test(code)
    ? "LINGMOU_BROADCAST_AUTH_FAILED"
    : /template.*(notfound|not_found|notexist)/.test(code)
      ? "LINGMOU_BROADCAST_TEMPLATE_NOT_FOUND"
      : "LINGMOU_BROADCAST_UPSTREAM_FAILED";
  return new MediaProviderError("Lingmou broadcast request failed", "LINGMOU", safeCode, safeCode === "LINGMOU_BROADCAST_UPSTREAM_FAILED");
}

function errorCode(error: unknown): string {
  return object(error) && typeof object(error)?.code === "string"
    ? (object(error)?.code as string).toLowerCase()
    : "";
}

function errorStatus(error: unknown): number | undefined {
  const statusCode = object(error)?.statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
}

function responseBody(value: unknown): Record<string, unknown> | null {
  return object(object(value)?.body);
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}
