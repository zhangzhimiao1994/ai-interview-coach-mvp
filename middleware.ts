import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateBasicRequest,
  consumeRateLimit,
  isCandidateApiPath,
  isCandidateEntryPath,
  isPlaceholderSecret,
  isProtectedPath
} from "@/lib/security/requestGuards";
import {
  adminSessionCookieName,
  verifyAdminSessionCookie
} from "@/lib/security/adminSession";
import {
  candidateSessionCookieName,
  verifyCandidateSessionCookie
} from "@/lib/security/candidateSession";
import { readCandidateSessionSecret } from "@/lib/security/candidateSecret";

function unauthorized(challenge = true) {
  return new NextResponse("Authentication required", {
    status: 401,
    // A Basic challenge makes the browser open a native login dialog that freezes the candidate
    // interview room, so candidate-cookie requests get a plain 401 instead.
    headers: challenge ? { "WWW-Authenticate": 'Basic realm="AI Interview Coach"' } : undefined
  });
}

function unavailable(message: string) {
  return NextResponse.json({ error: "Server configuration error", message }, { status: 503 });
}

function clientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isPublicAuthPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/setup" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/setup" ||
    pathname === "/api/auth/logout"
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (request.method === "POST" && pathname === "/api/sessions") {
    const limited = consumeRateLimit(`POST:/api/sessions:${clientIp(request)}`, 10, 60_000);

    if (!limited.allowed) {
      return NextResponse.json(
        { error: "Too many requests", message: "Please wait before starting another interview session." },
        { status: 429 }
      );
    }
  }

  if (isPublicAuthPath(pathname) || isCandidateEntryPath(pathname, request.method) || !isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  const sessionSecret = process.env.AI_CONFIG_SECRET?.trim();
  if (sessionSecret && !isPlaceholderSecret(sessionSecret)) {
    const session = await verifyAdminSessionCookie(
      request.cookies.get(adminSessionCookieName)?.value,
      sessionSecret
    );

    if (session.ok) {
      return NextResponse.next();
    }

    try {
      const candidate = await verifyCandidateSessionCookie(
        request.cookies.get(candidateSessionCookieName)?.value,
        readCandidateSessionSecret()
      );
      if (candidate.ok && isCandidateApiPath(pathname, candidate.session.trainingSessionId)) {
        return NextResponse.next();
      }
    } catch {
      // Candidate capabilities fail closed when no explicit strong secret is configured.
    }
  }

  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD?.trim();
  const basicPairInvalid = Boolean(username) !== Boolean(password) || Boolean(password && (isPlaceholderSecret(password) || password.length < 12));

  if (process.env.NODE_ENV === "production" && basicPairInvalid) {
    return unavailable("ADMIN_USERNAME and ADMIN_PASSWORD must be omitted together or configured as a strong emergency pair.");
  }

  const auth = username && password
    ? authenticateBasicRequest(request.headers.get("authorization"), { username, password })
    : { ok: false as const };

  if (auth.ok) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return unauthorized(!request.cookies.has(candidateSessionCookieName));
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", pathname);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/:path*", "/practice/:path*"]
};
