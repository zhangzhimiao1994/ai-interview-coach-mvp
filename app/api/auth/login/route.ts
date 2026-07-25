import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateAdminUser, serializeAdminUser } from "@/lib/admin/adminUsers";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import {
  adminSessionCookieName,
  adminSessionCookieOptions,
  createAdminSessionCookie
} from "@/lib/security/adminSession";

export async function POST(request: Request) {
  try {
    const body = await request.json() as unknown;
    const values = body !== null && typeof body === "object" ? body as Record<string, unknown> : {};
    const username = typeof values.username === "string" ? values.username : "";
    const password = typeof values.password === "string" ? values.password : "";
    const auth = await authenticateAdminUser(prisma, username, password);

    if (!auth.ok) {
      if (auth.reason === "DISABLED") {
        return NextResponse.json(
          { error: "Login disabled", message: "This admin user has been disabled." },
          { status: 403 }
        );
      }

      return NextResponse.json(
        { error: "Invalid credentials", message: "Username or password is incorrect." },
        { status: 401 }
      );
    }

    const response = NextResponse.json({
      user: { ...serializeAdminUser(auth.user), source: "database" }
    });
    const cookie = await createAdminSessionCookie(
      { subject: auth.user.id, username: auth.user.username, source: "database" },
      readAiConfigSecret()
    );

    response.cookies.set(adminSessionCookieName, cookie, adminSessionCookieOptions());

    return response;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
