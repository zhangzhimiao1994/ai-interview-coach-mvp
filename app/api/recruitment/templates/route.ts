import { NextResponse } from "next/server";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import {
  parseRecruitmentTemplateInput,
  serializeRecruitmentTemplate
} from "@/lib/validators/recruitment";

function templateClient() {
  return (prisma as unknown as {
    recruitmentSearchTemplate: {
      findMany(args: unknown): Promise<unknown[]>;
      create(args: unknown): Promise<unknown>;
    };
  }).recruitmentSearchTemplate;
}

export async function GET() {
  const templates = await templateClient().findMany({
    include: { candidateLinks: true },
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json({ templates: templates.map((template) => serializeRecruitmentTemplate(template as never)) });
}

export async function POST(request: Request) {
  try {
    const input = parseRecruitmentTemplateInput(await request.json());
    const template = await templateClient().create({
      data: {
        name: input.name,
        keywords: input.keywords,
        roleType: input.roleType || null,
        city: input.city || null,
        country: input.country || null,
        experienceRange: input.experienceRange || null,
        salaryRange: input.salaryRange || null,
        language: input.language || null,
        remoteMode: input.remoteMode || null,
        sourceIdsJson: JSON.stringify(input.sourceIds),
        enabled: input.enabled,
        candidateLinks: {
          create: input.candidateIds.map((candidateId) => ({ candidateId }))
        }
      },
      include: { candidateLinks: true }
    });

    return NextResponse.json({ template: serializeRecruitmentTemplate(template as never) }, { status: 201 });
  } catch (error) {
    return postErrorResponse(error);
  }
}
