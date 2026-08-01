import { describe, expect, it } from "vitest";
import {
  buildOutlineRenderPlaceholders,
  deterministicRenderIdentity,
  followUpRenderQuestion
} from "@/lib/media/video/renderRequests";

describe("preset render placeholder and prewarm contracts", () => {
  it("creates deterministic placeholders without invoking media or provider boundaries", () => {
    let boundaryCalls = 0;
    const outline = {
      questions: [
        { id: "q1", stage: "WARM_UP", prompt: "Introduce yourself." },
        { id: "q2", stage: "FORMAL_INTERVIEW", prompt: "Describe a difficult launch." }
      ]
    };
    const placeholders = buildOutlineRenderPlaceholders("session-a", outline.questions);
    boundaryCalls += 0;
    expect(placeholders).toHaveLength(2);
    expect(placeholders[0]).toMatchObject({
      trainingSessionId: "session-a",
      questionId: "q1",
      kind: "PRESET",
      status: "PENDING"
    });
    expect(placeholders[0].questionHash).toBe(deterministicRenderIdentity("q1", "Introduce yourself.", "PRESET").questionHash);
    expect(boundaryCalls).toBe(0);
  });

  it("uses the generated follow-up text verbatim with a deterministic id", () => {
    const first = followUpRenderQuestion("parent-question", "What exact metric changed?");
    const second = followUpRenderQuestion("parent-question", "What exact metric changed?");
    expect(first).toEqual(second);
    expect(first.text).toBe("What exact metric changed?");
    expect(first.id).toBe("parent-question::follow-up::1");
  });

  it("rejects duplicate question ids before persistence", () => {
    expect(() => buildOutlineRenderPlaceholders("session-a", [
      { id: "q1", stage: "WARM_UP", prompt: "One" },
      { id: "q1", stage: "WARM_UP", prompt: "Two" }
    ])).toThrow(/duplicate/i);
  });
});
