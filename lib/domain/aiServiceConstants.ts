export const aiProviderTypes = [
  "MOCK",
  "OPENAI_COMPATIBLE",
  "OPENAI",
  "AZURE_OPENAI",
  "DEEPSEEK",
  "TONGYI",
  "VOLCANO_ARK",
  "ZHIPU",
  "MINIMAX",
  "TENCENT",
  "CUSTOM"
] as const;

export const aiCapabilities = [
  "INTERVIEW_OUTLINE",
  "INTERVIEW_FOLLOW_UP",
  "REPORT_ANALYSIS",
  "SPEECH_TO_TEXT",
  "TEXT_TO_SPEECH",
  "DIGITAL_HUMAN_VIDEO",
  "VISION_BEHAVIOR_ANALYSIS"
] as const;

export type AiProviderType = (typeof aiProviderTypes)[number];
export type AiCapability = (typeof aiCapabilities)[number];
