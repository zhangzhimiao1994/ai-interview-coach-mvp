import { describe, expect, it } from "vitest";
import { buildInterviewTtsStyle } from "@/lib/media/interviewTtsStyle";

describe("interview TTS style strategy", () => {
  it("changes speaking instructions by interview stage and preserves inline emotion tags", () => {
    expect(buildInterviewTtsStyle({
      stage: "WARM_UP",
      text: "[whisper]我们先从一个轻松的问题开始。",
      defaultInstruction: "像专业面试官一样自然表达。"
    }).instructions).toContain("温和");

    expect(buildInterviewTtsStyle({
      stage: "PRESSURE_FOLLOW_UP",
      text: "[angry]这个结果为什么没有达成？",
      defaultInstruction: "像专业面试官一样自然表达。"
    }).instructions).toEqual(expect.stringContaining("[angry]"));

    expect(buildInterviewTtsStyle({
      stage: "AI_REVIEW",
      text: "[laughs]我们复盘一下刚才的表现。",
      defaultInstruction: "像专业面试官一样自然表达。"
    }).instructions).toEqual(expect.stringContaining("鼓励"));
  });

  it("can switch the concrete voice only when stage voices are explicitly configured", () => {
    expect(buildInterviewTtsStyle({
      stage: "ENGLISH_INTERVIEW",
      text: "Please introduce yourself.",
      stageVoices: {
        ENGLISH_INTERVIEW: "loongeva_v3.6"
      }
    })).toMatchObject({
      voice: "loongeva_v3.6"
    });

    expect(buildInterviewTtsStyle({
      stage: "FORMAL_INTERVIEW",
      text: "请介绍项目经历。",
      stageVoices: {
        ENGLISH_INTERVIEW: "loongeva_v3.6"
      }
    }).voice).toBeUndefined();
  });

  it("adapts emotion to the question intent even within the same interview stage", () => {
    expect(buildInterviewTtsStyle({
      stage: "FORMAL_INTERVIEW",
      text: "你为什么没有完成这个目标？请具体解释。",
      defaultInstruction: "像专业面试官一样自然表达。"
    }).instructions).toContain("严肃");

    expect(buildInterviewTtsStyle({
      stage: "FORMAL_INTERVIEW",
      text: "我们先简单聊聊你的项目背景。",
      defaultInstruction: "像专业面试官一样自然表达。"
    }).instructions).toContain("亲和");

    expect(buildInterviewTtsStyle({
      stage: "FORMAL_INTERVIEW",
      text: "我们复盘一下刚才这段回答。",
      defaultInstruction: "像专业面试官一样自然表达。"
    }).instructions).toContain("复盘");
  });
});
