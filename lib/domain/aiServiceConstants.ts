export const aiProviderTypes = [
  "MOCK",
  "OPENAI_COMPATIBLE",
  "OPENAI",
  "AZURE_OPENAI",
  "DEEPSEEK",
  "TONGYI",
  "LINGMOU",
  "VOLCANO_ARK",
  "ZHIPU",
  "MINIMAX",
  "TENCENT",
  "CUSTOM"
] as const;

export const aiCapabilities = [
  "INTERVIEW_DIALOGUE",
  "INTERVIEW_OUTLINE",
  "INTERVIEW_FOLLOW_UP",
  "REPORT_ANALYSIS",
  "COMPANY_RESEARCH",
  "SPEECH_TO_TEXT",
  "TEXT_TO_SPEECH",
  "DIGITAL_HUMAN_REALTIME",
  "DIGITAL_HUMAN_VIDEO",
  "VISION_BEHAVIOR_ANALYSIS",
  "EMBEDDING",
  "SAFETY_REVIEW"
] as const;

export type AiProviderType = (typeof aiProviderTypes)[number];
export type AiCapability = (typeof aiCapabilities)[number];
