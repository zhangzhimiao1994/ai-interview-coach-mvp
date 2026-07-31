import { readAiConfigSecret } from "@/lib/domain/aiServices";
import type { ResolvedMediaModel } from "@/lib/media/config";
import { MediaConfigurationError, MediaProviderError } from "@/lib/media/errors";
import { resolveAlibabaEmoCredentials } from "@/lib/media/providers/alibabaCredentials";
import type {
  AsyncAvatarVideoProvider,
  VideoAssetMetadata,
  VideoSubmitInput
} from "@/lib/media/video/types";
import {
  buildEmoDetectionRequest,
  buildEmoQueryRequest,
  buildEmoSubmitRequest,
  parseEmoDetectionResponse,
  parseEmoQueryResponse,
  parseEmoSubmitResponse,
  type EmoRatio,
  type EmoStyleLevel
} from "./alibabaEmoProtocol";

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 60;
const MIN_PORTRAIT_SIDE = 400;
const MAX_PORTRAIT_SIDE = 7000;
const AUDIO_CONTENT_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav"
]);
const PORTRAIT_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/bmp",
  "image/x-ms-bmp",
  "image/webp"
]);
const STYLE_LEVELS = new Set<EmoStyleLevel>(["normal", "calm", "active"]);

export type AlibabaEmoConfiguration = {
  apiKey: string;
  model: "emo-v1";
  ratio: EmoRatio;
  styleLevel: EmoStyleLevel;
};

export type AlibabaEmoDependencies = {
  fetcher: (
    input: string | URL | Request,
    init?: RequestInit
  ) => Promise<Response>;
  readConfigSecret: () => string;
};

export function resolveAlibabaEmoConfiguration(
  model: ResolvedMediaModel,
  readConfigSecret: () => string = readAiConfigSecret
): AlibabaEmoConfiguration {
  const { apiKey } = resolveAlibabaEmoCredentials(model, readConfigSecret);
  if (model.modelName !== "emo-v1") {
    throw configurationError(
      model,
      "ALIBABA_EMO_ADAPTER_CONFIG_INVALID",
      "The selected Alibaba EMO adapter is unsupported"
    );
  }
  if (model.modelSettings.model !== "emo-v1") {
    throw configurationError(
      model,
      "ALIBABA_EMO_MODEL_INVALID",
      "Alibaba EMO model configuration is invalid"
    );
  }
  const ratio = model.modelSettings.ratio;
  if (ratio !== "1:1" && ratio !== "3:4") {
    throw configurationError(
      model,
      "ALIBABA_EMO_RATIO_INVALID",
      "Alibaba EMO portrait ratio is invalid"
    );
  }
  const configuredStyle = model.modelSettings.styleLevel;
  const styleLevel = configuredStyle === undefined
    ? "normal"
    : text(configuredStyle);
  if (!styleLevel || !STYLE_LEVELS.has(styleLevel as EmoStyleLevel)) {
    throw configurationError(
      model,
      "ALIBABA_EMO_STYLE_LEVEL_INVALID",
      "Alibaba EMO style level is invalid"
    );
  }

  return {
    apiKey,
    model: "emo-v1",
    ratio,
    styleLevel: styleLevel as EmoStyleLevel
  };
}

export function createAlibabaEmoProvider(
  model: ResolvedMediaModel,
  dependencyOverrides: Partial<AlibabaEmoDependencies> = {}
): AsyncAvatarVideoProvider {
  const config = resolveAlibabaEmoConfiguration(
    model,
    dependencyOverrides.readConfigSecret ?? readAiConfigSecret
  );
  const fetcher = dependencyOverrides.fetcher ?? fetch;

  return {
    async submit(input) {
      const validated = validateSubmitInput(input);
      const detectionRequest = buildEmoDetectionRequest({
        portraitUrl: validated.portraitUrl,
        ratio: config.ratio
      });
      const detectionResponse = await safeFetch(fetcher, detectionRequest, config.apiKey);
      const detection = await parseEmoDetectionResponse(detectionResponse);
      if (detection.safeErrorCode || !detection.faceBbox || !detection.extBbox) {
        throw providerError(
          detection.safeErrorCode ?? "ALIBABA_EMO_DETECTION_INVALID_RESPONSE",
          detection.traceId
        );
      }

      const submitRequest = buildEmoSubmitRequest({
        model: config.model,
        portraitUrl: validated.portraitUrl,
        audioUrl: validated.audioUrl,
        faceBbox: detection.faceBbox,
        extBbox: detection.extBbox,
        styleLevel: config.styleLevel
      });
      const submitResponse = await safeFetch(fetcher, submitRequest, config.apiKey);
      const submission = await parseEmoSubmitResponse(submitResponse);
      if (submission.safeErrorCode || !submission.upstreamTaskId) {
        throw providerError(
          submission.safeErrorCode ?? "ALIBABA_EMO_SUBMIT_INVALID_RESPONSE",
          submission.traceId
        );
      }
      return {
        upstreamTaskId: submission.upstreamTaskId,
        traceId: submission.traceId
      };
    },

    async query(upstreamTaskId) {
      const taskId = text(upstreamTaskId);
      if (!taskId) {
        throw new MediaConfigurationError("Alibaba EMO task ID is required", {
          provider: model.providerType,
          code: "ALIBABA_EMO_TASK_ID_REQUIRED"
        });
      }
      const request = buildEmoQueryRequest(taskId);
      try {
        const response = await fetcher(request.url, {
          method: request.method,
          headers: { ...request.headers, Authorization: `Bearer ${config.apiKey}` }
        });
        return parseEmoQueryResponse(response);
      } catch {
        return {
          status: "FAILED",
          videoUrl: null,
          safeErrorCode: "ALIBABA_EMO_UPSTREAM_FAILED",
          traceId: null,
          completedAt: null
        };
      }
    }
  };
}

async function safeFetch(
  fetcher: AlibabaEmoDependencies["fetcher"],
  request: ReturnType<typeof buildEmoDetectionRequest> | ReturnType<typeof buildEmoSubmitRequest>,
  apiKey: string
): Promise<Response> {
  try {
    return await fetcher(request.url, {
      method: request.method,
      headers: { ...request.headers, Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(request.body)
    });
  } catch {
    throw providerError("ALIBABA_EMO_UPSTREAM_FAILED", null);
  }
}

function validateSubmitInput(input: VideoSubmitInput): {
  audioUrl: string;
  portraitUrl: string;
} {
  if (!text(input.requestName)) {
    throw inputError("ALIBABA_EMO_REQUEST_NAME_REQUIRED", "Alibaba EMO request name is required");
  }
  const audioUrl = httpsUrl(input.audioUrl);
  if (!audioUrl) {
    throw inputError("ALIBABA_EMO_AUDIO_URL_INVALID", "Alibaba EMO audio URL must use HTTPS");
  }
  if (input.portraitUrl === null) {
    throw inputError("ALIBABA_EMO_PORTRAIT_URL_REQUIRED", "Alibaba EMO portrait URL is required");
  }
  const portraitUrl = httpsUrl(input.portraitUrl);
  if (!portraitUrl) {
    throw inputError("ALIBABA_EMO_PORTRAIT_URL_INVALID", "Alibaba EMO portrait URL must use HTTPS");
  }

  validateAudioMetadata(input.audioMetadata);
  validatePortraitMetadata(input.portraitMetadata);
  return { audioUrl, portraitUrl };
}

function validateAudioMetadata(metadata: VideoAssetMetadata | undefined): void {
  if (!metadata) {
    throw inputError("ALIBABA_EMO_AUDIO_METADATA_REQUIRED", "Alibaba EMO audio metadata is required");
  }
  if (!AUDIO_CONTENT_TYPES.has(contentType(metadata.contentType))) {
    throw inputError("ALIBABA_EMO_AUDIO_FORMAT_UNSUPPORTED", "Alibaba EMO audio format is unsupported");
  }
  if (!validByteLength(metadata.byteLength)) {
    throw inputError("ALIBABA_EMO_AUDIO_METADATA_INVALID", "Alibaba EMO audio metadata is invalid");
  }
  if (metadata.byteLength > MAX_AUDIO_BYTES) {
    throw inputError("ALIBABA_EMO_AUDIO_TOO_LARGE", "Alibaba EMO audio exceeds 15 MiB");
  }
  if (metadata.durationSeconds !== undefined) {
    if (!Number.isFinite(metadata.durationSeconds) || metadata.durationSeconds <= 0) {
      throw inputError("ALIBABA_EMO_AUDIO_METADATA_INVALID", "Alibaba EMO audio metadata is invalid");
    }
    if (metadata.durationSeconds > MAX_AUDIO_SECONDS) {
      throw inputError("ALIBABA_EMO_AUDIO_TOO_LONG", "Alibaba EMO audio exceeds 60 seconds");
    }
  }
}

function validatePortraitMetadata(
  metadata: VideoAssetMetadata | null | undefined
): void {
  if (!metadata) {
    throw inputError("ALIBABA_EMO_PORTRAIT_METADATA_REQUIRED", "Alibaba EMO portrait metadata is required");
  }
  if (!PORTRAIT_CONTENT_TYPES.has(contentType(metadata.contentType))) {
    throw inputError("ALIBABA_EMO_PORTRAIT_FORMAT_UNSUPPORTED", "Alibaba EMO portrait format is unsupported");
  }
  if (!validByteLength(metadata.byteLength)) {
    throw inputError("ALIBABA_EMO_PORTRAIT_METADATA_INVALID", "Alibaba EMO portrait metadata is invalid");
  }
  if (!validDimension(metadata.width) || !validDimension(metadata.height)) {
    throw inputError("ALIBABA_EMO_PORTRAIT_DIMENSIONS_REQUIRED", "Alibaba EMO portrait dimensions are required");
  }
  const shortestSide = Math.min(metadata.width, metadata.height);
  const longestSide = Math.max(metadata.width, metadata.height);
  if (shortestSide < MIN_PORTRAIT_SIDE) {
    throw inputError("ALIBABA_EMO_PORTRAIT_TOO_SMALL", "Alibaba EMO portrait is too small");
  }
  if (longestSide > MAX_PORTRAIT_SIDE) {
    throw inputError("ALIBABA_EMO_PORTRAIT_TOO_LARGE", "Alibaba EMO portrait is too large");
  }
}

function contentType(value: string): string {
  return value.split(";", 1)[0].trim().toLowerCase();
}

function validByteLength(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validDimension(value: number | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function httpsUrl(value: string): string | null {
  try {
    const normalized = value.trim();
    const parsed = new URL(normalized);
    return parsed.protocol === "https:" && Boolean(parsed.hostname)
      ? normalized
      : null;
  } catch {
    return null;
  }
}

function inputError(code: string, message: string): MediaConfigurationError {
  return new MediaConfigurationError(message, { provider: "TONGYI", code });
}

function configurationError(
  model: ResolvedMediaModel,
  code: string,
  message: string
): MediaConfigurationError {
  return new MediaConfigurationError(message, { provider: model.providerType, code });
}

function providerError(code: string, traceId: string | null): MediaProviderError {
  return new MediaProviderError(
    "Alibaba EMO request failed",
    "TONGYI",
    code,
    code === "ALIBABA_EMO_UPSTREAM_FAILED" || code === "ALIBABA_EMO_RATE_LIMITED",
    traceId
  );
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}
