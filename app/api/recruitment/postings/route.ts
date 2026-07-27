import { NextResponse } from "next/server";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { serializeRecruitmentPosting } from "@/lib/recruitment/postings";
import { parseManualRecruitmentPostingInput, parseRecruitmentPostingListQuery } from "@/lib/validators/recruitment";

function postingClient() {
  return (prisma as unknown as {
    recruitmentJobPosting: {
      findMany(args: unknown): Promise<unknown[]>;
      upsert(args: unknown): Promise<unknown>;
    };
  }).recruitmentJobPosting;
}

export async function GET(request: Request) {
  const query = parseRecruitmentPostingListQuery(new URL(request.url));
  const where: Record<string, unknown> = {
    status: query.status
  };

  if (query.provider) where.provider = query.provider;
  if (query.sourceType) where.sourceType = query.sourceType;
  if (query.company) where.company = { contains: query.company };
  if (query.keyword) {
    where.OR = [
      { title: { contains: query.keyword } },
      { description: { contains: query.keyword } }
    ];
  }

  const postings = await postingClient().findMany({
    where,
    orderBy: { lastSeenAt: "desc" },
    take: 100
  });

  return NextResponse.json({ postings: postings.map((posting) => serializeRecruitmentPosting(posting as never)) });
}

export async function POST(request: Request) {
  try {
    const input = parseManualRecruitmentPostingInput(await request.json());
    const data = {
      sourceId: null,
      provider: input.provider,
      sourceType: input.sourceType,
      title: input.title,
      company: input.company,
      location: input.location,
      salary: input.salary,
      description: input.description,
      requirementsJson: JSON.stringify(input.requirements),
      sourceUrl: input.sourceUrl,
      externalJobId: null,
      publishedAt: null,
      rawJson: null,
      dedupeKey: input.dedupeKey,
      status: "ACTIVE",
      editedNotes: input.editedNotes,
      manualImport: true,
      lastSeenAt: new Date()
    };

    const posting = await postingClient().upsert({
      where: { dedupeKey: input.dedupeKey },
      create: data,
      update: {
        ...data,
        firstSeenAt: undefined
      }
    });

    return NextResponse.json({ posting: serializeRecruitmentPosting(posting as never) }, { status: 201 });
  } catch (error) {
    return postErrorResponse(error);
  }
}
