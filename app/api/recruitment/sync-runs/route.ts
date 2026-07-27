import { NextResponse } from "next/server";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { runRecruitmentSync, serializeRecruitmentSyncRun } from "@/lib/recruitment/sync";
import { parseRecruitmentSyncRunInput } from "@/lib/validators/recruitment";

function syncRunClient() {
  return (prisma as unknown as {
    recruitmentSyncRun: {
      findMany(args: unknown): Promise<unknown[]>;
    };
  }).recruitmentSyncRun;
}

export async function GET() {
  const runs = await syncRunClient().findMany({
    orderBy: { startedAt: "desc" },
    take: 50
  });

  return NextResponse.json({ runs: runs.map((run) => serializeRecruitmentSyncRun(run as never)) });
}

export async function POST(request: Request) {
  try {
    const input = parseRecruitmentSyncRunInput(await request.json());
    const run = await runRecruitmentSync({
      prisma: prisma as never,
      templateId: input.templateId,
      sourceIds: input.sourceIds,
      mode: input.mode
    });

    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return postErrorResponse(error);
  }
}
