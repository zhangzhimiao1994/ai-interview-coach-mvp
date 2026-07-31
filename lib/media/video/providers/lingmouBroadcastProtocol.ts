import {
  CreateBroadcastVideoFromTemplateRequest,
  CreateBroadcastVideoFromTemplateRequestVideoOptions,
  TemplateVariable
} from "@alicloud/lingmou20250527";
import type { VideoQueryResult } from "@/lib/media/video/types";

export type LingmouCreateRequestInput = {
  name: string;
  templateId: string;
  audioVariableName: string;
  audioUrl: string;
  portraitVariableName: string | null;
  portraitUrl: string | null;
  resolution: string;
  fps: number;
  watermark: boolean;
  mode: string;
};

type LingmouResponse = {
  body?: {
    success?: boolean;
    requestId?: string;
    data?: unknown;
  };
};

export function buildLingmouCreateRequest(
  input: LingmouCreateRequestInput
): CreateBroadcastVideoFromTemplateRequest {
  const variables = [new TemplateVariable({
    name: input.audioVariableName,
    type: "audio",
    properties: { url: input.audioUrl }
  })];

  if (input.portraitVariableName && input.portraitUrl) {
    variables.push(new TemplateVariable({
      name: input.portraitVariableName,
      type: "image",
      properties: { url: input.portraitUrl }
    }));
  }

  return new CreateBroadcastVideoFromTemplateRequest({
    name: input.name,
    templateId: input.templateId,
    variables,
    videoOptions: new CreateBroadcastVideoFromTemplateRequestVideoOptions({
      resolution: input.resolution,
      fps: input.fps,
      watermark: input.watermark,
      mode: input.mode
    })
  });
}

export function parseLingmouBroadcastSubmission(
  response: LingmouResponse
): { upstreamTaskId: string | null; traceId: string | null } {
  const body = response.body;
  const task = record(body?.data);
  const upstreamTaskId = text(task?.id);

  if (body?.success !== true || !upstreamTaskId) {
    return { upstreamTaskId: null, traceId: text(body?.requestId) };
  }

  return { upstreamTaskId, traceId: text(body.requestId) };
}

export function parseLingmouBroadcastVideo(
  response: LingmouResponse,
  requestedTaskId: string
): VideoQueryResult {
  const body = response.body;
  const traceId = text(body?.requestId);
  const videos = Array.isArray(body?.data) ? body.data : [];
  const video = videos.map(record).find((item) => text(item?.id) === requestedTaskId);

  if (body?.success !== true || !video) {
    return failed(traceId, "LINGMOU_BROADCAST_TASK_NOT_FOUND", null);
  }

  const completedAt = completionTime(video.modifiedTime);
  const status = text(video.status)?.toUpperCase();

  if (status === "PENDING" || status === "QUEUED" || status === "CREATED") {
    return { status: "PENDING", videoUrl: null, safeErrorCode: null, traceId, completedAt: null };
  }

  if (["PROCESSING", "RUNNING", "CREATING", "RENDERING"].includes(status ?? "")) {
    return { status: "RUNNING", videoUrl: null, safeErrorCode: null, traceId, completedAt: null };
  }

  if (status === "SUCCESS" || status === "SUCCEEDED") {
    const videoUrl = text(video.videoURL);
    return videoUrl
      ? { status: "SUCCEEDED", videoUrl, safeErrorCode: null, traceId, completedAt }
      : failed(traceId, "LINGMOU_BROADCAST_VIDEO_URL_MISSING", completedAt);
  }

  if (["FAILED", "FAILURE", "ERROR", "CANCELED", "CANCELLED"].includes(status ?? "")) {
    return failed(traceId, "LINGMOU_BROADCAST_RENDER_FAILED", completedAt);
  }

  return failed(traceId, "LINGMOU_BROADCAST_STATUS_UNKNOWN", completedAt);
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

function completionTime(value: unknown): Date | null {
  const timestamp = text(value);
  const match = timestamp?.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/
  );
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second, fraction, timezone] = match;
  const milliseconds = Number((fraction ?? "").padEnd(3, "0").slice(0, 3));
  const calendar = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    milliseconds
  ));
  if (
    calendar.getUTCFullYear() !== Number(year) ||
    calendar.getUTCMonth() !== Number(month) - 1 ||
    calendar.getUTCDate() !== Number(day) ||
    calendar.getUTCHours() !== Number(hour) ||
    calendar.getUTCMinutes() !== Number(minute) ||
    calendar.getUTCSeconds() !== Number(second)
  ) {
    return null;
  }

  const normalizedTimestamp = match[0];
  const date = new Date(
    timezone ? normalizedTimestamp : `${normalizedTimestamp}Z`
  );
  return Number.isFinite(date.getTime()) ? date : null;
}

function failed(
  traceId: string | null,
  safeErrorCode: string,
  completedAt: Date | null
): VideoQueryResult {
  return { status: "FAILED", videoUrl: null, safeErrorCode, traceId, completedAt };
}
