import { NextResponse } from "next/server";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { splitRequirementsText, serializeRecruitmentPosting } from "@/lib/recruitment/postings";
import { canonicalizeJobUrl } from "@/lib/recruitment/normalization";
import { parseRecruitmentPostingUpdateInput } from "@/lib/validators/recruitment";

function postingClient() {
  return (prisma as unknown as {
    recruitmentJobPosting: {
      update(args: unknown): Promise<unknown>;
    };
  }).recruitmentJobPosting;
}

export async function PATCH(request: Request, context: { params: Promise<{ postingId: string }> }) {
  try {
    const { postingId } = await context.params;
    const input = parseRecruitmentPostingUpdateInput(await request.json());
    const data: Record<string, unknown> = {};

    if (input.title !== undefined) data.title = input.title;
    if (input.company !== undefined) data.company = input.company || null;
    if (input.location !== undefined) data.location = input.location || null;
    if (input.salary !== undefined) data.salary = input.salary || null;
    if (input.description !== undefined) data.description = input.description;
    if (input.requirementsText !== undefined) data.requirementsJson = JSON.stringify(splitRequirementsText(input.requirementsText));
    if (input.sourceUrl !== undefined) data.sourceUrl = input.sourceUrl ? canonicalizeJobUrl(input.sourceUrl) : null;
    if (input.notes !== undefined) data.editedNotes = input.notes || null;
    if (input.status !== undefined) data.status = input.status;

    const posting = await postingClient().update({
      where: { id: postingId },
      data
    });

    return NextResponse.json({ posting: serializeRecruitmentPosting(posting as never) });
  } catch (error) {
    return postErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ postingId: string }> }) {
  try {
    const { postingId } = await context.params;
    const posting = await postingClient().update({
      where: { id: postingId },
      data: { status: "ARCHIVED" }
    });

    return NextResponse.json({ posting: serializeRecruitmentPosting(posting as never) });
  } catch (error) {
    return postErrorResponse(error);
  }
}
