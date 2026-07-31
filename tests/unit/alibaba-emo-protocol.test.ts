import { describe, expect, it } from "vitest";
import {
  buildEmoDetectionRequest,
  buildEmoQueryRequest,
  buildEmoSubmitRequest,
  parseEmoDetectionResponse,
  parseEmoQueryResponse,
  parseEmoSubmitResponse
} from "@/lib/media/video/providers/alibabaEmoProtocol";

describe("Alibaba EMO protocol", () => {
  it("builds the documented synchronous portrait detection request", () => {
    const request = buildEmoDetectionRequest({
      portraitUrl: "https://signed.example/portrait.png",
      ratio: "1:1"
    });

    expect(request).toEqual({
      url: "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/face-detect",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: {
        model: "emo-detect-v1",
        input: { image_url: "https://signed.example/portrait.png" },
        parameters: { ratio: "1:1" }
      }
    });
    expect(request.headers).not.toHaveProperty("Authorization");
  });

  it("extracts valid bounding boxes from a passed portrait detection", async () => {
    await expect(parseEmoDetectionResponse(response({
      output: {
        check_pass: true,
        face_bbox: [302, 286, 610, 593],
        ext_bbox: [71, 9, 840, 778]
      },
      request_id: "trace-detect"
    }))).resolves.toEqual({
      faceBbox: [302, 286, 610, 593],
      extBbox: [71, 9, 840, 778],
      traceId: "trace-detect",
      safeErrorCode: null
    });
  });

  it("maps a rejected portrait to a safe detection result", async () => {
    await expect(parseEmoDetectionResponse(response({
      output: {
        check_pass: false,
        code: "FaceNotFound",
        message: "sensitive detail"
      },
      request_id: "trace-detect-rejected"
    }))).resolves.toEqual({
      faceBbox: null,
      extBbox: null,
      traceId: "trace-detect-rejected",
      safeErrorCode: "ALIBABA_EMO_PORTRAIT_REJECTED"
    });
  });

  it.each([
    { face_bbox: [302, 286, 610], ext_bbox: [71, 9, 840, 778] },
    { face_bbox: [302, 286, 200, 593], ext_bbox: [71, 9, 840, 778] },
    { face_bbox: [302, 286, 610, 593], ext_bbox: [-1, 9, 840, 778] },
    { face_bbox: [302, 286, 610, 593], ext_bbox: [71, 9, "840", 778] }
  ])("rejects malformed detection bounding boxes safely", async (output) => {
    await expect(parseEmoDetectionResponse(response({
      output: { check_pass: true, ...output },
      request_id: "trace-bbox-invalid"
    }))).resolves.toEqual({
      faceBbox: null,
      extBbox: null,
      traceId: "trace-bbox-invalid",
      safeErrorCode: "ALIBABA_EMO_DETECTION_INVALID_RESPONSE"
    });
  });

  it.each([
    [401, "ALIBABA_EMO_AUTH_FAILED"],
    [429, "ALIBABA_EMO_RATE_LIMITED"],
    [503, "ALIBABA_EMO_UPSTREAM_FAILED"]
  ] as const)("maps detection HTTP %i to a safe result", async (
    status,
    safeErrorCode
  ) => {
    await expect(parseEmoDetectionResponse(response({
      request_id: `trace-detect-${status}`,
      message: "sensitive upstream body"
    }, status))).resolves.toEqual({
      faceBbox: null,
      extBbox: null,
      traceId: `trace-detect-${status}`,
      safeErrorCode
    });
  });

  it("maps malformed detection JSON safely and preserves a header trace", async () => {
    await expect(parseEmoDetectionResponse(new Response("not-json signed-url", {
      status: 200,
      headers: { "x-request-id": "trace-malformed-detect" }
    }))).resolves.toEqual({
      faceBbox: null,
      extBbox: null,
      traceId: "trace-malformed-detect",
      safeErrorCode: "ALIBABA_EMO_RESPONSE_INVALID"
    });
  });

  it("builds the documented asynchronous video synthesis request", () => {
    const request = buildEmoSubmitRequest({
      model: "emo-v1",
      portraitUrl: "https://signed.example/portrait.png",
      audioUrl: "https://signed.example/audio.wav",
      faceBbox: [302, 286, 610, 593],
      extBbox: [71, 9, 840, 778],
      styleLevel: "active"
    });

    expect(request.url).toBe(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis"
    );
    expect(request.method).toBe("POST");
    expect(request.headers["X-DashScope-Async"]).toBe("enable");
    expect(request.headers["Content-Type"]).toBe("application/json");
    expect(request.headers).not.toHaveProperty("Authorization");
    expect(request.body).toEqual({
      model: "emo-v1",
      input: {
        image_url: "https://signed.example/portrait.png",
        audio_url: "https://signed.example/audio.wav",
        face_bbox: [302, 286, 610, 593],
        ext_bbox: [71, 9, 840, 778]
      },
      parameters: { style_level: "active" }
    });
  });

  it("builds the documented task query endpoint and safely encodes the task id", () => {
    const request = buildEmoQueryRequest("task/id with spaces");

    expect(request).toEqual({
      url: "https://dashscope.aliyuncs.com/api/v1/tasks/task%2Fid%20with%20spaces",
      method: "GET",
      headers: {}
    });
  });

  it("extracts the task id and trace from a successful submission Response", async () => {
    await expect(parseEmoSubmitResponse(response({
      output: { task_id: "task-01", task_status: "PENDING" },
      request_id: "trace-submit"
    }))).resolves.toEqual({
      upstreamTaskId: "task-01",
      traceId: "trace-submit",
      safeErrorCode: null
    });
  });

  it("maps a successful HTTP response with no task id to a safe submit error", async () => {
    await expect(parseEmoSubmitResponse(response({
      output: { task_status: "PENDING" },
      request_id: "trace-missing-task"
    }))).resolves.toEqual({
      upstreamTaskId: null,
      traceId: "trace-missing-task",
      safeErrorCode: "ALIBABA_EMO_SUBMIT_INVALID_RESPONSE"
    });
  });

  it.each([
    [401, { request_id: "trace-auth" }, "ALIBABA_EMO_AUTH_FAILED"],
    [403, { request_id: "trace-forbidden" }, "ALIBABA_EMO_AUTH_FAILED"],
    [429, { request_id: "trace-rate" }, "ALIBABA_EMO_RATE_LIMITED"],
    [400, { request_id: "trace-input", code: "InvalidParameter" }, "ALIBABA_EMO_REQUEST_REJECTED"],
    [503, { request_id: "trace-upstream" }, "ALIBABA_EMO_UPSTREAM_FAILED"]
  ] as const)("maps submit HTTP %i to %s without exposing the upstream body", async (
    status,
    body,
    safeErrorCode
  ) => {
    const parsed = await parseEmoSubmitResponse(response(body, status));

    expect(parsed).toEqual({
      upstreamTaskId: null,
      traceId: body.request_id,
      safeErrorCode
    });
    expect(JSON.stringify(parsed)).not.toContain("InvalidParameter");
  });

  it("maps malformed submit JSON to a safe error and preserves a header trace", async () => {
    const parsed = await parseEmoSubmitResponse(new Response("not-json signed-url-secret", {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-request-id": "trace-malformed-submit"
      }
    }));

    expect(parsed).toEqual({
      upstreamTaskId: null,
      traceId: "trace-malformed-submit",
      safeErrorCode: "ALIBABA_EMO_RESPONSE_INVALID"
    });
    expect(JSON.stringify(parsed)).not.toContain("signed-url-secret");
  });

  it.each([
    ["PENDING", "PENDING"],
    ["RUNNING", "RUNNING"]
  ] as const)("maps the documented %s task state to %s", async (
    upstreamStatus,
    status
  ) => {
    const parsed = await parseEmoQueryResponse(queryResponse(upstreamStatus));

    expect(parsed).toEqual({
      status,
      videoUrl: null,
      safeErrorCode: null,
      traceId: "trace-query",
      completedAt: null
    });
  });

  it("maps SUCCEEDED to the nested EMO result URL and deterministic UTC+8 end time", async () => {
    const parsed = await parseEmoQueryResponse(response({
      request_id: "trace-query",
      output: {
        task_id: "task-01",
        task_status: "SUCCEEDED",
        end_time: "2026-07-29 20:30:45.123",
        results: { video_url: "http://dashscope-result.example/video.mp4?signature" }
      }
    }));

    expect(parsed).toEqual({
      status: "SUCCEEDED",
      videoUrl: "http://dashscope-result.example/video.mp4?signature",
      safeErrorCode: null,
      traceId: "trace-query",
      completedAt: new Date("2026-07-29T12:30:45.123Z")
    });
  });

  it.each([
    ["FAILED", "ALIBABA_EMO_RENDER_FAILED"],
    ["CANCELED", "ALIBABA_EMO_TASK_CANCELED"],
    ["UNKNOWN", "ALIBABA_EMO_TASK_UNKNOWN"]
  ] as const)("maps the documented terminal %s state to %s", async (
    upstreamStatus,
    safeErrorCode
  ) => {
    const parsed = await parseEmoQueryResponse(queryResponse(upstreamStatus));

    expect(parsed).toMatchObject({
      status: "FAILED",
      videoUrl: null,
      safeErrorCode,
      traceId: "trace-query"
    });
  });

  it("fails safely when SUCCEEDED has no usable output URL", async () => {
    const parsed = await parseEmoQueryResponse(queryResponse("SUCCEEDED"));

    expect(parsed).toMatchObject({
      status: "FAILED",
      videoUrl: null,
      safeErrorCode: "ALIBABA_EMO_VIDEO_URL_MISSING",
      traceId: "trace-query"
    });
  });

  it("fails safely for an undocumented task status", async () => {
    const parsed = await parseEmoQueryResponse(queryResponse("PAUSED"));

    expect(parsed).toMatchObject({
      status: "FAILED",
      safeErrorCode: "ALIBABA_EMO_STATUS_UNKNOWN",
      traceId: "trace-query"
    });
  });

  it.each([
    [401, "ALIBABA_EMO_AUTH_FAILED"],
    [429, "ALIBABA_EMO_RATE_LIMITED"],
    [500, "ALIBABA_EMO_UPSTREAM_FAILED"]
  ] as const)("maps query HTTP %i to a safe failed result", async (
    status,
    safeErrorCode
  ) => {
    const parsed = await parseEmoQueryResponse(response({
      request_id: `trace-http-${status}`,
      message: "sensitive upstream body"
    }, status));

    expect(parsed).toEqual({
      status: "FAILED",
      videoUrl: null,
      safeErrorCode,
      traceId: `trace-http-${status}`,
      completedAt: null
    });
    expect(JSON.stringify(parsed)).not.toContain("sensitive upstream body");
  });

  it("maps malformed query JSON safely and preserves a header trace", async () => {
    const parsed = await parseEmoQueryResponse(new Response("not-json private-url", {
      status: 200,
      headers: { "x-request-id": "trace-malformed-query" }
    }));

    expect(parsed).toEqual({
      status: "FAILED",
      videoUrl: null,
      safeErrorCode: "ALIBABA_EMO_RESPONSE_INVALID",
      traceId: "trace-malformed-query",
      completedAt: null
    });
    expect(JSON.stringify(parsed)).not.toContain("private-url");
  });
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function queryResponse(taskStatus: string) {
  return response({
    request_id: "trace-query",
    output: {
      task_id: "task-01",
      task_status: taskStatus,
      end_time: "2026-07-29 20:30:45.123"
    }
  });
}
