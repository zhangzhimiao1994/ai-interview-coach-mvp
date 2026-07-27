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
      update(args: unknown): Promise<unknown>;
    };
  }).recruitmentSearchTemplate;
}

export async function PATCH(request: Request, context: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await context.params;
    const input = parseRecruitmentTemplateInput(await request.json());
    const template = await templateClient().update({
      where: { id: templateId },
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
          deleteMany: {},
          create: input.candidateIds.map((candidateId) => ({ candidateId }))
        }
      },
      include: { candidateLinks: true }
    });

    return NextResponse.json({ template: serializeRecruitmentTemplate(template as never) });
  } catch (error) {
    return postErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await context.params;
    const template = await templateClient().update({
      where: { id: templateId },
      data: { enabled: false },
      include: { candidateLinks: true }
    });

    return NextResponse.json({ template: serializeRecruitmentTemplate(template as never) });
  } catch (error) {
    return postErrorResponse(error);
  }
}
