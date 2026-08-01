import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authenticateRenderActor } from "@/lib/security/renderRouteAuth";
import { parseCreateRenderRequest, parsePrewarmRenderRequest } from "@/lib/validators/digitalHumanRender";
import {
  ensureRenderForQuestion,
  getRenderForActor,
  loadPlaybackAsset,
  prewarmRenderQuestions,
  RenderRequestError
} from "./renderService";
import { parseBoundedRange } from "./renderApi";

type RouteContext = { params: Promise<{ renderId: string }> };
const maximumRangeBytes = 8 * 1024 * 1024;
const defaultPlaybackTimeoutMs = 15_000;

type RenderGetDependencies = {
  authenticate: typeof authenticateRenderActor;
  getRender: typeof getRenderForActor;
  loadPlayback: typeof loadPlaybackAsset;
  fetchUpstream: (url: string, init: RequestInit) => Promise<Response>;
  fetchTimeoutMs: number;
  streamTimeoutMs: number;
};

export function createRenderPostHandler(dependencies = {
  authenticate: authenticateRenderActor,
  ensure: ensureRenderForQuestion
}) {
  return async function POST(request: Request) {
    try {
      const actor = await dependencies.authenticate(request);
      if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      const input = parseCreateRenderRequest(await request.json());
      return NextResponse.json(await dependencies.ensure({ actor, ...input }), { status: 202 });
    } catch (error) {
      return renderRouteError(error);
    }
  };
}

export function createPrewarmPostHandler(dependencies = {
  authenticate: authenticateRenderActor,
  prewarm: prewarmRenderQuestions
}) {
  return async function POST(request: Request) {
    try {
      const actor = await dependencies.authenticate(request);
      if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      const input = parsePrewarmRenderRequest(await request.json());
      return NextResponse.json(await dependencies.prewarm({ actor, ...input }), { status: 202 });
    } catch (error) {
      return renderRouteError(error);
    }
  };
}

export function createRenderGetHandler(dependencies: RenderGetDependencies = {
  authenticate: authenticateRenderActor,
  getRender: getRenderForActor,
  loadPlayback: loadPlaybackAsset,
  fetchUpstream: (url: string, init: RequestInit) => fetch(url, init),
  fetchTimeoutMs: defaultPlaybackTimeoutMs,
  streamTimeoutMs: defaultPlaybackTimeoutMs
}) {
  return async function GET(request: Request, context: RouteContext) {
    try {
      const actor = await dependencies.authenticate(request);
      if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      const { renderId } = await context.params;
      const url = new URL(request.url);
      if (url.searchParams.get("playback") === "1") {
        const asset = await dependencies.loadPlayback(actor, renderId);
        const rangeHeader = request.headers.get("range");
        const range = rangeHeader ? parseBoundedRange(rangeHeader, asset.byteLength, maximumRangeBytes) : null;
        if (rangeHeader && !range) {
          return new NextResponse(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${asset.byteLength}`, "Cache-Control": "private, no-store" }
          });
        }
        const upstreamUrl = await asset.createUpstreamUrl();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), dependencies.fetchTimeoutMs);
        let upstream: Response;
        try {
          upstream = await dependencies.fetchUpstream(upstreamUrl, {
            headers: range ? { Range: `bytes=${range.start}-${range.end}` } : undefined,
            redirect: "error",
            signal: controller.signal
          });
          clearTimeout(timeout);
        } catch (error) {
          clearTimeout(timeout);
          throw error;
        }
        const expectedLength = range ? range.end - range.start + 1 : asset.byteLength;
        const contentLength = parseCanonicalLength(upstream.headers.get("content-length"));
        const rangeMatches = range
          ? matchesExactContentRange(upstream.headers.get("content-range"), range.start, range.end, asset.byteLength)
          : upstream.headers.get("content-range") === null;
        if (
          !upstream.ok || (range ? upstream.status !== 206 : upstream.status !== 200) ||
          upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "video/mp4" ||
          !upstream.body || !rangeMatches || contentLength !== expectedLength
        ) {
          await terminateUpstream(upstream.body, controller, "invalid playback response");
          throw new RenderRequestError("PLAYBACK_UPSTREAM_UNAVAILABLE", 502);
        }
        const body = exactLengthBody(
          upstream.body,
          expectedLength,
          controller,
          dependencies.streamTimeoutMs
        );
        const headers: Record<string, string> = {
          "Content-Type": "video/mp4",
          "Content-Length": String(expectedLength),
          "Cache-Control": "private, no-store",
          "Accept-Ranges": "bytes",
          "X-Content-Type-Options": "nosniff"
        };
        if (range) {
          headers["Content-Range"] = `bytes ${range.start}-${range.end}/${asset.byteLength}`;
        }
        return new NextResponse(body, { status: range ? 206 : 200, headers });
      }
      return NextResponse.json(await dependencies.getRender({
        actor,
        renderId,
        includeDiagnostics: url.searchParams.get("diagnostics") === "1"
      }));
    } catch (error) {
      return renderRouteError(error);
    }
  };
}

function parseCanonicalLength(value: string | null) {
  if (!value || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function matchesExactContentRange(value: string | null, start: number, end: number, total: number) {
  const match = /^bytes (0|[1-9]\d*)-(0|[1-9]\d*)\/(0|[1-9]\d*)$/.exec(value ?? "");
  if (!match) return false;
  return Number(match[1]) === start && Number(match[2]) === end && Number(match[3]) === total;
}

async function terminateUpstream(
  body: ReadableStream<Uint8Array> | null,
  controller: AbortController,
  reason: unknown
) {
  controller.abort();
  await body?.cancel(reason).catch(() => undefined);
}

function exactLengthBody(
  body: ReadableStream<Uint8Array>,
  expectedLength: number,
  controller: AbortController,
  timeoutMs: number
) {
  const reader = body.getReader();
  let streamedBytes = 0;
  let finished = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  function clearStreamTimeout() {
    if (timeout) clearTimeout(timeout);
    timeout = null;
  }

  function releaseReader() {
    try {
      reader.releaseLock();
    } catch {
      // A concurrent read may still be settling after cancellation.
    }
  }

  function fail(error: Error) {
    if (finished) return;
    finished = true;
    clearStreamTimeout();
    controller.abort();
    const cancellation = reader.cancel(error).catch(() => undefined);
    streamController?.error(error);
    void cancellation.finally(releaseReader);
  }

  return new ReadableStream<Uint8Array>({
    start(value) {
      streamController = value;
    },
    async pull(streamController) {
      if (finished) return;
      try {
        clearStreamTimeout();
        timeout = setTimeout(
          () => fail(new Error("Playback stream timeout")),
          timeoutMs
        );
        const result = await reader.read();
        clearStreamTimeout();
        if (finished) return;
        if (result.done) {
          if (streamedBytes !== expectedLength) {
            fail(new Error("Playback stream truncated"));
            return;
          }
          finished = true;
          clearStreamTimeout();
          releaseReader();
          streamController.close();
        } else {
          streamedBytes += result.value.byteLength;
          if (streamedBytes > expectedLength) {
            fail(new Error("Playback stream exceeded declared length"));
            return;
          }
          streamController.enqueue(result.value);
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Playback stream failed"));
      }
    },
    async cancel(reason) {
      if (finished) return;
      finished = true;
      clearStreamTimeout();
      controller.abort();
      await reader.cancel(reason).catch(() => undefined);
      releaseReader();
    }
  });
}

export function renderRouteError(error: unknown) {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (error instanceof RenderRequestError) {
    return NextResponse.json({ error: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: "Video render unavailable" }, { status: 503 });
}
