export type InterviewerType =
  | "WARM_GUIDE"
  | "STANDARD_HR"
  | "BUSINESS_MANAGER"
  | "TECHNICAL_PROFESSIONAL"
  | "PRESSURE"
  | "EXPERIENCE_DEEP_DIVE"
  | "CASE_ANALYSIS"
  | "EXECUTIVE_FINAL"
  | "CROSS_CULTURAL_ENGLISH"
  | "COLD_LOW_FEEDBACK";

export type InterviewerTemplate = {
  type: InterviewerType;
  name: string;
  tone: string;
  followUpDepth: number;
  interruptFrequency: number;
  challengeIntensity: number;
  languageMode: "ZH" | "EN" | "MIXED";
  safetyBoundary: string;
};

export const defaultInterviewerTemplates = [
  {
    type: "WARM_GUIDE",
    name: "温和引导型",
    tone: "鼓励、耐心、降低紧张",
    followUpDepth: 2,
    interruptFrequency: 0,
    challengeIntensity: 1,
    languageMode: "ZH",
    safetyBoundary: "以支持和引导为主，不使用否定性压迫话术。"
  },
  {
    type: "STANDARD_HR",
    name: "标准 HR 型",
    tone: "专业、清晰、追问适中",
    followUpDepth: 3,
    interruptFrequency: 1,
    challengeIntensity: 2,
    languageMode: "ZH",
    safetyBoundary: "围绕动机、稳定性、沟通和职业规划提问。"
  },
  {
    type: "BUSINESS_MANAGER",
    name: "业务主管型",
    tone: "结果导向、关注岗位匹配",
    followUpDepth: 4,
    interruptFrequency: 1,
    challengeIntensity: 3,
    languageMode: "ZH",
    safetyBoundary: "追问业务理解、协作方式和结果产出。"
  },
  {
    type: "TECHNICAL_PROFESSIONAL",
    name: "技术或专业面试官型",
    tone: "严谨、关注专业细节",
    followUpDepth: 5,
    interruptFrequency: 1,
    challengeIntensity: 3,
    languageMode: "ZH",
    safetyBoundary: "追问专业能力，但不编造不存在的岗位要求。"
  },
  {
    type: "PRESSURE",
    name: "压力面试型",
    tone: "直接、质疑、连续追问",
    followUpDepth: 5,
    interruptFrequency: 3,
    challengeIntensity: 5,
    languageMode: "ZH",
    safetyBoundary: "可以质疑答案，但不能羞辱、攻击或贬低求职者。"
  },
  {
    type: "EXPERIENCE_DEEP_DIVE",
    name: "经历深挖型",
    tone: "细致、追求证据",
    followUpDepth: 5,
    interruptFrequency: 1,
    challengeIntensity: 3,
    languageMode: "ZH",
    safetyBoundary: "围绕简历事实深挖，不诱导求职者造假。"
  },
  {
    type: "CASE_ANALYSIS",
    name: "案例分析型",
    tone: "结构化、场景化",
    followUpDepth: 4,
    interruptFrequency: 1,
    challengeIntensity: 3,
    languageMode: "ZH",
    safetyBoundary: "评价分析过程，不把单一答案当成唯一正确答案。"
  },
  {
    type: "EXECUTIVE_FINAL",
    name: "高管终面型",
    tone: "宏观、战略、价值观导向",
    followUpDepth: 4,
    interruptFrequency: 1,
    challengeIntensity: 4,
    languageMode: "ZH",
    safetyBoundary: "关注长期规划、组织适配和判断力。"
  },
  {
    type: "CROSS_CULTURAL_ENGLISH",
    name: "跨文化或外企英文型",
    tone: "国际化、表达清晰",
    followUpDepth: 3,
    interruptFrequency: 1,
    challengeIntensity: 3,
    languageMode: "MIXED",
    safetyBoundary: "允许中英混合提示，但正式回答尽量用英文推进。"
  },
  {
    type: "COLD_LOW_FEEDBACK",
    name: "冷淡低反馈型",
    tone: "克制、反馈少、气场偏冷",
    followUpDepth: 3,
    interruptFrequency: 1,
    challengeIntensity: 3,
    languageMode: "ZH",
    safetyBoundary: "模拟冷淡环境，但不进行人格否定。"
  }
] as const satisfies readonly InterviewerTemplate[];
