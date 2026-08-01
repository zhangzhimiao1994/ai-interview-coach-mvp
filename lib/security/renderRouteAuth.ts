import { readAiConfigSecret } from "@/lib/domain/aiServices";
import { adminSessionCookieName, verifyAdminSessionCookie } from "./adminSession";
import {
  candidateSessionCookieName,
  readCookie,
  verifyCandidateSessionCookie
} from "./candidateSession";
import type { RenderActor } from "@/lib/media/video/renderService";

export async function authenticateRenderActor(request: Request): Promise<RenderActor | null> {
  let secret: string;
  try {
    secret = readAiConfigSecret();
  } catch {
    return null;
  }
  const admin = await verifyAdminSessionCookie(readCookie(request, adminSessionCookieName), secret);
  if (admin.ok) return { type: "admin", adminId: admin.session.subject };
  const candidate = await verifyCandidateSessionCookie(
    readCookie(request, candidateSessionCookieName),
    secret
  );
  return candidate.ok ? { type: "candidate", ...candidate.session } : null;
}
