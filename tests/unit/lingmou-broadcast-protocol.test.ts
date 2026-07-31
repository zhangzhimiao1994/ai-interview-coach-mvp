import { describe, expect, it } from "vitest";
import {
  buildLingmouCreateRequest,
  parseLingmouBroadcastSubmission,
  parseLingmouBroadcastVideo
} from "@/lib/media/video/providers/lingmouBroadcastProtocol";

const createInput = {
  name: "render-job-01",
  templateId: "template-01",
  audioVariableName: "audio",
  audioUrl: "https://signed.example/audio.wav",
  portraitVariableName: "portrait",
  portraitUrl: "https://signed.example/portrait.png",
  resolution: "1080p",
  fps: 25,
  watermark: false,
  mode: "standard"
} as const;

describe("Lingmou broadcast protocol", () => {
  it("builds the installed SDK request with audio and portrait template variables", () => {
    const request = buildLingmouCreateRequest(createInput);

    expect(request).toMatchObject({
      name: "render-job-01",
      templateId: "template-01",
      variables: [
        { name: "audio", type: "audio", properties: { url: createInput.audioUrl } },
        { name: "portrait", type: "image", properties: { url: createInput.portraitUrl } }
      ],
      videoOptions: {
        resolution: "1080p",
        fps: 25,
        watermark: false,
        mode: "standard"
      }
    });
  });

  it("omits the portrait variable only when the configured portrait variable is null", () => {
    const request = buildLingmouCreateRequest({
      ...createInput,
      portraitVariableName: null,
      portraitUrl: null
    });

    expect(request.variables).toEqual([
      expect.objectContaining({ name: "audio", type: "audio" })
    ]);
  });

  it("extracts a task id and trace id from a successful submission", () => {
    expect(parseLingmouBroadcastSubmission({
      body: {
        success: true,
        requestId: "trace-01",
        data: { id: "video-01" }
      }
    })).toEqual({ upstreamTaskId: "video-01", traceId: "trace-01" });
  });

  it.each([
    ["PENDING", "PENDING"],
    ["PROCESSING", "RUNNING"]
  ] as const)("maps %s to %s", (upstreamStatus, status) => {
    expect(parseLingmouBroadcastVideo(listResponse({ status: upstreamStatus }), "video-01"))
      .toMatchObject({ status, videoUrl: null, safeErrorCode: null });
  });

  it("maps a successful task to its video URL and completion time", () => {
    const result = parseLingmouBroadcastVideo(listResponse({
      status: "SUCCESS",
      videoURL: "https://render.example/video.mp4",
      modifiedTime: "2026-07-29T12:00:00Z"
    }), "video-01");

    expect(result).toMatchObject({
      status: "SUCCEEDED",
      videoUrl: "https://render.example/video.mp4",
      safeErrorCode: null,
      traceId: "trace-01"
    });
    expect(result.completedAt).toEqual(new Date("2026-07-29T12:00:00Z"));
  });

  it("turns provider failure into a safe failed result", () => {
    expect(parseLingmouBroadcastVideo(listResponse({ status: "FAILED" }), "video-01"))
      .toMatchObject({
        status: "FAILED",
        videoUrl: null,
        safeErrorCode: "LINGMOU_BROADCAST_RENDER_FAILED"
      });
  });

  it("fails safely when the requested task is absent", () => {
    expect(parseLingmouBroadcastVideo(listResponse({ id: "another-video" }), "video-01"))
      .toMatchObject({
        status: "FAILED",
        safeErrorCode: "LINGMOU_BROADCAST_TASK_NOT_FOUND"
      });
  });

  it("fails safely when a successful task has no usable video URL", () => {
    expect(parseLingmouBroadcastVideo(listResponse({ status: "SUCCESS" }), "video-01"))
      .toMatchObject({
        status: "FAILED",
        safeErrorCode: "LINGMOU_BROADCAST_VIDEO_URL_MISSING"
      });
  });

  it("selects only the requested task from a multi-id response", () => {
    const response = {
      body: {
        success: true,
        requestId: "trace-01",
        data: [
          { id: "other-video", status: "SUCCESS", videoURL: "https://render.example/other.mp4" },
          { id: "video-01", status: "PROCESSING" }
        ]
      }
    };

    expect(parseLingmouBroadcastVideo(response, "video-01")).toMatchObject({
      status: "RUNNING",
      videoUrl: null,
      safeErrorCode: null
    });
  });
});

function listResponse(video: Record<string, unknown>) {
  return {
    body: {
      success: true,
      requestId: "trace-01",
      data: [{ id: "video-01", ...video }]
    }
  };
}
