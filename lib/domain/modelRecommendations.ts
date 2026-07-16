import type { AiCapability, AiProviderType } from "./aiServiceConstants";

export type ModelRecommendation = {
  capability: AiCapability;
  providerType: AiProviderType;
  providerName: string;
  modelName: string;
  fit: string;
  priceNote: string;
  howToUse: string;
  suggestedTemperature: number;
  suggestedMaxTokens: number;
  suggestedTimeoutMs: number;
};

export type ModelRecommendationGroup = {
  title: string;
  description: string;
  recommendations: ModelRecommendation[];
};

export const modelRecommendationLastUpdated = "2026-07-16";

export const modelRecommendationGroups: ModelRecommendationGroup[] = [
  {
    title: "面试对话与专业追问",
    description: "负责实时问答、追问深度、候选人回答质量判断。",
    recommendations: [
      {
        capability: "INTERVIEW_DIALOGUE",
        providerType: "OPENAI",
        providerName: "OpenAI",
        modelName: "gpt-5.6-luna",
        fit: "实时面试主对话，延迟和成本相对均衡。",
        priceNote: "约 $1 输入 / $6 输出，每百万 tokens；以 OpenAI 控制台为准。",
        howToUse: "添加后设为实时面试对话的当前使用模型，用于每轮生成面试官回应。",
        suggestedTemperature: 0.5,
        suggestedMaxTokens: 1200,
        suggestedTimeoutMs: 30000
      },
      {
        capability: "INTERVIEW_FOLLOW_UP",
        providerType: "CUSTOM",
        providerName: "Anthropic",
        modelName: "claude-sonnet-5",
        fit: "复杂追问、STAR 深挖、管理/专业岗位面试判断。",
        priceNote: "约 $2-$3 输入 / $10-$15 输出，每百万 tokens；以 Anthropic 价格页为准。",
        howToUse: "配置为专业追问增强模型，用于候选人回答后的二次追问和点评。",
        suggestedTemperature: 0.4,
        suggestedMaxTokens: 1600,
        suggestedTimeoutMs: 45000
      }
    ]
  },
  {
    title: "大纲、公司研究与最终报告",
    description: "负责公司/岗位理解、面试题设计、最终评分和训练建议。",
    recommendations: [
      {
        capability: "INTERVIEW_OUTLINE",
        providerType: "CUSTOM",
        providerName: "Anthropic",
        modelName: "claude-sonnet-5",
        fit: "生成更专业的岗位能力模型、阶段题纲和考察标准。",
        priceNote: "约 $2-$3 输入 / $10-$15 输出，每百万 tokens；以 Anthropic 价格页为准。",
        howToUse: "添加后设为面试提纲的当前使用模型，用于创建训练会话前生成专业大纲。",
        suggestedTemperature: 0.35,
        suggestedMaxTokens: 2400,
        suggestedTimeoutMs: 60000
      },
      {
        capability: "COMPANY_RESEARCH",
        providerType: "CUSTOM",
        providerName: "Google Gemini",
        modelName: "gemini-2.5-flash",
        fit: "结合搜索/资料检索做公司、岗位、行业研究。",
        priceNote: "文本/图像/视频输入约 $0.30、输出约 $2.50 每百万 tokens；以 Gemini 价格页为准。",
        howToUse: "配置为公司研究模型，后续接入联网搜索或知识库检索后使用。",
        suggestedTemperature: 0.2,
        suggestedMaxTokens: 2000,
        suggestedTimeoutMs: 45000
      },
      {
        capability: "REPORT_ANALYSIS",
        providerType: "CUSTOM",
        providerName: "Anthropic",
        modelName: "claude-sonnet-5",
        fit: "最终报告、候选人短板诊断、下一轮训练计划。",
        priceNote: "约 $2-$3 输入 / $10-$15 输出，每百万 tokens；以 Anthropic 价格页为准。",
        howToUse: "添加后设为报告分析的当前使用模型，用于训练结束后的完整报告生成。",
        suggestedTemperature: 0.3,
        suggestedMaxTokens: 3600,
        suggestedTimeoutMs: 60000
      }
    ]
  },
  {
    title: "语音、数字人与行为分析",
    description: "负责麦克风识别、面试官声音、数字人驱动和候选人表现信号。",
    recommendations: [
      {
        capability: "SPEECH_TO_TEXT",
        providerType: "TONGYI",
        providerName: "阿里百炼",
        modelName: "qwen3-asr-flash-realtime",
        fit: "中文实时语音识别参考模型，适合电脑和手机麦克风。模型名称可在后台修改。",
        priceNote: "实时识别约 0.00024 元/秒；以阿里百炼价格页为准。",
        howToUse: "配置为语音识别模型，后续由前端音频流或服务端 WebSocket 调用。",
        suggestedTemperature: 0,
        suggestedMaxTokens: 1000,
        suggestedTimeoutMs: 30000
      },
      {
        capability: "TEXT_TO_SPEECH",
        providerType: "TONGYI",
        providerName: "阿里百炼",
        modelName: "qwen3-tts-instruct-flash",
        fit: "中文面试官非实时语音合成参考模型，可配置音色和自然语言语气指令。",
        priceNote: "约 0.8 元/万字符；以阿里百炼价格页为准。",
        howToUse: "添加后设为语音合成的当前使用模型，由 /api/digital-human/speech 通过 HTTP 返回可播放音频。",
        suggestedTemperature: 0.2,
        suggestedMaxTokens: 1000,
        suggestedTimeoutMs: 30000
      },
      {
        capability: "DIGITAL_HUMAN_REALTIME",
        providerType: "TONGYI",
        providerName: "阿里云 Avatar",
        modelName: "avatar-dialog",
        fit: "阿里云实时数字人对话参考能力，可配置数字人形象、音色和 RTC 模式。",
        priceNote: "按阿里云数字人及 RTC 实际开通规格计费，以阿里云控制台为准。",
        howToUse: "配置为实时数字人的当前使用模型，并填写 Avatar ID、RTC App ID 与 RTC App Key。",
        suggestedTemperature: 0.3,
        suggestedMaxTokens: 1200,
        suggestedTimeoutMs: 60000
      },
      {
        capability: "DIGITAL_HUMAN_VIDEO",
        providerType: "CUSTOM",
        providerName: "HeyGen / D-ID",
        modelName: "avatar-video-api",
        fit: "非实时数字人视频生成，适合报告讲解或课程内容。",
        priceNote: "通常按订阅、credits 或分钟计费；以对应厂商价格页为准。",
        howToUse: "配置为数字人视频生成模型，用于 /api/digital-human/render。",
        suggestedTemperature: 0.3,
        suggestedMaxTokens: 1200,
        suggestedTimeoutMs: 120000
      },
      {
        capability: "VISION_BEHAVIOR_ANALYSIS",
        providerType: "TONGYI",
        providerName: "阿里百炼",
        modelName: "qwen3.6-flash",
        fit: "抽帧分析可观察的视线、停顿和表达稳定性，模型名称和阈值均可修改。",
        priceNote: "按百炼多模态模型实际调用量计费，以阿里云控制台为准。",
        howToUse: "添加后设为行为分析的当前使用模型，并配置置信度、抽帧间隔和最多帧数。",
        suggestedTemperature: 0.2,
        suggestedMaxTokens: 1200,
        suggestedTimeoutMs: 45000
      }
    ]
  },
  {
    title: "知识库与安全兜底",
    description: "负责面经、岗位资料、公司资料检索，以及输出合规复核。",
    recommendations: [
      {
        capability: "EMBEDDING",
        providerType: "CUSTOM",
        providerName: "Google Gemini",
        modelName: "gemini-embedding-001",
        fit: "公司资料、岗位 JD、候选人简历、面经向量化。",
        priceNote: "以 Gemini Embeddings 控制台价格为准。",
        howToUse: "配置为知识库向量模型，后续接入向量数据库或文件检索。",
        suggestedTemperature: 0,
        suggestedMaxTokens: 1000,
        suggestedTimeoutMs: 30000
      },
      {
        capability: "SAFETY_REVIEW",
        providerType: "OPENAI",
        providerName: "OpenAI",
        modelName: "gpt-5.6-luna",
        fit: "输出内容复核，避免歧视性、医疗心理诊断式、过度判断式表达。",
        priceNote: "约 $1 输入 / $6 输出，每百万 tokens；以 OpenAI 控制台为准。",
        howToUse: "配置为安全复核模型，用于报告或行为分析结果发布前检查。",
        suggestedTemperature: 0,
        suggestedMaxTokens: 1000,
        suggestedTimeoutMs: 30000
      }
    ]
  }
];
