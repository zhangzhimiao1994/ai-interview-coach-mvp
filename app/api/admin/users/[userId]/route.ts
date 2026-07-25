import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { hashAdminPassword, serializeAdminUser } from "@/lib/admin/adminUsers";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await context.params;
    const body = await request.json() as unknown;
    const values = body !== null && typeof body === "object" ? body as Record<string, unknown> : {};
    const data: { enabled?: boolean; displayName?: string | null; passwordHash?: string; role?: string } = {};

    if (typeof values.enabled === "boolean") {
      data.enabled = values.enabled;
    }

    if (typeof values.displayName === "string") {
      data.displayName = values.displayName.trim() || null;
    }

    if (typeof values.password === "string" && values.password.length > 0) {
      if (values.password.length < 8) {
        return NextResponse.json({ error: "Validation failed", message: "PASSWORD_TOO_SHORT" }, { status: 400 });
      }
      data.passwordHash = await hashAdminPassword(values.password);
    }

    if (values.role === "ADMIN" || values.role === "SUPER_ADMIN") {
      data.role = values.role;
    }

    const user = await prisma.adminUser.update({
      where: { id: userId },
      data
    });

    return NextResponse.json({ user: serializeAdminUser(user) });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
