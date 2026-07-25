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
  SpeechPcmStreamResult,
  SpeechSynthesisInput,
  SpeechSynthesisResult,
  StreamingTextToSpeechProvider
} from "@/lib/media/types";

const COSYVOICE_MODELS = new Set([
  "cosyvoice-v3.5-plus",
  "cosyvoice-v3.5-flash",
  "cosyvoice-v3-plus",
  "cosyvoice-v3-flash",
  "cosyvoice-v2"
]);
const QWEN_AUDIO_TTS_MODELS = new Set(["qwen-audio-3.0-tts-flash"]);
const DEFAULT_VOICE = "longanhuan";
const DEFAULT_QWEN_AUDIO_VOICE = "longanhuan_v3.6";
const DEFAULT_INSTRUCTION = "你说话的情感是 neutral.";
const DEFAULT_QWEN_AUDIO_INSTRUCTION = "语气自然、清晰，可以根据文本中的情绪标签自动表达情绪。";
const PCM_SAMPLE_RATE = 48_000 as const;
const MAX_PCM_CHUNK_BYTES = 1024 * 1024;
const MAX_PCM_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_BASE64_PCM_BYTES = Math.ceil(MAX_PCM_CHUNK_BYTES / 3) * 4;
const MAX_SSE_EVENT_BYTES = MAX_BASE64_PCM_BYTES + 64 * 1024;
const retryableStatuses = new Set([429, 500, 502, 503, 504]);
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const ttsInputSchema = z.object({
  text: z.string().trim().min(1).max(600),
  voice: z.string().trim().min(1).max(100),
  instruction: z.string().trim().min(1).max(1600),
  speed: z.number().finite().min(0.5).max(2)
});

type AlibabaTtsUrlInput = {
  workspaceId: string;
  region: AlibabaRealtimeRegion | string;
};

export type AlibabaTtsDependencies = {
  fetch: typeof fetch;
  readConfigSecret: () => string;
};

function textSetting(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function providerErrorForStatus(status: number) {
  return new MediaProviderError(
    "Alibaba TTS request failed",
    "TONGYI",
    `ALIBABA_TTS_HTTP_${status}`,
    retryableStatuses.has(status)
  );
}

function providerError(code: string, retryable = false) {
  return new MediaProviderError(
    "Alibaba TTS streaming response is invalid",
    "TONGYI",
    code,
    retryable
  );
}

function decodedBase64ByteLength(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function decodePcmBase64(value: unknown, totalBytes: number) {
  if (typeof value !== "string" || !value) {
    throw providerError("ALIBABA_TTS_PCM_BASE64_INVALID");
  }

  if (value.length > MAX_BASE64_PCM_BYTES) {
    throw providerError("ALIBABA_TTS_PCM_CHUNK_TOO_LARGE");
  }

  if (!base64Pattern.test(value)) {
    throw providerError("ALIBABA_TTS_PCM_BASE64_INVALID");
  }

  if (totalBytes + decodedBase64ByteLength(value) > MAX_PCM_TOTAL_BYTES) {
    throw providerError("ALIBABA_TTS_PCM_TOTAL_TOO_LARGE");
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw providerError("ALIBABA_TTS_PCM_BASE64_INVALID");
  }

  if (decoded.byteLength % 2 !== 0) {
    throw providerError("ALIBABA_TTS_PCM_INVALID");
  }

  if (decoded.byteLength > MAX_PCM_CHUNK_BYTES) {
    throw providerError("ALIBABA_TTS_PCM_CHUNK_TOO_LARGE");
  }

  return Uint8Array.from(decoded);
}

function assertSseEventSize(value: string) {
  if (Buffer.byteLength(value, "utf8") > MAX_SSE_EVENT_BYTES) {
    throw providerError("ALIBABA_TTS_SSE_EVENT_TOO_LARGE");
  }
}

function parseSseData(frame: string) {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!data || data === "[DONE]") {
    return null;
  }

  try {
    return JSON.parse(data) as {
      request_id?: unknown;
      output?: {
        type?: unknown;
        finish_reason?: unknown;
        audio?: { data?: unknown };
      };
    };
  } catch {
    throw providerError("ALIBABA_TTS_SSE_INVALID");
  }
}

export function validateAlibabaHttpTtsModelName(modelName: string): string {
  const normalized = modelName.trim();
  if (!COSYVOICE_MODELS.has(normalized) && !QWEN_AUDIO_TTS_MODELS.has(normalized)) {
    throw new MediaConfigurationError(
      "The selected speech pipeline supports only adapted Alibaba TTS models.",
      { code: "ALIBABA_TTS_MODEL_INVALID" }
    );
  }
  return normalized;
}

export function buildAlibabaTtsUrl({
  workspaceId,
  region
}: AlibabaTtsUrlInput): string {
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

  return `https://${workspaceId}.${region}.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`;
}

export function buildAlibabaTtsRequestBody(
  model: ResolvedMediaModel,
  input: SpeechSynthesisInput
) {
  const modelName = validateAlibabaHttpTtsModelName(model.modelName);
  const isQwenAudioTts = QWEN_AUDIO_TTS_MODELS.has(modelName);
  const inputResult = ttsInputSchema.safeParse({
    text: input.text,
    voice:
      textSetting(input.voice) ||
      textSetting(model.modelSettings.voice) ||
      (isQwenAudioTts ? DEFAULT_QWEN_AUDIO_VOICE : DEFAULT_VOICE),
    instruction:
      textSetting(input.instructions) ||
      textSetting(model.modelSettings.instruction) ||
      textSetting(model.modelSettings.instructions) ||
      (isQwenAudioTts ? DEFAULT_QWEN_AUDIO_INSTRUCTION : DEFAULT_INSTRUCTION),
    speed: input.speed ?? 1
  });

  if (!inputResult.success) {
    throw new MediaConfigurationError("Alibaba TTS input is invalid", {
      provider: model.providerType,
      code: "ALIBABA_TTS_INPUT_INVALID"
    });
  }

  return {
    model: modelName,
    input: {
      text: inputResult.data.text,
      voice: inputResult.data.voice,
      format: "pcm",
      sample_rate: PCM_SAMPLE_RATE,
      rate: inputResult.data.speed,
      instruction: inputResult.data.instruction
    }
  };
}

export function createAlibabaTtsProvider(
  model: ResolvedMediaModel,
  dependencyOverrides: Partial<AlibabaTtsDependencies> = {}
): StreamingTextToSpeechProvider {
  const deps: AlibabaTtsDependencies = {
    fetch,
    readConfigSecret: readAiConfigSecret,
    ...dependencyOverrides
  };

  async function streamPcm(
    input: SpeechSynthesisInput
  ): Promise<SpeechPcmStreamResult> {
    const body = buildAlibabaTtsRequestBody(model, input);
    const modelName = body.model;
    const credentials = resolveAlibabaTtsCredentials(
      model,
      deps.readConfigSecret
    );
    const endpoint = buildAlibabaTtsUrl(credentials);

    let response: Response | undefined;
    let streamController: AbortController | undefined;
    let streamTimeout: ReturnType<typeof setTimeout> | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), model.timeoutMs);
      try {
        response = await deps.fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credentials.apiKey}`,
            "Content-Type": "application/json",
            "X-DashScope-SSE": "enable"
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } catch {
        clearTimeout(timeout);
        throw new MediaProviderError(
          "Alibaba TTS request could not be completed",
          "TONGYI",
          controller.signal.aborted
            ? "ALIBABA_TTS_TIMEOUT"
            : "ALIBABA_TTS_NETWORK_ERROR",
          true
        );
      }

      if (response.ok) {
        streamController = controller;
        streamTimeout = timeout;
        break;
      }

      clearTimeout(timeout);

      if (attempt === 0 && retryableStatuses.has(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        response = undefined;
        continue;
      }

      throw providerErrorForStatus(response.status);
    }

    if (!response?.body) {
      if (streamTimeout) clearTimeout(streamTimeout);
      streamController?.abort();
      await response?.body?.cancel().catch(() => undefined);
      throw providerError("ALIBABA_TTS_RESPONSE_INVALID");
    }

    const result: SpeechPcmStreamResult = {
      provider: model.providerName,
      model: modelName,
      mode: "ALIBABA_TTS",
      traceId: response.headers.get("x-dashscope-request-id") ?? "unknown",
      fallbackUsed: false,
      encoding: "pcm_s16le",
      sampleRate: PCM_SAMPLE_RATE,
      channels: 1,
      chunks: undefined as unknown as AsyncIterable<Uint8Array>
    };

    result.chunks = (async function* () {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      let totalBytes = 0;
      let stopReceived = false;
      let finished = false;

      try {
        while (true) {
          const read = await reader.read();
          if (read.done) break;
          buffered += decoder.decode(read.value, { stream: true });
          buffered = buffered.replace(/\r\n/g, "\n");

          let boundary: number;
          while ((boundary = buffered.indexOf("\n\n")) >= 0) {
            const frame = buffered.slice(0, boundary);
            buffered = buffered.slice(boundary + 2);
            assertSseEventSize(frame);
            const event = parseSseData(frame);
            if (!event) continue;

            if (stopReceived) {
              throw providerError("ALIBABA_TTS_STREAM_AFTER_STOP");
            }

            if (typeof event.request_id === "string" && event.request_id.trim()) {
              result.traceId = event.request_id.trim();
            }

            if (event.output?.finish_reason === "stop") {
              stopReceived = true;
              continue;
            }

            if (event.output?.type !== "sentence-synthesis") continue;
            const pcm = decodePcmBase64(event.output.audio?.data, totalBytes);
            totalBytes += pcm.byteLength;
            if (totalBytes > MAX_PCM_TOTAL_BYTES) {
              throw providerError("ALIBABA_TTS_PCM_TOTAL_TOO_LARGE");
            }
            yield pcm;
          }
          assertSseEventSize(buffered);
        }

        buffered += decoder.decode();
        assertSseEventSize(buffered);
        if (buffered.trim()) {
          throw providerError("ALIBABA_TTS_SSE_INVALID");
        }
        if (!stopReceived) {
          throw providerError("ALIBABA_TTS_STREAM_INCOMPLETE");
        }
        finished = true;
      } catch (error) {
        if (streamController?.signal.aborted) {
          throw new MediaProviderError(
            "Alibaba TTS request timed out",
            "TONGYI",
            "ALIBABA_TTS_TIMEOUT",
            true
          );
        }
        if (error instanceof MediaProviderError) throw error;
        throw new MediaProviderError(
          "Alibaba TTS stream was interrupted",
          "TONGYI",
          "ALIBABA_TTS_STREAM_INTERRUPTED",
          true
        );
      } finally {
        if (streamTimeout) clearTimeout(streamTimeout);
        if (!finished) {
          await reader.cancel().catch(() => undefined);
        }
        reader.releaseLock();
      }
    })();

    return result;
  }

  return {
    streamPcm,
    async synthesize(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult> {
      const streamed = await streamPcm(input);
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      for await (const chunk of streamed.chunks) {
        chunks.push(chunk);
        totalBytes += chunk.byteLength;
      }
      const pcm = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        pcm.set(chunk, offset);
        offset += chunk.byteLength;
      }

      return {
        provider: streamed.provider,
        model: streamed.model,
        mode: streamed.mode,
        traceId: streamed.traceId,
        fallbackUsed: false,
        audioBase64: Buffer.from(pcm).toString("base64"),
        mimeType: "audio/pcm",
        sampleRate: PCM_SAMPLE_RATE
      };
    },
    async checkConnection() {
      const modelName = validateAlibabaHttpTtsModelName(model.modelName);
      resolveAlibabaTtsCredentials(model, deps.readConfigSecret);
      return {
        provider: model.providerName,
        model: modelName,
        mode: "ALIBABA_TTS",
        traceId: "local-configuration-check",
        fallbackUsed: false,
        available: true,
        latencyMs: 0,
        checkedAt: new Date().toISOString()
      };
    }
  };
}
