import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import {
  DigitalHumanVideoDiagnosticInputError,
  runDigitalHumanVideoDiagnostic,
  sanitizeDigitalHumanVideoDiagnosticResult,
  type DigitalHumanVideoDiagnosticRequest,
  type DigitalHumanVideoDiagnosticResult
} from "@/lib/media/video/diagnostics";
import { adminSessionCookieName, verifyAdminSessionCookie } from "@/lib/security/adminSession";

const providerKindSchema = z.enum(["LINGMOU_BROADCAST", "ALIBABA_EMO"]);
const requestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("CONFIG"),
    providerKind: providerKindSchema.optional()
  }).strict(),
  z.object({
    mode: z.literal("PAID"),
    providerKind: providerKindSchema,
    confirmPaidRequest: z.literal(true)
  }).strict()
]);

export type DigitalHumanVideoDiagnosticsActor = {
  id: string;
  role: string;
};

export interface DigitalHumanVideoDiagnosticsRouteDependencies {
  authorizeAdmin: (
    request: Request
  ) => Promise<DigitalHumanVideoDiagnosticsActor | null>;
  runDiagnostic: (
    input: DigitalHumanVideoDiagnosticRequest,
    actorId: string
  ) => Promise<DigitalHumanVideoDiagnosticResult>;
  resolveExpectedOrigin: (request: Request) => readonly string[] | null;
}

export function createDigitalHumanVideoDiagnosticsHandler(
  dependencyOverrides: Partial<DigitalHumanVideoDiagnosticsRouteDependencies> = {}
) {
  const deps: DigitalHumanVideoDiagnosticsRouteDependencies = {
    authorizeAdmin: authorizeDefaultAdmin,
    runDiagnostic: (input, actorId) =>
      runDigitalHumanVideoDiagnostic(input, actorId),
    resolveExpectedOrigin: (request) =>
      resolveDigitalHumanDiagnosticsExpectedOrigin(request, process.env),
    ...dependencyOverrides
  };

  return async function handleDigitalHumanVideoDiagnostics(request: Request) {
    const actor = await deps.authorizeAdmin(request).catch(() => null);
    if (!actor) {
      return noStoreJson({ error: "Authentication required" }, 401);
    }
    if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
      return noStoreJson({ error: "Forbidden" }, 403);
    }
    if (!isSameOrigin(request, deps.resolveExpectedOrigin(request))) {
      return noStoreJson({ error: "CSRF validation failed" }, 403);
    }

    let input: DigitalHumanVideoDiagnosticRequest;
    try {
      input = requestSchema.parse(await request.json());
    } catch {
      return noStoreJson({ error: "Validation failed" }, 400);
    }

    try {
      const diagnostic = await deps.runDiagnostic(input, actor.id);
      return noStoreJson({ diagnostic: whitelistDiagnostic(diagnostic) }, 200);
    } catch (error) {
      if (error instanceof DigitalHumanVideoDiagnosticInputError) {
        return noStoreJson({ error: "Validation failed", code: error.code }, 400);
      }
      return noStoreJson({ error: "Internal server error" }, 500);
    }
  };
}

function whitelistDiagnostic(
  diagnostic: DigitalHumanVideoDiagnosticResult
): DigitalHumanVideoDiagnosticResult {
  return sanitizeDigitalHumanVideoDiagnosticResult(diagnostic);
}

function noStoreJson(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function isSameOrigin(request: Request, expectedOrigins: readonly string[] | null) {
  if (!expectedOrigins || expectedOrigins.length === 0) return false;
  const origin = request.headers.get("origin");
  if (origin) return expectedOrigins.includes(normalizedOrigin(origin));
  const referer = request.headers.get("referer");
  return referer ? expectedOrigins.includes(normalizedOrigin(referer)) : false;
}

export function resolveDigitalHumanDiagnosticsExpectedOrigin(
  request: Request,
  env: { NODE_ENV?: string; APP_ORIGIN?: string } = process.env
): readonly string[] | null {
  const configured = env.APP_ORIGIN?.trim();
  if (configured) {
    const origin = configuredApplicationOrigin(configured);
    return origin ? [origin] : null;
  }
  if (env.NODE_ENV === "production") return null;

  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return null;
  }
  if (
    (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") ||
    !isLocalBindHostname(requestUrl.hostname)
  ) {
    return null;
  }
  const port = requestUrl.port ? `:${requestUrl.port}` : "";
  return [
    `${requestUrl.protocol}//localhost${port}`,
    `${requestUrl.protocol}//127.0.0.1${port}`,
    `${requestUrl.protocol}//[::1]${port}`,
    `${requestUrl.protocol}//0.0.0.0${port}`
  ];
}

function configuredApplicationOrigin(value: string) {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isLocalBindHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "[::1]" ||
    normalized === "::1";
}

function normalizedOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

async function authorizeDefaultAdmin(
  request: Request
): Promise<DigitalHumanVideoDiagnosticsActor | null> {
  const cookieValue = readCookie(
    request.headers.get("cookie"),
    adminSessionCookieName
  );
  const verified = await verifyAdminSessionCookie(
    cookieValue,
    readAiConfigSecret()
  );
  if (!verified.ok) return null;
  const user = await prisma.adminUser.findUnique({
    where: { id: verified.session.subject },
    select: { id: true, role: true, enabled: true }
  });
  return user?.enabled ? { id: user.id, role: user.role } : null;
}

function readCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }
  return null;
}
