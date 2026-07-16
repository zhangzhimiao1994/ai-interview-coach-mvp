import { z } from "zod";
import {
  isAlibabaRegion,
  isAlibabaWorkspaceId,
  type AlibabaRealtimeRegion
} from "@/lib/media/providers/alibabaCredentials";
import type { ResolvedMediaModel } from "@/lib/media/config";
import { MediaConfigurationError } from "@/lib/media/errors";

const eventIdSchema = z.string().trim().min(1).max(128);
const languageSchema = z.enum([
  "zh",
  "yue",
  "en",
  "ja",
  "de",
  "ko",
  "ru",
  "fr",
  "pt",
  "ar",
  "it",
  "es",
  "hi",
  "id",
  "th",
  "tr",
  "uk",
  "vi",
  "cs",
  "da",
  "fil",
  "fi",
  "is",
  "ms",
  "no",
  "pl",
  "sv"
]);
const canonicalBase64Schema = z
  .string()
  .min(1)
  .max(128 * 1024)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);

const sessionUpdateSchema = z
  .object({
    event_id: eventIdSchema,
    type: z.literal("session.update"),
    session: z
      .object({
        input_audio_format: z.enum(["pcm", "opus"]),
        sample_rate: z.union([z.literal(8000), z.literal(16000)]),
        input_audio_transcription: z
          .object({ language: languageSchema.optional() })
          .strict()
          .optional(),
        turn_detection: z
          .object({
            type: z.literal("server_vad"),
            threshold: z.number().finite().min(-1).max(1).optional(),
            silence_duration_ms: z.number().int().min(200).max(6000).optional()
          })
          .strict()
          .nullable()
          .optional()
      })
      .strict()
  })
  .strict();

const appendAudioSchema = z
  .object({
    event_id: eventIdSchema,
    type: z.literal("input_audio_buffer.append"),
    audio: canonicalBase64Schema
  })
  .strict();

const commitAudioSchema = z
  .object({
    event_id: eventIdSchema,
    type: z.literal("input_audio_buffer.commit")
  })
  .strict();

const finishSessionSchema = z
  .object({
    event_id: eventIdSchema,
    type: z.literal("session.finish")
  })
  .strict();

const clientEventSchema = z.discriminatedUnion("type", [
  sessionUpdateSchema,
  appendAudioSchema,
  commitAudioSchema,
  finishSessionSchema
]);

const serverEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session.created") }).passthrough(),
  z.object({ type: z.literal("session.finished") }).passthrough(),
  z
    .object({
      type: z.literal("conversation.item.input_audio_transcription.text"),
      text: z.string().optional(),
      stash: z.string().optional()
    })
    .passthrough(),
  z
    .object({
      type: z.literal("conversation.item.input_audio_transcription.completed"),
      transcript: z.string()
    })
    .passthrough(),
  z
    .object({
      type: z.literal("error"),
      error: z
        .object({ code: z.unknown().optional() })
        .passthrough()
        .optional()
    })
    .passthrough(),
  z
    .object({
      type: z.literal("conversation.item.input_audio_transcription.failed"),
      error: z
        .object({ code: z.unknown().optional() })
        .passthrough()
        .optional()
    })
    .passthrough()
]);

export type AlibabaAsrClientEvent = z.infer<typeof clientEventSchema>;

export type ClientAsrEvent =
  | { type: "ready" }
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "finished" }
  | {
      type: "error";
      code: string;
      message: string;
      retryable: boolean;
    };

type AlibabaAsrUrlInput = {
  workspaceId: string;
  region: AlibabaRealtimeRegion | string;
  modelName: string;
};

export type AlibabaAsrAudioConfig = {
  encoding: "pcm";
  sampleRate: 8000 | 16000;
  channels: 1;
  language: z.infer<typeof languageSchema>;
};

const languageAliases: Record<string, z.infer<typeof languageSchema>> = {
  "zh-cn": "zh",
  "zh-cmn": "zh",
  "en-us": "en",
  "en-gb": "en",
  "ja-jp": "ja",
  "ko-kr": "ko"
};

function safeErrorCode(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value)
    ? value
    : "UPSTREAM_ASR_ERROR";
}

function retryableError(code: string) {
  return /rate.?limit|timeout|server.?error|service.?unavailable|internal.?error/i.test(
    code
  );
}

export function buildAlibabaAsrUrl({
  workspaceId,
  region,
  modelName
}: AlibabaAsrUrlInput) {
  if (!isAlibabaWorkspaceId(workspaceId)) {
    throw new MediaConfigurationError("Alibaba workspace ID is invalid", {
      code: "ALIBABA_WORKSPACE_INVALID"
    });
  }

  if (!isAlibabaRegion(region)) {
    throw new MediaConfigurationError("Alibaba realtime region is invalid", {
      code: "ALIBABA_REGION_INVALID"
    });
  }

  const normalizedModel = modelName.trim();
  if (!normalizedModel || normalizedModel.length > 200) {
    throw new MediaConfigurationError("Alibaba ASR model name is invalid", {
      code: "ALIBABA_ASR_MODEL_INVALID"
    });
  }

  const endpoint = new URL(
    `wss://${workspaceId}.${region}.maas.aliyuncs.com/api-ws/v1/realtime`
  );
  endpoint.searchParams.set("model", normalizedModel);
  return endpoint.toString();
}

export function resolveAlibabaAsrAudioConfig(
  model: ResolvedMediaModel
): AlibabaAsrAudioConfig {
  const encodingResult = z
    .literal("pcm")
    .safeParse(model.modelSettings.encoding);
  const sampleRateResult = z
    .union([z.literal(8000), z.literal(16000)])
    .safeParse(model.modelSettings.sampleRate);
  const configuredLanguage =
    typeof model.modelSettings.language === "string"
      ? model.modelSettings.language.trim()
      : "";
  const languageResult = languageSchema.safeParse(
    languageAliases[configuredLanguage.toLowerCase()] ?? configuredLanguage.toLowerCase()
  );

  if (!encodingResult.success) {
    throw new MediaConfigurationError("Alibaba ASR encoding is invalid", {
      provider: model.providerType,
      code: "ALIBABA_ASR_ENCODING_INVALID"
    });
  }

  if (!sampleRateResult.success) {
    throw new MediaConfigurationError("Alibaba ASR sample rate is invalid", {
      provider: model.providerType,
      code: "ALIBABA_ASR_SAMPLE_RATE_INVALID"
    });
  }

  if (!languageResult.success) {
    throw new MediaConfigurationError("Alibaba ASR language is invalid", {
      provider: model.providerType,
      code: "ALIBABA_ASR_LANGUAGE_INVALID"
    });
  }

  return {
    encoding: encodingResult.data,
    sampleRate: sampleRateResult.data,
    channels: 1,
    language: languageResult.data
  };
}

export function parseAlibabaAsrClientEvent(
  message: string
): AlibabaAsrClientEvent | null {
  try {
    const parsed: unknown = JSON.parse(message);
    const result = clientEventSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function parseAlibabaAsrEvent(message: string): ClientAsrEvent | null {
  try {
    const parsed: unknown = JSON.parse(message);
    const result = serverEventSchema.safeParse(parsed);

    if (!result.success) {
      return null;
    }

    const event = result.data;

    if (event.type === "session.created") {
      return { type: "ready" };
    }

    if (event.type === "session.finished") {
      return { type: "finished" };
    }

    if (event.type === "conversation.item.input_audio_transcription.text") {
      const text = event.text ?? "";
      const stash = event.stash ?? "";
      return text || stash ? { type: "partial", text: `${text}${stash}` } : null;
    }

    if (event.type === "conversation.item.input_audio_transcription.completed") {
      return { type: "final", text: event.transcript };
    }

    const code = safeErrorCode(event.error?.code);

    return {
      type: "error",
      code,
      message:
        event.type === "error"
          ? "语音识别服务返回错误。"
          : "语音识别失败，请重试。",
      retryable: retryableError(code)
    };
  } catch {
    return null;
  }
}
