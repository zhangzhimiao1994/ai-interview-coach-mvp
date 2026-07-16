import { z } from "zod";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import type { ResolvedMediaModel } from "@/lib/media/config";
import {
  isAlibabaRegion,
  isAlibabaWorkspaceId,
  resolveAlibabaTtsCredentials,
  type AlibabaRealtimeRegion
} from "@/lib/media/providers/alibabaCredentials";
import {
  MediaConfigurationError,
  MediaProviderError
} from "@/lib/media/errors";
import type {
  SpeechSynthesisInput,
  SpeechSynthesisResult
} from "@/lib/media/types";

const retryableStatuses = new Set([429, 500, 502, 503, 504]);
const ttsInputSchema = z.object({
  text: z.string().trim().min(1).max(600),
  voice: z.string().trim().min(1).max(100),
  instructions: z.string().trim().min(1).max(1600).optional()
});
const alibabaTtsResponseSchema = z
  .object({
    status_code: z.number().int().optional(),
    request_id: z.string().trim().min(1).max(200),
    output: z
      .object({
        audio: z
          .object({
            url: z.string().trim().min(1).max(16_000),
            expires_at: z.number().int().positive()
          })
          .passthrough()
      })
      .passthrough()
  })
  .passthrough();

type AlibabaTtsUrlInput = {
  workspaceId: string;
  region: AlibabaRealtimeRegion | string;
};

type AlibabaTtsDependencies = {
  fetch: typeof fetch;
  readConfigSecret: () => string;
};

const languageTypes: Record<string, string> = {
  zh: "Chinese",
  en: "English",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  es: "Spanish",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  ru: "Russian"
};

function textSetting(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function languageType(language: string | undefined) {
  const normalized = language?.trim().toLowerCase() || "zh-cn";
  return languageTypes[normalized.split("-")[0]] ?? "Auto";
}

export function validateAlibabaHttpTtsModelName(modelName: string) {
  const normalized = modelName.trim();

  if (!normalized || normalized.length > 200) {
    throw new MediaConfigurationError("Alibaba TTS model name is invalid", {
      code: "ALIBABA_TTS_MODEL_INVALID"
    });
  }

  if (/(?:^|-)realtime(?:-|$)/i.test(normalized)) {
    throw new MediaConfigurationError(
      "The selected Alibaba TTS model requires WebSocket transport",
      { code: "ALIBABA_TTS_HTTP_MODEL_REQUIRED" }
    );
  }

  if (!/^qwen3-tts-(?:flash|instruct-flash)(?:-\d{4}-\d{2}-\d{2})?$/i.test(normalized)) {
    throw new MediaConfigurationError("Alibaba TTS model name is invalid", {
      code: "ALIBABA_TTS_MODEL_INVALID"
    });
  }

  return normalized;
}

function playableAudioUrl(value: string) {
  try {
    const url = new URL(value);
    const trustedHost =
      url.hostname === "aliyuncs.com" || url.hostname.endsWith(".aliyuncs.com");

    if (!trustedHost || (url.protocol !== "http:" && url.protocol !== "https:")) {
      throw new Error("Unsupported audio URL");
    }

    url.protocol = "https:";
    return url.toString();
  } catch {
    throw new MediaProviderError(
      "Alibaba TTS returned an invalid audio URL",
      "TONGYI",
      "ALIBABA_TTS_AUDIO_URL_INVALID"
    );
  }
}

function providerErrorForStatus(status: number) {
  return new MediaProviderError(
    "Alibaba TTS request failed",
    "TONGYI",
    `ALIBABA_TTS_HTTP_${status}`,
    retryableStatuses.has(status)
  );
}

export function buildAlibabaTtsUrl({
  workspaceId,
  region
}: AlibabaTtsUrlInput) {
  if (!isAlibabaWorkspaceId(workspaceId)) {
    throw new MediaConfigurationError("Alibaba workspace ID is invalid", {
      code: "ALIBABA_WORKSPACE_INVALID"
    });
  }

  if (!isAlibabaRegion(region)) {
    throw new MediaConfigurationError("Alibaba TTS region is invalid", {
      code: "ALIBABA_REGION_INVALID"
    });
  }

  return `https://${workspaceId}.${region}.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`;
}

export function createAlibabaTtsProvider(
  model: ResolvedMediaModel,
  dependencyOverrides: Partial<AlibabaTtsDependencies> = {}
) {
  const deps: AlibabaTtsDependencies = {
    fetch,
    readConfigSecret: readAiConfigSecret,
    ...dependencyOverrides
  };

  return {
    async synthesize(
      input: SpeechSynthesisInput
    ): Promise<SpeechSynthesisResult> {
      const modelName = validateAlibabaHttpTtsModelName(model.modelName);
      const voice =
        textSetting(input.voice) ||
        textSetting(model.modelSettings.voice) ||
        "Cherry";
      const supportsInstructions = /(?:^|-)instruct(?:-|$)/i.test(modelName);
      const configuredInstructions =
        textSetting(input.instructions) ||
        textSetting(model.modelSettings.instructions);
      const inputResult = ttsInputSchema.safeParse({
        text: input.text,
        voice,
        ...(supportsInstructions && configuredInstructions
          ? { instructions: configuredInstructions }
          : {})
      });

      if (!inputResult.success) {
        throw new MediaConfigurationError("Alibaba TTS input is invalid", {
          provider: model.providerType,
          code: "ALIBABA_TTS_INPUT_INVALID"
        });
      }

      const credentials = resolveAlibabaTtsCredentials(
        model,
        deps.readConfigSecret
      );
      const endpoint = buildAlibabaTtsUrl(credentials);
      const body = {
        model: modelName,
        input: {
          text: inputResult.data.text,
          voice: inputResult.data.voice,
          language_type: languageType(input.language),
          ...(inputResult.data.instructions
            ? { instructions: inputResult.data.instructions }
            : {})
        }
      };

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), model.timeoutMs);
        let response: Response;

        try {
          response = await deps.fetch(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${credentials.apiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(body),
            signal: controller.signal
          });
        } catch {
          throw new MediaProviderError(
            "Alibaba TTS request could not be completed",
            "TONGYI",
            controller.signal.aborted
              ? "ALIBABA_TTS_TIMEOUT"
              : "ALIBABA_TTS_NETWORK_ERROR",
            true
          );
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          if (attempt === 0 && retryableStatuses.has(response.status)) {
            await response.body?.cancel().catch(() => undefined);
            continue;
          }

          throw providerErrorForStatus(response.status);
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new MediaProviderError(
            "Alibaba TTS returned invalid JSON",
            "TONGYI",
            "ALIBABA_TTS_RESPONSE_INVALID"
          );
        }

        const parsed = alibabaTtsResponseSchema.safeParse(payload);
        if (!parsed.success || (parsed.data.status_code ?? 200) !== 200) {
          throw new MediaProviderError(
            "Alibaba TTS returned an invalid response",
            "TONGYI",
            "ALIBABA_TTS_RESPONSE_INVALID"
          );
        }

        return {
          provider: model.providerName,
          model: modelName,
          mode: "ALIBABA_TTS",
          traceId: parsed.data.request_id,
          fallbackUsed: false,
          audioUrl: playableAudioUrl(parsed.data.output.audio.url),
          mimeType: "audio/wav",
          expiresAt: new Date(
            parsed.data.output.audio.expires_at * 1000
          ).toISOString()
        };
      }

      throw new MediaProviderError(
        "Alibaba TTS retry limit reached",
        "TONGYI",
        "ALIBABA_TTS_RETRY_EXHAUSTED",
        true
      );
    }
  };
}
