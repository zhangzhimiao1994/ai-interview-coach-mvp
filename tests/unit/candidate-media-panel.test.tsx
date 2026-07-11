import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandidateMediaPanel } from "@/components/practice/CandidateMediaPanel";

describe("CandidateMediaPanel", () => {
  it("renders a desktop-first camera and microphone preparation surface", () => {
    const markup = renderToStaticMarkup(<CandidateMediaPanel onTranscript={() => undefined} />);

    expect(markup).toContain("电脑摄像头与麦克风");
    expect(markup).toContain("开启摄像头和麦克风");
    expect(markup).toContain("视频预览");
    expect(markup).toContain("麦克风电平");
    expect(markup).toContain("开始语音回答");
    expect(markup).not.toContain("手机摄像头");
    expect(markup).toContain("video");
    expect(markup).toContain("playsInline");
  });
});
