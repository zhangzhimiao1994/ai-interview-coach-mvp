import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DigitalInterviewerVideo } from "@/components/practice/DigitalInterviewerVideo";

describe("DigitalInterviewerVideo", () => {
  it("renders a video-first digital interviewer surface", () => {
    const markup = renderToStaticMarkup(
      <DigitalInterviewerVideo
        interviewerName="林夏"
        stage="正式面试"
        prompt="请你先用两分钟介绍一下自己，并说明为什么适合这个岗位。"
        status="speaking"
      />
    );

    expect(markup).toContain("数字人面试官");
    expect(markup).toContain("林夏");
    expect(markup).toContain("正式面试");
    expect(markup).toContain("正在提问");
    expect(markup).toContain("摄像头已连接");
    expect(markup).toContain("语音字幕");
    expect(markup).toContain("请你先用两分钟介绍一下自己");
    expect(markup).toContain("aria-label=\"数字人视频面试画面\"");
  });
});
