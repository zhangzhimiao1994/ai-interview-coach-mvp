import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { runDigitalHumanVideoDiagnostic, sanitizeDigitalHumanVideoDiagnosticResult } from "@/lib/media/video/diagnostics";
import { parseVideoSpeechProfileStyle } from "@/lib/media/video/speechAsset";
import { authorizeAdminRequest, requestHasTrustedOrigin, type AuthorizedAdmin } from "@/lib/security/adminRouteAuth";
import type { InterviewerAvatarProfile } from "@prisma/client";

const profileSchema = z.object({
  action: z.literal("SAVE_PROFILE"),
  id: z.string().trim().min(1).optional(),
  displayName: z.string().trim().min(1).max(100),
  voice: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  style: z.unknown(),
  portraitAssetId: z.string().trim().min(1),
  lingmouMapping: z.object({ templateId: z.string().trim().min(1), audioVariableName: z.string().trim().min(1), portraitVariableName: z.string().trim().min(1).nullable() }).strict(),
  emoMapping: z.object({ portraitWidth: z.number().int().min(400).max(7000), portraitHeight: z.number().int().min(400).max(7000) }).strict(),
  providerRole: z.string().trim().regex(/^[A-Z0-9_]{1,64}$/),
  enabled: z.boolean()
}).strict();
const paidSchema = z.object({ action: z.literal("PAID_DIAGNOSTIC"), providerKind: z.enum(["LINGMOU_BROADCAST", "ALIBABA_EMO"]), confirmPaidRequest: z.literal(true) }).strict();
class ProfileValidationError extends Error {}

export type ProfileRouteDependencies = {
  authorizeAdmin: (request: Request) => Promise<AuthorizedAdmin | null>;
  listProfiles: () => Promise<unknown[]>;
  saveProfile: (input: z.infer<typeof profileSchema>) => Promise<unknown>;
  runPaidDiagnostic: (providerKind: "LINGMOU_BROADCAST" | "ALIBABA_EMO", actorId: string) => Promise<unknown>;
};

export function createInterviewerProfileHandler(overrides: Partial<ProfileRouteDependencies> = {}) {
  const deps: ProfileRouteDependencies = {
    authorizeAdmin: authorizeAdminRequest,
    listProfiles: listDefaultProfiles,
    saveProfile: saveDefaultProfile,
    runPaidDiagnostic: async (providerKind, actorId) => sanitizeDigitalHumanVideoDiagnosticResult(await runDigitalHumanVideoDiagnostic({ mode: "PAID", providerKind, confirmPaidRequest: true }, actorId)),
    ...overrides
  };
  return async function handler(request: Request) {
    const actor = await deps.authorizeAdmin(request).catch(() => null);
    if (!actor) return json({ error: "Authentication required" }, 401);
    if (request.method === "GET") return json({ profiles: await deps.listProfiles() }, 200);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!requestHasTrustedOrigin(request)) return json({ error: "CSRF validation failed" }, 403);
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "Validation failed" }, 400); }
    try {
      if (isRecord(body) && body.action === "PAID_DIAGNOSTIC") {
        const input = paidSchema.parse(body);
        return json({ diagnostic: await deps.runPaidDiagnostic(input.providerKind, actor.id) }, 200);
      }
      const input = profileSchema.parse(body);
      return json({ profile: await deps.saveProfile(input) }, input.id ? 200 : 201);
    } catch (error) {
      const validation = error instanceof z.ZodError || error instanceof ProfileValidationError;
      return json({ error: validation ? "Validation failed" : "Internal server error" }, validation ? 400 : 500);
    }
  };
}

async function listDefaultProfiles() {
  const rows = await prisma.interviewerAvatarProfile.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(serializeProfile);
}
async function saveDefaultProfile(input: z.infer<typeof profileSchema>) {
  let style;
  try { style = parseVideoSpeechProfileStyle(JSON.stringify(input.style)); }
  catch { throw new ProfileValidationError("PROFILE_STYLE_INVALID"); }
  const asset = await prisma.digitalHumanMediaAsset.findUnique({ where: { id: input.portraitAssetId } });
  if (!asset || asset.purpose !== "PORTRAIT" || asset.cleanupStatus !== "ACTIVE") throw new ProfileValidationError("PORTRAIT_INVALID");
  const data = { displayName: input.displayName, voice: input.voice, styleJson: JSON.stringify(style), portraitAssetId: input.portraitAssetId, lingmouMappingJson: JSON.stringify(input.lingmouMapping), emoMappingJson: JSON.stringify(input.emoMapping), providerRole: input.providerRole, enabled: input.enabled };
  const row = input.id
    ? await prisma.interviewerAvatarProfile.update({ where: { id: input.id }, data })
    : await prisma.interviewerAvatarProfile.create({ data });
  return serializeProfile(row);
}
function serializeProfile(row: InterviewerAvatarProfile) { return { id: row.id, displayName: row.displayName, voice: row.voice, style: parseObject(row.styleJson), portraitAssetId: row.portraitAssetId, lingmouMapping: parseObject(row.lingmouMappingJson), emoMapping: parseObject(row.emoMappingJson), providerRole: row.providerRole, enabled: row.enabled }; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function parseObject(value: string) { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }
function json(body: unknown, status: number) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
