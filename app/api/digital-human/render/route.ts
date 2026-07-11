import { NextResponse } from "next/server";
import { z } from "zod";
import { postErrorResponse } from "@/lib/api/errors";

const renderRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
    avatarId: z.string().trim().min(1).max(120).default("interviewer-default"),
    expression: z.enum(["neutral", "encouraging", "listening", "probing", "skeptical", "serious", "summary"]).default("neutral"),
    stage: z.string().trim().max(80).optional()
  })
  .strict();

export async function POST(request: Request) {
  try {
    const input = renderRequestSchema.parse(await request.json());

    return NextResponse.json({
      mode: "CLIENT_RENDER_FALLBACK",
      providerCapability: "DIGITAL_HUMAN_VIDEO",
      render: {
        avatarId: input.avatarId,
        expression: input.expression,
        stage: input.stage ?? null,
        text: input.text,
        videoUrl: null,
        streamUrl: null,
        instructions: "当前版本由前端状态化头像、嘴型动画和浏览器 TTS 组合渲染；接入真实数字人后在此返回 videoUrl 或 streamUrl。"
      }
    });
  } catch (error) {
    return postErrorResponse(error);
  }
}
