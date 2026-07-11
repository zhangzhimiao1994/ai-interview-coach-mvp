import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandidateReport } from "@/components/practice/CandidateReport";
import type { CoachingReportResult } from "@/lib/ai";

const report: CoachingReportResult = {
  overallScore: 82,
  subScores: {
    expressionStructure: 78,
    contentRelevance: 84,
    confidence: 80,
    pressureHandling: 76,
    roleFit: 85
  },
  perQuestionFeedback: [
    {
      questionId: "formal-interview-1",
      stage: "FORMAL_INTERVIEW",
      score: 81,
      strengths: ["能说明项目背景"],
      improvements: ["补充量化结果"],
      answerEvidence: ["我负责过一次留存提升项目"],
      improvementAction: "把项目结果改成基线、动作、提升幅度三段。"
    }
  ],
  expressionAnalysis: {
    summary: "表达自然，但结构标记还不够清晰。",
    strongPoints: ["语气稳定"],
    improvementPoints: ["先给结论"]
  },
  answerQualityAnalysis: {
    summary: "内容与岗位相关，但证据不够可验证。",
    evidence: ["提到了留存项目"],
    gaps: ["缺少结果数字"]
  },
  strategySuggestions: ["每题先用一句话给结论。"],
  weakTags: ["结果量化"],
  nextTrainingPlan: {
    focus: "强化量化表达",
    drills: ["每天重写两道项目题"],
    recommendedStages: ["FORMAL_INTERVIEW"]
  },
  candidateSummary: "已经具备基础面试能力，需要把项目证据讲得更清楚。",
  details: {
    readinessVerdict: {
      level: "NEEDS_PRACTICE",
      summary: "建议完成一轮证据强化训练后再进入正式面试。",
      priorityRisk: "关键项目缺少结果数字，容易在追问中显得准备不足。"
    },
    scoreExplanations: {
      expressionStructure: "能回答问题，但开头结论不够稳定。",
      contentRelevance: "经历与目标岗位相关。",
      confidence: "整体表达稳定。",
      pressureHandling: "被追问时需要更快拿出证据。",
      roleFit: "项目经历能支撑岗位匹配。"
    },
    competencyAssessment: [
      {
        competency: "项目复盘",
        evidence: "能描述留存项目背景。",
        risk: "缺少个人贡献边界。",
        coachingAction: "补充个人决策和结果复盘。"
      }
    ],
    priorityActions: [
      {
        title: "补强量化证据",
        reason: "当前答案还不能让面试官快速判断成果可信度。",
        drill: "为一个核心项目补充基线、动作、结果、复盘。"
      }
    ],
    weeklyPlan: [
      {
        day: 1,
        stage: "FORMAL_INTERVIEW",
        drill: "重写一个正式面试项目题。",
        successCriterion: "答案包含一个明确数字结果。"
      }
    ]
  }
};

describe("CandidateReport", () => {
  it("renders a Chinese evidence-based candidate report with next actions", () => {
    const markup = renderToStaticMarkup(
      <CandidateReport
        taskTitle="产品经理终面训练"
        candidateName="小张"
        targetCompany="示例科技"
        targetRole="产品经理"
        report={report}
      />
    );

    expect(markup).toContain("候选人报告");
    expect(markup).toContain("面试结论");
    expect(markup).toContain("优先改进项");
    expect(markup).toContain("七天训练计划");
    expect(markup).toContain("建议完成一轮证据强化训练后再进入正式面试。");
    expect(markup).toContain("补强量化证据");
    expect(markup).toContain("我负责过一次留存提升项目");
    expect(markup).toContain("把项目结果改成基线、动作、提升幅度三段。");
  });
});
