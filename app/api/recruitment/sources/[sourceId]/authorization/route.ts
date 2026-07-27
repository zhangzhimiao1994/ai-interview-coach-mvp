import { z } from "zod";
import { NextResponse } from "next/server";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { createEncryptedBrowserSessionRecord } from "@/lib/recruitment/browserSessions";
import { serializeRecruitmentSource } from "@/lib/validators/recruitment";

const browserAuthorizationSchema = z
  .object({
    storageState: z.string().trim().min(16, "Browser storage-state JSON is required")
  })
  .strict();

function sourceClient() {
  return (prisma as unknown as {
    recruitmentSource: {
      update(args: unknown): Promise<unknown>;
    };
  }).recruitmentSource;
}

export async function POST(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  try {
    const { sourceId } = await context.params;
    const input = browserAuthorizationSchema.parse(await request.json());
    const encrypted = createEncryptedBrowserSessionRecord(input.storageState);
    const source = await sourceClient().update({
      where: { id: sourceId },
      data: {
        ...encrypted,
        verificationStatus: "VERIFIED",
        lastVerifiedAt: new Date()
      }
    });

    return NextResponse.json({ source: serializeRecruitmentSource(source as never) });
  } catch (error) {
    return postErrorResponse(error);
  }
}
