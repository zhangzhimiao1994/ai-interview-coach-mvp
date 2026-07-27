import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { parseCandidateInput } from "@/lib/validators/candidate";
import { parseTrainingTaskInput } from "@/lib/validators/task";

const validStageConfig = [
  { type: "FORMAL_INTERVIEW", enabled: true, durationMinutes: 20, visibleTransition: true },
  { type: "AI_REVIEW", enabled: true, durationMinutes: 5, visibleTransition: false }
];

const validTaskInput = {
  candidateId: "candidate-1",
  title: "Product manager interview",
  targetCompany: "Acme",
  targetRole: "Product Manager",
  stageConfig: validStageConfig,
  expectedMinutes: 45
};

describe("parseTrainingTaskInput", () => {
  it("canonicalizes stage config before persistence", () => {
    const result = parseTrainingTaskInput({
      candidateId: "candidate-1",
      companyTemplateId: "",
      jobTemplateId: undefined,
      interviewerTemplateId: null,
      title: "Product manager interview",
      targetCompany: "Acme",
      targetRole: "Product Manager",
      jobSourceUrl: " https://jobs.example.com/pm ",
      jobDescription: " 负责增长策略和用户研究。 ",
      jobManualNotes: " 重点追问商业化经验。 ",
      stageConfig: JSON.stringify(validStageConfig),
      expectedMinutes: 45
    });

    expect(result).toEqual({
      candidateId: "candidate-1",
      companyTemplateId: undefined,
      jobTemplateId: undefined,
      interviewerTemplateId: undefined,
      title: "Product manager interview",
      targetCompany: "Acme",
      targetRole: "Product Manager",
      jobSourceUrl: "https://jobs.example.com/pm",
      jobDescription: "负责增长策略和用户研究。\n\n人工补充：\n重点追问商业化经验。",
      jobManualNotes: "重点追问商业化经验。",
      stageConfig: JSON.stringify(validStageConfig),
      expectedMinutes: 45
    });
  });

  it("rejects private job source URLs for server-side imports", () => {
    expect(() =>
      parseTrainingTaskInput({
        ...validTaskInput,
        jobSourceUrl: "http://127.0.0.1:3000/internal"
      })
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            message: "Job source URL must be a public HTTP(S) URL"
          })
        ])
      })
    );
  });

  it("rejects expected minutes outside the supported range", () => {
    expect(() =>
      parseTrainingTaskInput({
        candidateId: "candidate-1",
        title: "Product manager interview",
        targetCompany: "Acme",
        targetRole: "Product Manager",
        stageConfig: validStageConfig,
        expectedMinutes: 121
      })
    ).toThrow();
  });

  it("rejects invalid stage config", () => {
    expect(() =>
      parseTrainingTaskInput({
        ...validTaskInput,
        stageConfig: [{ type: "FORMAL_INTERVIEW", enabled: true, durationMinutes: 0, visibleTransition: true }],
      })
    ).toThrow();
  });

  it("reports malformed stage config JSON on the stageConfig path", () => {
    expect(() =>
      parseTrainingTaskInput({
        ...validTaskInput,
        stageConfig: "{bad json"
      })
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            message: "Invalid stage config JSON",
            path: ["stageConfig"]
          })
        ])
      })
    );
  });

  it("prefixes nested stage config validation paths with stageConfig", () => {
    try {
      parseTrainingTaskInput({
        ...validTaskInput,
        stageConfig: [{ type: "FORMAL_INTERVIEW", enabled: true, durationMinutes: 0, visibleTransition: true }]
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect((error as ZodError).issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["stageConfig", 0, "durationMinutes"]
          })
        ])
      );
      return;
    }

    throw new Error("Expected parseTrainingTaskInput to reject invalid stage config");
  });
});

describe("parseCandidateInput", () => {
  it("normalizes optional email whitespace and blanks", () => {
    expect(parseCandidateInput({ name: "Ada", email: " ada@example.com " })).toEqual({
      name: "Ada",
      email: "ada@example.com"
    });

    expect(parseCandidateInput({ name: "Ada", email: " " })).toEqual({
      name: "Ada",
      email: undefined
    });
  });
});
