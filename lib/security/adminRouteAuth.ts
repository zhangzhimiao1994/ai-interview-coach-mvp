import { prisma } from "@/lib/db/prisma";
import { readCandidateSessionSecret } from "./candidateSecret";
import { adminSessionCookieName, verifyAdminSessionCookie } from "./adminSession";
import { readCookie } from "./candidateSession";
import type { PrismaClient } from "@prisma/client";

export type AuthorizedAdmin = { id: string; role: string };

export async function authorizeAdminRequest(request: Request, database: PrismaClient = prisma, readSecret: () => string = readCandidateSessionSecret): Promise<AuthorizedAdmin | null> {
  let secret: string;
  try { secret = readSecret(); } catch { return null; }
  const verified = await verifyAdminSessionCookie(readCookie(request, adminSessionCookieName), secret);
  if (!verified.ok) return null;
  const user = await database.adminUser.findUnique({
    where: { id: verified.session.subject },
    select: { id: true, role: true, enabled: true }
  });
  return user?.enabled && (user.role === "ADMIN" || user.role === "SUPER_ADMIN")
    ? { id: user.id, role: user.role }
    : null;
}

export function requestHasTrustedOrigin(request: Request) {
  const value = request.headers.get("origin") ?? request.headers.get("referer");
  if (!value) return false;
  try {
    const actual = new URL(value).origin;
    const configured = process.env.APP_ORIGIN?.trim();
    if (configured) return actual === new URL(configured).origin;
    if (process.env.NODE_ENV === "production") return false;
    const target = new URL(request.url);
    return actual === target.origin && ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"].includes(target.hostname);
  } catch {
    return false;
  }
}
