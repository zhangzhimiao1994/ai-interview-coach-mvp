import { trainingStageTypes } from "@/lib/domain/stages";
import { buildQuestionId } from "./questionIds";
import type {
  AiProvider,
  CoachingReportInput,
  CoachingReportResult,
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

    return {
      questionId: turn.questionId ?? buildQuestionId(turn.stage, currentStageCount),
      stage: turn.stage,
      score: Math.max(68, 78 - index * 2),
      strengths: ["能够正面回应问题", "有基本经历支撑"],
      improvements: ["先给结论，再补充背景和例子", "增加可量化结果"]
    };
  });
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
        strongPoints: ["语气自然", "能用真实经历回答"],
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
        drills: ["每天练习 2 道 STAR 题", "将项目结果改写为数字化表述", "模拟 5 分钟连续追问"],
        recommendedStages: ["FORMAL_INTERVIEW", "PRESSURE_FOLLOW_UP", "EXPERIENCE_DEEP_DIVE"]
      },
      candidateSummary: `${input.targetRole ?? "Candidate"} shows solid baseline readiness and should focus on structured, evidence-led answers.`
    };
  }
};
