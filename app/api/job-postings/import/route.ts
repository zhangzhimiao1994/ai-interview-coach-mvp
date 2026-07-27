import { NextResponse } from "next/server";
import { z } from "zod";
import {
  extractJobPostingFromHtml,
  isBlockedJobPostingHtml,
  isSafePublicJobPostingUrl
} from "@/lib/domain/jobPostingImporter";

const importJobPostingSchema = z
  .object({
    url: z.string().trim().min(1, "Job URL is required")
  })
  .strict();

export async function POST(request: Request) {
  const input = importJobPostingSchema.parse(await request.json());

  if (!isSafePublicJobPostingUrl(input.url)) {
    return NextResponse.json({ error: "Job source URL must be a public HTTP(S) URL" }, { status: 400 });
  }

  const response = await fetch(input.url, {
    redirect: "follow",
    headers: {
      "User-Agent": "AIInterviewCoach/1.0 (+job-posting-import; paste-fallback)",
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    return NextResponse.json(
      {
        code: "PASTE_REQUIRED",
        error: "Could not import this job page",
        message: "无法自动读取该招聘页面，请复制网页中可见的岗位职责和任职要求后粘贴到 JD 文本框。"
      },
      { status: 422 }
    );
  }

  const html = await response.text();
  if (isBlockedJobPostingHtml(html)) {
    return NextResponse.json(
      {
        code: "PASTE_REQUIRED",
        error: "Job page requires login or verification",
        message: "该招聘页面需要登录或安全验证，系统不会绕过验证。请登录网站后复制可见岗位详情并粘贴。"
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    posting: extractJobPostingFromHtml(html, input.url)
  });
}
