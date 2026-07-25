import { NextResponse } from "next/server";
import { adminSessionCookieName } from "@/lib/security/adminSession";

export async function POST() {
  const response = NextResponse.json({ ok: true });

  response.cookies.set(adminSessionCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });

  return response;
}
