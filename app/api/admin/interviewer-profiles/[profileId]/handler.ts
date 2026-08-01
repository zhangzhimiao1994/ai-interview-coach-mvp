import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { digitalHumanVideoRuntimeSettingKey } from "@/lib/media/video/diagnostics";
import { authorizeAdminRequest, requestHasTrustedOrigin, type AuthorizedAdmin } from "@/lib/security/adminRouteAuth";

type DeleteResult = "DELETED" | "IN_USE" | "NOT_FOUND";

export type InterviewerProfileDeleteDependencies = {
  authorizeAdmin: (request: Request) => Promise<AuthorizedAdmin | null>;
  deleteProfile: (profileId: string) => Promise<DeleteResult>;
};

export function createInterviewerProfileDeleteHandler(overrides: Partial<InterviewerProfileDeleteDependencies> = {}) {
  const dependencies: InterviewerProfileDeleteDependencies = {
    authorizeAdmin: authorizeAdminRequest,
    deleteProfile: deleteDefaultProfile,
    ...overrides
  };
  return async function handler(request: Request, context: { params: Promise<{ profileId: string }> }) {
    const actor = await dependencies.authorizeAdmin(request).catch(() => null);
    if (!actor) return json({ error: "Authentication required" }, 401);
    if (request.method !== "DELETE") return json({ error: "Method not allowed" }, 405);
    if (!requestHasTrustedOrigin(request)) return json({ error: "CSRF validation failed" }, 403);
    const { profileId } = await context.params;
    if (!profileId?.trim()) return json({ error: "Validation failed" }, 400);
    try {
      const result = await dependencies.deleteProfile(profileId.trim());
      if (result === "IN_USE") return json({ error: "Profile is in use" }, 409);
      if (result === "NOT_FOUND") return json({ error: "Profile not found" }, 404);
      return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    } catch {
      return json({ error: "Internal server error" }, 500);
    }
  };
}

async function deleteDefaultProfile(profileId: string): Promise<DeleteResult> {
  return prisma.$transaction(async (transaction) => {
    const runtime = await transaction.aiRuntimeSetting.findUnique({ where: { key: digitalHumanVideoRuntimeSettingKey }, select: { valueJson: true } });
    if (runtime && referencedProfileIds(runtime.valueJson).has(profileId)) return "IN_USE";
    const deleted = await transaction.interviewerAvatarProfile.deleteMany({ where: { id: profileId } });
    return deleted.count === 0 ? "NOT_FOUND" : "DELETED";
  });
}

function referencedProfileIds(valueJson: string) {
  const parsed = JSON.parse(valueJson) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("RUNTIME_CONFIG_INVALID");
  const value = parsed as Record<string, unknown>;
  const ids = new Set<string>();
  if (typeof value.primaryProfileId === "string") ids.add(value.primaryProfileId);
  if (typeof value.secondaryProfileId === "string") ids.add(value.secondaryProfileId);
  return ids;
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
