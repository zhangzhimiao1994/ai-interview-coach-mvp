import { NextResponse } from "next/server";
import { z } from "zod";
import { postErrorResponse } from "@/lib/api/errors";
import { behaviorSignalsSchema, summarizeBehaviorSignals } from "@/lib/domain/behaviorSignals";

const behaviorAnalysisRequestSchema = z
  .object({
    sessionId: z.string().trim().min(1).optional(),
    questionId: z.string().trim().min(1).optional(),
    signals: behaviorSignalsSchema
  })
  .strict();

export async function POST(request: Request) {
  try {
    const input = behaviorAnalysisRequestSchema.parse(await request.json());
    const summary = summarizeBehaviorSignals(input.signals);

    return NextResponse.json({
      mode: "LOCAL_SIGNAL_SUMMARY",
      providerCapability: "VISION_BEHAVIOR_ANALYSIS",
      sessionId: input.sessionId ?? null,
      questionId: input.questionId ?? null,
      summary
    });
  } catch (error) {
    return postErrorResponse(error);
  }
}
