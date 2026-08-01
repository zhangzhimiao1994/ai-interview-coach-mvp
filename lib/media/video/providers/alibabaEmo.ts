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
  timeoutMs: number;
};

export type AlibabaEmoDependencies = {
  fetcher: (
    input: string | URL | Request,
    init?: RequestInit
  ) => Promise<Response>;
  readConfigSecret: () => string;
  scheduleTimeout: (callback: () => void, delayMs: number) => unknown;
  cancelTimeout: (handle: unknown) => void;
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
  if (
    !Number.isFinite(model.timeoutMs) ||
    !Number.isInteger(model.timeoutMs) ||
    model.timeoutMs < 1_000 ||
    model.timeoutMs > 300_000
  ) {
    throw configurationError(
      model,
      "ALIBABA_EMO_TIMEOUT_INVALID",
      "Alibaba EMO timeout is invalid"
    );
  }

  return {
    apiKey,
    model: "emo-v1",
    ratio,
    styleLevel: styleLevel as EmoStyleLevel,
    timeoutMs: model.timeoutMs
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
  const scheduleTimeout = dependencyOverrides.scheduleTimeout ?? defaultScheduleTimeout;
  const cancelTimeout = dependencyOverrides.cancelTimeout ?? defaultCancelTimeout;

  return {
    async submit(input) {
      const validated = validateSubmitInput(input);
      const detectionRequest = buildEmoDetectionRequest({
        portraitUrl: validated.portraitUrl,
        ratio: config.ratio
      });
      const detection = await requestWithTimeout(
        fetcher,
        detectionRequest,
        config,
        scheduleTimeout,
        cancelTimeout,
        parseEmoDetectionResponse
      );
      if (detection.safeErrorCode || !detection.faceBbox || !detection.extBbox) {
        throw providerError(
          detection.safeErrorCode ?? "ALIBABA_EMO_DETECTION_INVALID_RESPONSE",
          detection.traceId
        );
      }
      if (!validDetectionGeometry(
        detection.faceBbox,
        detection.extBbox,
        validated.portraitWidth,
        validated.portraitHeight,
        config.ratio
      )) {
        throw providerError(
          "ALIBABA_EMO_DETECTION_GEOMETRY_INVALID",
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
      const submission = await requestWithTimeout(
        fetcher,
        submitRequest,
        config,
        scheduleTimeout,
        cancelTimeout,
        parseEmoSubmitResponse
      );
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
        return await requestWithTimeout(
          fetcher,
          request,
          config,
          scheduleTimeout,
          cancelTimeout,
          parseEmoQueryResponse
        );
      } catch (error) {
        return {
          status: "FAILED",
          videoUrl: null,
          safeErrorCode: error instanceof MediaProviderError &&
            error.code === "ALIBABA_EMO_TIMEOUT"
            ? "ALIBABA_EMO_TIMEOUT"
            : "ALIBABA_EMO_UPSTREAM_FAILED",
          traceId: null,
          completedAt: null
        };
      }
    }
  };
}

type EmoHttpRequest =
  | ReturnType<typeof buildEmoDetectionRequest>
  | ReturnType<typeof buildEmoSubmitRequest>
  | ReturnType<typeof buildEmoQueryRequest>;

async function requestWithTimeout<T>(
  fetcher: AlibabaEmoDependencies["fetcher"],
  request: EmoHttpRequest,
  config: AlibabaEmoConfiguration,
  scheduleTimeout: AlibabaEmoDependencies["scheduleTimeout"],
  cancelTimeout: AlibabaEmoDependencies["cancelTimeout"],
  parse: (response: Response) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let timer: unknown;
  let timerCreated = false;
  try {
    timer = scheduleTimeout(() => controller.abort(), config.timeoutMs);
    timerCreated = true;
    const response = await fetcher(request.url, {
      method: request.method,
      headers: {
        ...request.headers,
        Authorization: `Bearer ${config.apiKey}`
      },
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body) }),
      signal: controller.signal
    });
    return await parse(response);
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      throw providerError("ALIBABA_EMO_TIMEOUT", null);
    }
    throw providerError("ALIBABA_EMO_UPSTREAM_FAILED", null);
  } finally {
    if (timerCreated) cancelTimeout(timer);
  }
}

function validateSubmitInput(input: VideoSubmitInput): {
  audioUrl: string;
  portraitUrl: string;
  portraitWidth: number;
  portraitHeight: number;
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
  const portraitDimensions = validatePortraitMetadata(input.portraitMetadata);
  return {
    audioUrl,
    portraitUrl,
    portraitWidth: portraitDimensions.width,
    portraitHeight: portraitDimensions.height
  };
}

function validateAudioMetadata(metadata: VideoAssetMetadata | undefined): void {
  if (!metadata) {
    throw inputError("ALIBABA_EMO_AUDIO_METADATA_REQUIRED", "Alibaba EMO audio metadata is required");
  }
  const mediaType = contentType(metadata.contentType);
  if (!mediaType) {
    throw inputError("ALIBABA_EMO_AUDIO_METADATA_INVALID", "Alibaba EMO audio metadata is invalid");
  }
  if (!AUDIO_CONTENT_TYPES.has(mediaType)) {
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
): { width: number; height: number } {
  if (!metadata) {
    throw inputError("ALIBABA_EMO_PORTRAIT_METADATA_REQUIRED", "Alibaba EMO portrait metadata is required");
  }
  const mediaType = contentType(metadata.contentType);
  if (!mediaType) {
    throw inputError("ALIBABA_EMO_PORTRAIT_METADATA_INVALID", "Alibaba EMO portrait metadata is invalid");
  }
  if (!PORTRAIT_CONTENT_TYPES.has(mediaType)) {
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
  return { width: metadata.width, height: metadata.height };
}

function contentType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.split(";", 1)[0].trim().toLowerCase();
  return normalized || null;
}

function validDetectionGeometry(
  faceBbox: readonly [number, number, number, number],
  extBbox: readonly [number, number, number, number],
  portraitWidth: number,
  portraitHeight: number,
  ratio: EmoRatio
): boolean {
  if (
    !bboxWithinImage(faceBbox, portraitWidth, portraitHeight) ||
    !bboxWithinImage(extBbox, portraitWidth, portraitHeight) ||
    faceBbox[0] < extBbox[0] ||
    faceBbox[1] < extBbox[1] ||
    faceBbox[2] > extBbox[2] ||
    faceBbox[3] > extBbox[3]
  ) {
    return false;
  }

  const extWidth = extBbox[2] - extBbox[0];
  const extHeight = extBbox[3] - extBbox[1];
  const [targetWidth, targetHeight] = ratio === "1:1" ? [1, 1] : [3, 4];
  const crossProductDelta = Math.abs(
    extWidth * targetHeight - extHeight * targetWidth
  );

  // Detection coordinates are integer pixels. Permit at most one pixel of
  // rounding on either dimension while rejecting a materially wrong ratio.
  return crossProductDelta <= Math.max(targetWidth, targetHeight);
}

function bboxWithinImage(
  bbox: readonly [number, number, number, number],
  width: number,
  height: number
): boolean {
  return bbox.every(Number.isSafeInteger) &&
    bbox[0] >= 0 &&
    bbox[1] >= 0 &&
    bbox[2] > bbox[0] &&
    bbox[3] > bbox[1] &&
    bbox[2] <= width &&
    bbox[3] <= height;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : Boolean(
      error &&
      typeof error === "object" &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError"
    );
}

function defaultScheduleTimeout(callback: () => void, delayMs: number): unknown {
  return setTimeout(callback, delayMs);
}

function defaultCancelTimeout(handle: unknown): void {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
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
    code === "ALIBABA_EMO_UPSTREAM_FAILED" ||
      code === "ALIBABA_EMO_RATE_LIMITED" ||
      code === "ALIBABA_EMO_TIMEOUT",
    traceId
  );
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}
