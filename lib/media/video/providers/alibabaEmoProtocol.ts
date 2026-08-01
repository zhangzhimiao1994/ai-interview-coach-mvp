import type { VideoQueryResult } from "@/lib/media/video/types";

const DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/api/v1";

export type EmoRatio = "1:1" | "3:4";
export type EmoStyleLevel = "normal" | "calm" | "active";
export type EmoBoundingBox = [number, number, number, number];

type EmoRequest = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: Record<string, unknown>;
};

export type EmoDetectionResult = {
  faceBbox: EmoBoundingBox | null;
  extBbox: EmoBoundingBox | null;
  traceId: string | null;
  safeErrorCode: string | null;
};

export type EmoSubmitResult = {
  upstreamTaskId: string | null;
  traceId: string | null;
  safeErrorCode: string | null;
};

export function buildEmoDetectionRequest(input: {
  portraitUrl: string;
  ratio: EmoRatio;
}): EmoRequest {
  return {
    url: `${DASHSCOPE_BASE_URL}/services/aigc/image2video/face-detect`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: {
      model: "emo-detect-v1",
      input: { image_url: input.portraitUrl },
      parameters: { ratio: input.ratio }
    }
  };
}

export function buildEmoSubmitRequest(input: {
  model: string;
  portraitUrl: string;
  audioUrl: string;
  faceBbox: EmoBoundingBox;
  extBbox: EmoBoundingBox;
  styleLevel: EmoStyleLevel;
}): EmoRequest {
  return {
    url: `${DASHSCOPE_BASE_URL}/services/aigc/image2video/video-synthesis`,
    method: "POST",
    headers: {
      "X-DashScope-Async": "enable",
      "Content-Type": "application/json"
    },
    body: {
      model: input.model,
      input: {
        image_url: input.portraitUrl,
        audio_url: input.audioUrl,
        face_bbox: input.faceBbox,
        ext_bbox: input.extBbox
      },
      parameters: { style_level: input.styleLevel }
    }
  };
}

export function buildEmoQueryRequest(taskId: string): EmoRequest {
  return {
    url: `${DASHSCOPE_BASE_URL}/tasks/${encodeURIComponent(taskId)}`,
    method: "GET",
    headers: {}
  };
}

export async function parseEmoDetectionResponse(
  response: Response
): Promise<EmoDetectionResult> {
  const parsed = await parseResponse(response);
  if (!response.ok) {
    return detectionFailure(
      parsed.traceId,
      safeHttpErrorCode(response.status, parsed.body)
    );
  }
  if (parsed.invalid) {
    return detectionFailure(parsed.traceId, "ALIBABA_EMO_RESPONSE_INVALID");
  }

  const output = record(parsed.body?.output);
  if (output?.check_pass === false) {
    return detectionFailure(parsed.traceId, "ALIBABA_EMO_PORTRAIT_REJECTED");
  }
  const faceBbox = boundingBox(output?.face_bbox);
  const extBbox = boundingBox(output?.ext_bbox);
  if (output?.check_pass !== true || !faceBbox || !extBbox) {
    return detectionFailure(
      parsed.traceId,
      "ALIBABA_EMO_DETECTION_INVALID_RESPONSE"
    );
  }

  return { faceBbox, extBbox, traceId: parsed.traceId, safeErrorCode: null };
}

export async function parseEmoSubmitResponse(
  response: Response
): Promise<EmoSubmitResult> {
  const parsed = await parseResponse(response);
  if (!response.ok) {
    return submitFailure(
      parsed.traceId,
      safeHttpErrorCode(response.status, parsed.body)
    );
  }
  if (parsed.invalid) {
    return submitFailure(parsed.traceId, "ALIBABA_EMO_RESPONSE_INVALID");
  }

  const upstreamTaskId = text(record(parsed.body?.output)?.task_id);
  return upstreamTaskId
    ? { upstreamTaskId, traceId: parsed.traceId, safeErrorCode: null }
    : submitFailure(parsed.traceId, "ALIBABA_EMO_SUBMIT_INVALID_RESPONSE");
}

export async function parseEmoQueryResponse(
  response: Response
): Promise<VideoQueryResult> {
  const parsed = await parseResponse(response);
  if (!response.ok) {
    return queryFailure(
      parsed.traceId,
      safeHttpErrorCode(response.status, parsed.body),
      null
    );
  }
  if (parsed.invalid) {
    return queryFailure(parsed.traceId, "ALIBABA_EMO_RESPONSE_INVALID", null);
  }

  const output = record(parsed.body?.output);
  const status = text(output?.task_status)?.toUpperCase();
  if (status === "PENDING" || status === "RUNNING") {
    return {
      status,
      videoUrl: null,
      safeErrorCode: null,
      traceId: parsed.traceId,
      completedAt: null
    };
  }

  const completedAt = completionTime(output?.end_time);
  if (status === "SUCCEEDED") {
    const videoUrl = text(record(output?.results)?.video_url);
    return videoUrl
      ? {
        status: "SUCCEEDED",
        videoUrl,
        safeErrorCode: null,
        traceId: parsed.traceId,
        completedAt
      }
      : queryFailure(
        parsed.traceId,
        "ALIBABA_EMO_VIDEO_URL_MISSING",
        completedAt
      );
  }
  if (status === "FAILED") {
    return queryFailure(parsed.traceId, "ALIBABA_EMO_RENDER_FAILED", completedAt);
  }
  if (status === "CANCELED") {
    return queryFailure(parsed.traceId, "ALIBABA_EMO_TASK_CANCELED", completedAt);
  }
  if (status === "UNKNOWN") {
    return queryFailure(parsed.traceId, "ALIBABA_EMO_TASK_UNKNOWN", completedAt);
  }
  return queryFailure(parsed.traceId, "ALIBABA_EMO_STATUS_UNKNOWN", completedAt);
}

async function parseResponse(response: Response): Promise<{
  body: Record<string, unknown> | null;
  traceId: string | null;
  invalid: boolean;
}> {
  const headerTraceId = text(response.headers.get("x-request-id"));
  try {
    const body = record(await response.json());
    if (!body) {
      return { body: null, traceId: headerTraceId, invalid: true };
    }
    return {
      body,
      traceId: text(body.request_id) ?? headerTraceId,
      invalid: false
    };
  } catch {
    return { body: null, traceId: headerTraceId, invalid: true };
  }
}

function safeHttpErrorCode(
  status: number,
  body: Record<string, unknown> | null
): string {
  const upstreamCode = text(body?.code)?.toLowerCase() ?? "";
  if (
    status === 401 ||
    status === 403 ||
    /auth|apikey|api_key|unauthorized|forbidden/.test(upstreamCode)
  ) {
    return "ALIBABA_EMO_AUTH_FAILED";
  }
  if (status === 429 || /throttl|ratelimit|rate_limit/.test(upstreamCode)) {
    return "ALIBABA_EMO_RATE_LIMITED";
  }
  if (status >= 400 && status < 500) {
    return "ALIBABA_EMO_REQUEST_REJECTED";
  }
  return "ALIBABA_EMO_UPSTREAM_FAILED";
}

function boundingBox(value: unknown): EmoBoundingBox | null {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every((coordinate) =>
      typeof coordinate === "number" &&
      Number.isSafeInteger(coordinate) &&
      coordinate >= 0
    ) ||
    value[2] <= value[0] ||
    value[3] <= value[1]
  ) {
    return null;
  }
  return [value[0], value[1], value[2], value[3]];
}

function completionTime(value: unknown): Date | null {
  const timestamp = text(value);
  const match = timestamp?.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/
  );
  if (!match) return null;

  const [, year, month, day, hour, minute, second, fraction] = match;
  const localCalendar = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number((fraction ?? "").padEnd(3, "0"))
  ));
  if (
    localCalendar.getUTCFullYear() !== Number(year) ||
    localCalendar.getUTCMonth() !== Number(month) - 1 ||
    localCalendar.getUTCDate() !== Number(day) ||
    localCalendar.getUTCHours() !== Number(hour) ||
    localCalendar.getUTCMinutes() !== Number(minute) ||
    localCalendar.getUTCSeconds() !== Number(second)
  ) {
    return null;
  }

  return new Date(localCalendar.getTime() - 8 * 60 * 60 * 1000);
}

function detectionFailure(
  traceId: string | null,
  safeErrorCode: string
): EmoDetectionResult {
  return { faceBbox: null, extBbox: null, traceId, safeErrorCode };
}

function submitFailure(
  traceId: string | null,
  safeErrorCode: string
): EmoSubmitResult {
  return { upstreamTaskId: null, traceId, safeErrorCode };
}

function queryFailure(
  traceId: string | null,
  safeErrorCode: string,
  completedAt: Date | null
): VideoQueryResult {
  return {
    status: "FAILED",
    videoUrl: null,
    safeErrorCode,
    traceId,
    completedAt
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}
