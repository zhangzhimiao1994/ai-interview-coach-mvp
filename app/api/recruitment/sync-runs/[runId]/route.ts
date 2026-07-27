import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { serializeRecruitmentSyncRun } from "@/lib/recruitment/sync";

function syncRunClient() {
  return (prisma as unknown as {
    recruitmentSyncRun: {
      findUnique(args: unknown): Promise<unknown | null>;
    };
  }).recruitmentSyncRun;
}

export async function GET(_: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const run = await syncRunClient().findUnique({
    where: { id: runId }
  });

  if (!run) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ run: serializeRecruitmentSyncRun(run as never) });
}
