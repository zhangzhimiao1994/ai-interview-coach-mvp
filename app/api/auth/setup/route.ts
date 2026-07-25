import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  hashAdminPassword,
  sanitizeNewAdminUserInput,
  serializeAdminUser
} from "@/lib/admin/adminUsers";
import {
  adminSessionCookieName,
  adminSessionCookieOptions,
  createAdminSessionCookie
} from "@/lib/security/adminSession";
import { readAiConfigSecret } from "@/lib/domain/aiServices";

export async function POST(request: Request) {
  try {
    const existingCount = await prisma.adminUser.count();

    if (existingCount > 0) {
      return NextResponse.json(
        { error: "Already initialized", message: "The first admin user has already been created." },
        { status: 409 }
      );
    }

    const input = sanitizeNewAdminUserInput({
      ...await request.json(),
      role: "SUPER_ADMIN"
    });
    const user = await prisma.adminUser.create({
      data: {
        username: input.username,
        displayName: input.displayName,
        passwordHash: await hashAdminPassword(input.password),
        role: "SUPER_ADMIN",
        enabled: true
      }
    });
    const response = NextResponse.json({ user: serializeAdminUser(user) }, { status: 201 });
    const cookie = await createAdminSessionCookie(
      { subject: user.id, username: user.username, source: "setup" },
      readAiConfigSecret()
    );

    response.cookies.set(adminSessionCookieName, cookie, adminSessionCookieOptions());

    return response;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (error instanceof Error && ["USERNAME_INVALID", "PASSWORD_TOO_SHORT"].includes(error.message)) {
      return NextResponse.json({ error: "Validation failed", message: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
