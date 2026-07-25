import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateBasicRequest,
  consumeRateLimit,
  isPlaceholderSecret,
  isProtectedPath
} from "@/lib/security/requestGuards";
import {
  adminSessionCookieName,
  verifyAdminSessionCookie
} from "@/lib/security/adminSession";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="AI Interview Coach"'
    }
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

  if (isPublicAuthPath(pathname) || !isProtectedPath(pathname)) {
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
  }

  const username = process.env.ADMIN_USERNAME?.trim() || "admin";
  const password = process.env.ADMIN_PASSWORD?.trim();

  if (process.env.NODE_ENV === "production" && isPlaceholderSecret(password)) {
    return unavailable("ADMIN_PASSWORD must be set to a non-placeholder value before exposing the service.");
  }

  if (!password) {
    return NextResponse.next();
  }

  const auth = authenticateBasicRequest(request.headers.get("authorization"), { username, password });

  if (auth.ok) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return unauthorized();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", pathname);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/:path*", "/practice/:path*"]
};
