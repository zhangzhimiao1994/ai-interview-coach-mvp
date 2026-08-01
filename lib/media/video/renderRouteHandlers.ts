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

export function createRenderGetHandler(dependencies = {
  authenticate: authenticateRenderActor,
  getRender: getRenderForActor,
  loadPlayback: loadPlaybackAsset,
  fetchUpstream: (url: string, init: RequestInit) => fetch(url, init)
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
        const timeout = setTimeout(() => controller.abort(), 5_000);
        let upstream: Response;
        try {
          upstream = await dependencies.fetchUpstream(upstreamUrl, {
            headers: range ? { Range: `bytes=${range.start}-${range.end}` } : undefined,
            redirect: "error",
            signal: controller.signal
          });
        } catch (error) {
          clearTimeout(timeout);
          throw error;
        }
        if (
          !upstream.ok || (range ? upstream.status !== 206 : upstream.status !== 200) ||
          upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "video/mp4" ||
          !upstream.body
        ) {
          clearTimeout(timeout);
          controller.abort();
          throw new RenderRequestError("PLAYBACK_UPSTREAM_UNAVAILABLE", 502);
        }
        const body = timeoutBoundBody(upstream.body, controller, timeout);
        const headers: Record<string, string> = {
          "Content-Type": "video/mp4",
          "Cache-Control": "private, no-store",
          "Accept-Ranges": "bytes",
          "X-Content-Type-Options": "nosniff"
        };
        if (range) {
          headers["Content-Range"] = `bytes ${range.start}-${range.end}/${asset.byteLength}`;
          headers["Content-Length"] = String(range.end - range.start + 1);
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

function timeoutBoundBody(body: ReadableStream<Uint8Array>, controller: AbortController, timeout: ReturnType<typeof setTimeout>) {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(streamController) {
      try {
        const result = await reader.read();
        if (result.done) {
          clearTimeout(timeout);
          streamController.close();
        } else {
          streamController.enqueue(result.value);
        }
      } catch (error) {
        clearTimeout(timeout);
        streamController.error(error);
      }
    },
    async cancel(reason) {
      clearTimeout(timeout);
      controller.abort();
      await reader.cancel(reason).catch(() => undefined);
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
