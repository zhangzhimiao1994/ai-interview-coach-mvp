import { z } from "zod";

export const trainingStageTypes = [
  "WARM_UP",
  "FORMAL_INTERVIEW",
  "PRESSURE_FOLLOW_UP",
  "EXPERIENCE_DEEP_DIVE",
  "CASE_ANALYSIS",
  "ENGLISH_INTERVIEW",
  "AI_REVIEW",
  "FOLLOW_UP_PLAN"
] as const;

export type TrainingStageType = (typeof trainingStageTypes)[number];

export type StageConfigInput = {
  type: TrainingStageType;
  enabled: boolean;
  durationMinutes: number;
  visibleTransition: boolean;
};

export type StagePlanItem = StageConfigInput & {
  label: string;
  description: string;
};

const stageConfigInputSchema = z
  .object({
    type: z.enum(trainingStageTypes),
    enabled: z.boolean(),
    durationMinutes: z.number().finite().int().positive(),
    visibleTransition: z.boolean()
  })
  .strict();

const stageConfigArraySchema = z.array(stageConfigInputSchema).superRefine((configs, ctx) => {
  const seenStageTypes = new Set<TrainingStageType>();

  configs.forEach((config, index) => {
    if (seenStageTypes.has(config.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate training stage: ${config.type}`,
        path: [index, "type"]
      });
      return;
    }

    seenStageTypes.add(config.type);
  });
});

export const defaultStageTemplates = [
  {
    type: "WARM_UP",
    label: "预热练习",
    description: "帮助求职者进入状态，观察紧张、语速和表达结构。",
    enabled: true,
    durationMinutes: 5,
    visibleTransition: true
  },
  {
    type: "FORMAL_INTERVIEW",
    label: "正式模拟",
    description: "围绕目标公司、岗位 JD 和简历进行正式面试。",
    enabled: true,
    durationMinutes: 15,
    visibleTransition: true
  },
  {
    type: "PRESSURE_FOLLOW_UP",
    label: "压力追问",
    description: "通过质疑、连续追问和轻度打断训练抗压能力。",
    enabled: true,
    durationMinutes: 8,
    visibleTransition: true
  },
  {
    type: "EXPERIENCE_DEEP_DIVE",
    label: "经历深挖",
    description: "围绕简历项目、职责、结果和细节进行追问。",
    enabled: false,
    durationMinutes: 10,
    visibleTransition: true
  },
  {
    type: "CASE_ANALYSIS",
    label: "案例分析",
    description: "给出业务场景，观察结构化分析和决策表达。",
    enabled: false,
    durationMinutes: 12,
    visibleTransition: true
  },
  {
    type: "ENGLISH_INTERVIEW",
    label: "英文面试",
    description: "模拟外企或跨文化面试场景。",
    enabled: false,
    durationMinutes: 10,
    visibleTransition: true
  },
  {
    type: "AI_REVIEW",
    label: "AI 复盘",
    description: "生成综合评分、逐题反馈和改进建议。",
    enabled: true,
    durationMinutes: 3,
    visibleTransition: true
  },
  {
    type: "FOLLOW_UP_PLAN",
    label: "复训计划",
    description: "根据弱项生成下一轮训练计划。",
    enabled: true,
    durationMinutes: 2,
    visibleTransition: true
  }
] as const satisfies readonly StagePlanItem[];

export function parseStageConfigInput(input: unknown): StageConfigInput[] {
  if (typeof input === "string") {
    try {
      return stageConfigArraySchema.parse(JSON.parse(input));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Invalid stage config JSON");
      }

      throw error;
    }
  }

  return stageConfigArraySchema.parse(input);
}

export function buildStagePlan(configs: StageConfigInput[]): StagePlanItem[] {
  return configs
    .filter((config) => config.enabled)
    .map((config) => {
      const template = defaultStageTemplates.find((stage) => stage.type === config.type);

      if (!template) {
        throw new Error(`Unsupported training stage: ${config.type}`);
      }

      return {
        ...template,
        ...config
      };
    });
}
