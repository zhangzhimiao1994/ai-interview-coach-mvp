import { NextResponse } from "next/server";
import { z } from "zod";
import { postErrorResponse } from "@/lib/api/errors";

const speechRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
    voice: z.string().trim().min(1).max(100).optional(),
    language: z.string().trim().min(2).max(20).default("zh-CN"),
    speed: z.number().finite().min(0.5).max(2).default(1)
  })
  .strict();

export async function POST(request: Request) {
  try {
    const input = speechRequestSchema.parse(await request.json());

    return NextResponse.json({
      mode: "BROWSER_TTS_FALLBACK",
      providerCapability: "TEXT_TO_SPEECH",
      speech: {
        text: input.text,
        language: input.language,
        voice: input.voice ?? "browser-default",
        speed: input.speed,
        audioUrl: null,
        instructions: "当前版本由前端使用浏览器 speechSynthesis 朗读；接入真实 TTS 后在此返回 audioUrl。"
      }
    });
  } catch (error) {
    return postErrorResponse(error);
  }
}
