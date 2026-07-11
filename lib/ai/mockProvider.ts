import { trainingStageTypes } from "@/lib/domain/stages";
import { buildQuestionId } from "./questionIds";
import type {
  AiProvider,
  CoachingReportInput,
  CoachingReportResult,
  FollowUpCoachingInput,
  FollowUpCoachingResult,
  TrainingOutline,
  TrainingOutlineRequest,
  TrainingQuestion
} from "./types";
import type { TrainingStageType } from "@/lib/domain/stages";

const questionTemplates: Record<TrainingStageType, Omit<TrainingQuestion, "id" | "stage">> = {
  WARM_UP: {
    prompt: "请用一分钟介绍你自己，并说明你为什么关注这个机会。",
    expectedFocus: ["核心背景", "目标岗位动机", "表达节奏"],
    followUps: ["你最希望面试官记住你的哪一个优势？"],
    difficulty: "LOW",
    timeLimitSeconds: 60
  },
  FORMAL_INTERVIEW: {
    prompt: "请结合过往经历，说明你如何胜任目标岗位的核心要求。",
    expectedFocus: ["岗位匹配", "关键成果", "可迁移能力"],
    followUps: ["这个成果如何量化？"],
    difficulty: "MEDIUM",
    timeLimitSeconds: 120
  },
  PRESSURE_FOLLOW_UP: {
    prompt: "如果你的方案被业务负责人质疑投入产出比不高，你会如何回应？",
    expectedFocus: ["压力回应", "事实依据", "沟通策略"],
    followUps: ["如果对方继续否定你的判断呢？"],
    difficulty: "HIGH",
    timeLimitSeconds: 90
  },
  EXPERIENCE_DEEP_DIVE: {
    prompt: "请选择一个最能代表你能力的项目，拆解你的职责、行动和结果。",
    expectedFocus: ["项目背景", "个人贡献", "复盘沉淀"],
    followUps: ["这个项目里你犯过什么错误？"],
    difficulty: "MEDIUM",
    timeLimitSeconds: 150
  },
  CASE_ANALYSIS: {
    prompt: "假设新用户次日留存下降 20%，你会如何定位问题并制定行动计划？",
    expectedFocus: ["问题拆解", "数据假设", "优先级"],
    followUps: ["你会先看哪三个指标？"],
    difficulty: "HIGH",
    timeLimitSeconds: 180
  },
  ENGLISH_INTERVIEW: {
    prompt: "Please describe a cross-functional project and your specific contribution.",
    expectedFocus: ["English clarity", "Collaboration", "Impact"],
    followUps: ["What would you do differently next time?"],
    difficulty: "MEDIUM",
    timeLimitSeconds: 120
  },
  AI_REVIEW: {
    prompt: "请回顾刚才的回答，指出一个表达优点和一个需要改进的地方。",
    expectedFocus: ["自我觉察", "改进方向", "复盘能力"],
    followUps: ["下一轮你会优先调整什么？"],
    difficulty: "LOW",
    timeLimitSeconds: 60
  },
  FOLLOW_UP_PLAN: {
    prompt: "请为下一次模拟面试设定一个最重要的训练目标。",
    expectedFocus: ["训练重点", "可执行动作", "衡量标准"],
    followUps: ["你会如何判断自己已经改善？"],
    difficulty: "LOW",
    timeLimitSeconds: 60
  }
};

function buildQuestion(stage: TrainingStageType, index: number): TrainingQuestion {
  return {
    id: buildQuestionId(stage, index),
    stage,
    ...questionTemplates[stage]
  };
}

function buildPerQuestionFeedback(input: CoachingReportInput): CoachingReportResult["perQuestionFeedback"] {
  const stageQuestionCounts = new Map<TrainingStageType, number>();

  return input.turns.map((turn, index) => {
    const currentStageCount = stageQuestionCounts.get(turn.stage) ?? 0;
    stageQuestionCounts.set(turn.stage, currentStageCount + 1);
    const answer = turn.answer.trim();
    const evidence = answer ? [answer.slice(0, 80)] : ["本题没有记录到有效回答内容。"];

    return {
      questionId: turn.questionId ?? buildQuestionId(turn.stage, currentStageCount),
      stage: turn.stage,
      score: Math.max(68, 78 - index * 2),
      strengths: ["能够正面回应问题", "具备可展开的真实经历"],
      improvements: ["先给结论，再补充背景、行动和结果", "增加可量化成果或业务指标"],
      answerEvidence: evidence,
      improvementAction: "把这题改写成：一句话结论 + 关键背景 + 个人动作 + 量化结果。"
    };
  });
}

function buildWeeklyPlan(): NonNullable<CoachingReportResult["details"]>["weeklyPlan"] {
  const drills = [
    "重写一个正式面试项目题答案，补充结论和结果数字。",
    "录制一次 90 秒自我介绍，删掉铺垫性表达。",
    "准备三组可复用成果指标：增长、效率、质量。",
    "进行一轮压力追问练习，先复述质疑再回应。",
    "把一个项目复盘改成 STAR 结构。",
    "进行一次英文或跨部门协作表达练习。",
    "完成一轮完整模拟面试并复盘前三个风险点。"
  ];

  return drills.map((drill, index) => ({
    day: index + 1,
    stage: index === 3 ? "PRESSURE_FOLLOW_UP" : "FORMAL_INTERVIEW",
    drill,
    successCriterion: "回答中包含明确结论、个人贡献和可验证证据。"
  }));
}

export const mockAiProvider: AiProvider = {
  async generateTrainingOutline(request: TrainingOutlineRequest): Promise<TrainingOutline> {
    const stages = request.stages?.length ? request.stages : [...trainingStageTypes];
    const questions = stages.flatMap((stage) => {
      const count = request.questionCountPerStage ?? 1;

      return Array.from({ length: count }, (_, index) => buildQuestion(stage, index));
    });

    return {
      title: `${request.targetRole} mock interview outline`,
      targetRole: request.targetRole,
      targetCompany: request.targetCompany,
      stages,
      estimatedMinutes: questions.length * 2,
      questions
    };
  },

  async generateFollowUpCoaching(input: FollowUpCoachingInput): Promise<FollowUpCoachingResult> {
    const answerLength = input.currentTurn.answer.trim().length;
    const followUpQuestion =
      answerLength < 40
        ? "你刚才的回答还比较短。能不能补充一个具体场景、你的行动和最终结果？"
        : "如果面试官继续追问结果可信度，你会用哪个数据或事实证明这个成果？";

    return {
      instantFeedback:
        "回答已记录。建议下一句先给结论，再用 STAR 结构补充背景、行动和结果，尽量加入可量化证据。",
      followUpQuestion,
      suggestedAnswerStructure: ["一句话结论", "关键背景", "你的具体行动", "量化结果或复盘"],
      riskTags: answerLength < 40 ? ["回答偏短", "细节不足"] : ["量化证据", "岗位映射"]
    };
  },

  async generateCoachingReport(input: CoachingReportInput): Promise<CoachingReportResult> {
    return {
      overallScore: 76,
      subScores: {
        expressionStructure: 68,
        contentRelevance: 78,
        confidence: 74,
        pressureHandling: 72,
        roleFit: 80
      },
      perQuestionFeedback: buildPerQuestionFeedback(input),
      expressionAnalysis: {
        summary: "回答能够覆盖问题，但开头结论和层次标记还不够稳定。",
        strongPoints: ["语气自然", "能够用真实经历回答"],
        improvementPoints: ["使用 STAR 或总分总结构", "减少铺垫，先给判断"]
      },
      answerQualityAnalysis: {
        summary: "内容相关度较好，仍需要更多业务指标和结果证据。",
        evidence: ["提到了项目经验", "能够说明跨团队协作"],
        gaps: ["量化结果不足", "对岗位要求的映射不够明确"]
      },
      strategySuggestions: ["每题先用一句话给结论", "准备 3 个可复用的量化项目案例", "压力追问中先确认问题再回应"],
      weakTags: ["表达结构", "结果量化", "压力追问"],
      nextTrainingPlan: {
        focus: "提升回答结构和量化表达",
        drills: ["每天练习 2 道 STAR 题", "将项目结果改写为数字化表达", "模拟 5 分钟连续追问"],
        recommendedStages: ["FORMAL_INTERVIEW", "PRESSURE_FOLLOW_UP", "EXPERIENCE_DEEP_DIVE"]
      },
      candidateSummary: `${input.targetRole ?? "候选人"}具备基础面试能力，但需要增强结构化表达和量化证据。`,
      details: {
        readinessVerdict: {
          level: "NEEDS_PRACTICE",
          summary: "具备进入真实面试的基础，但建议先完成一轮证据强化训练。",
          priorityRisk: "量化结果不足，容易在追问中失去说服力。"
        },
        scoreExplanations: {
          expressionStructure: "回答能围绕问题展开，但结论位置不够靠前。",
          contentRelevance: "经历与目标岗位相关，能支撑基础匹配。",
          confidence: "表达较稳定，但遇到追问时需要更快组织证据。",
          pressureHandling: "面对质疑时还需要先确认问题，再用事实回应。",
          roleFit: "项目经历与岗位能力有连接，但需要把匹配点讲得更直接。"
        },
        competencyAssessment: [
          {
            competency: "结构化表达",
            evidence: "能够围绕问题给出经历和行动。",
            risk: "结论不够前置，面试官需要自行提炼重点。",
            coachingAction: "每题开头固定使用一句话结论。"
          },
          {
            competency: "证据可信度",
            evidence: "回答中出现项目经验和协作场景。",
            risk: "缺少基线、指标、结果数字和个人贡献边界。",
            coachingAction: "为三个核心项目补齐背景、动作、结果、复盘。"
          }
        ],
        priorityActions: [
          {
            title: "补全量化证据",
            reason: "当前答案能说明经历，但还不足以证明成果强度。",
            drill: "把一个项目答案改成：基线、动作、结果、复盘。"
          },
          {
            title: "强化压力追问",
            reason: "正式面试常会追问结果可信度和个人贡献。",
            drill: "连续回答三轮为什么、怎么证明、如果失败怎么办。"
          },
          {
            title: "压缩开场表达",
            reason: "过多铺垫会削弱第一印象。",
            drill: "每道题先用 15 秒讲结论，再展开细节。"
          }
        ],
        weeklyPlan: buildWeeklyPlan()
      }
    };
  }
};
