import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  hashAdminPassword,
  sanitizeNewAdminUserInput,
  serializeAdminUser
} from "@/lib/admin/adminUsers";

export async function GET() {
  const users = await prisma.adminUser.findMany({
    orderBy: [{ role: "desc" }, { createdAt: "asc" }]
  });

  return NextResponse.json({ users: users.map(serializeAdminUser) });
}

export async function POST(request: Request) {
  try {
    const input = sanitizeNewAdminUserInput(await request.json());
    const user = await prisma.adminUser.create({
      data: {
        username: input.username,
        displayName: input.displayName,
        passwordHash: await hashAdminPassword(input.password),
        role: input.role,
        enabled: true
      }
    });

    return NextResponse.json({ user: serializeAdminUser(user) }, { status: 201 });
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
