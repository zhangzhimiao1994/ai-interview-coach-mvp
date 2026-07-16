import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandidateMediaPanel } from "@/components/practice/CandidateMediaPanel";

describe("CandidateMediaPanel", () => {
  it("renders a desktop-first camera and microphone preparation surface", () => {
    const markup = renderToStaticMarkup(
      <CandidateMediaPanel sessionId="session-1" onTranscript={() => undefined} />
    );

    expect(markup).toContain("电脑摄像头与麦克风");
    expect(markup).toContain("开启摄像头和麦克风");
    expect(markup).toContain("视频预览");
    expect(markup).toContain("麦克风电平");
    expect(markup).toContain("开始语音回答");
    expect(markup).not.toContain("手机摄像头");
    expect(markup).toContain("video");
    expect(markup).toContain("playsInline");
    expect(markup).toContain("阿里实时识别优先");
    expect(markup).toContain("浏览器识别降级");
  });

  it("integrates the same-origin Alibaba ASR client without supplier credentials", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/practice/CandidateMediaPanel.tsx"),
      "utf8"
    );

    expect(source).toContain("createAlibabaAsrClient");
    expect(source).toContain("ALIBABA_REALTIME_ASR");
    expect(source).toContain("recognitionRef.current !== recognition");
    expect(source).toContain("speechRecognitionUsedRef.current");
    expect(source).toContain('"stopping"');
    expect(source).not.toMatch(/apiKey|Authorization/);

    const roomSource = readFileSync(
      resolve(process.cwd(), "components/practice/InterviewRoom.tsx"),
      "utf8"
    );
    expect(roomSource).toContain('speechActivity !== "idle"');
  });
});
