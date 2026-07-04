import { NextResponse } from "next/server";
import { z } from "zod";
import { aiOrchestrator } from "@/lib/ai";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { buildStagePlan, parseStageConfigInput } from "@/lib/domain/stages";

const createSessionSchema = z
  .object({
    taskId: z.string().trim().min(1, "Task is required")
  })
  .strict();

function preferredLanguageFromTemplate(languageMode?: string | null) {
  return languageMode === "en-US" ? "en-US" : "zh-CN";
}

function providerName() {
  return process.env.AI_PROVIDER || "mock";
}

export async function POST(request: Request) {
  let taskId: string | undefined;
  const startedAt = Date.now();

  try {
    const input = createSessionSchema.parse(await request.json());
    taskId = input.taskId;

    const task = await prisma.trainingTask.findUnique({
      where: { id: input.taskId },
      include: {
        candidate: true,
        interviewerTemplate: true,
        companyTemplate: true,
        jobTemplate: true
      }
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const stagePlan = buildStagePlan(parseStageConfigInput(task.stageConfig));

    if (stagePlan.length === 0) {
      return NextResponse.json({ error: "Stage config must include at least one enabled stage" }, { status: 400 });
    }

    const outline = await aiOrchestrator.generateTrainingOutline({
      targetRole: task.targetRole,
      targetCompany: task.targetCompany,
      stages: stagePlan.map((stage) => stage.type),
      questionCountPerStage: 1,
      preferredLanguage: preferredLanguageFromTemplate(task.interviewerTemplate?.languageMode)
    });

    const session = await prisma.trainingSession.create({
      data: {
        taskId: task.id,
        candidateId: task.candidateId,
        currentStage: stagePlan[0].type
      }
    });

    await prisma.aiCallLog.create({
      data: {
        taskId: task.id,
        sessionId: session.id,
        capability: "TRAINING_OUTLINE",
        provider: providerName(),
        latencyMs: Date.now() - startedAt,
        costEstimate: 0,
        success: true
      }
    });

    return NextResponse.json({ session, outline }, { status: 201 });
  } catch (error) {
    if (taskId) {
      await prisma.aiCallLog
        .create({
          data: {
            taskId,
            capability: "TRAINING_OUTLINE",
            provider: providerName(),
            latencyMs: Date.now() - startedAt,
            costEstimate: 0,
            success: false,
            failureReason: error instanceof Error ? error.message : "Unknown error"
          }
        })
        .catch(() => undefined);
    }

    if (error instanceof Error && error.message.startsWith("Invalid stage config")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return postErrorResponse(error);
  }
}
