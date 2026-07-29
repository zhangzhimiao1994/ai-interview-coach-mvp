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

export const modelRecommendationLastUpdated = "2026-07-25";

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
      },
      {
        capability: "INTERVIEW_FOLLOW_UP",
        providerType: "TONGYI",
        providerName: "阿里百炼",
        modelName: "qwen3.5-omni-plus",
        fit: "全模态接管调试项，可在测试时接管候选人回答后的追问和即时反馈。",
        priceNote: "按百炼 Qwen-Omni 实际调用量计费；模型名以阿里云百炼控制台和官方文档为准。",
        howToUse: "添加后仅在需要全模态接管测试时设为专业追问的当前使用模型；默认不要替换稳定追问链路。",
        suggestedTemperature: 0.25,
        suggestedMaxTokens: 1600,
        suggestedTimeoutMs: 60000
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
        modelName: "qwen-audio-3.0-tts-flash",
        fit: "Qwen-Audio-TTS 默认语音合成模型，支持自然语言风格指令和 [angry]、[whisper]、[laughs] 等内联情绪标签，使用 48k PCM 单声道输出。",
        priceNote: "约 0.8 元/万字符；以阿里百炼价格页为准。",
        howToUse: "添加后设为语音合成的当前使用模型；音色建议 longanhuan_v3.6，情感和语速可通过 instruction 与文本内联标签控制。",
        suggestedTemperature: 0.2,
        suggestedMaxTokens: 1000,
        suggestedTimeoutMs: 30000
      },
      {
        capability: "TEXT_TO_SPEECH",
        providerType: "TONGYI",
        providerName: "阿里百炼",
        modelName: "cosyvoice-v3-flash",
        fit: "备选 CosyVoice 语音合成模型，适合继续兼容旧配置和已有音色。",
        priceNote: "约 0.8 元/万字符；以阿里百炼价格页为准。",
        howToUse: "如果 Qwen-Audio-TTS 音色或额度暂不可用，可选择该备选模型；仍通过同一真实语音合成链路调用。",
        suggestedTemperature: 0.2,
        suggestedMaxTokens: 1000,
        suggestedTimeoutMs: 30000
      },
      {
        capability: "DIGITAL_HUMAN_REALTIME",
        providerType: "LINGMOU",
        providerName: "灵眸",
        modelName: "lingmou-2d-cloud-audio-driven",
        fit: "2D 云渲染音频驱动数字人参考能力，使用灵眸 RAM 凭据。",
        priceNote: "按灵眸数字人实际开通规格计费，以阿里云控制台为准。",
        howToUse: "配置为实时数字人的当前使用模型，并填写配置 ID 和实例 ID。",
        suggestedTemperature: 0.3,
        suggestedMaxTokens: 1200,
        suggestedTimeoutMs: 60000
      },
      {
        capability: "DIGITAL_HUMAN_VIDEO",
        providerType: "LINGMOU",
        providerName: "灵眸",
        modelName: "lingmou-broadcast-video",
        fit: "基于模板、音频和可选人物图生成播报视频，适合异步面试官视频。",
        priceNote: "按灵眸播报视频实际开通规格计费，以阿里云控制台为准。",
        howToUse: "选择灵眸服务商，填写模板 ID、音频变量名和可选人物图变量名。",
        suggestedTemperature: 0.2,
        suggestedMaxTokens: 1200,
        suggestedTimeoutMs: 120000
      },
      {
        capability: "DIGITAL_HUMAN_VIDEO",
        providerType: "TONGYI",
        providerName: "阿里百炼",
        modelName: "emo-v1",
        fit: "使用人物图片和音频生成 EMO 数字人视频，适合异步面试官视频。",
        priceNote: "按百炼 EMO 实际调用量计费，以阿里云控制台为准。",
        howToUse: "选择阿里百炼服务商并配置通用 DashScope API Key；旧 TTS Key 仅作兼容回退。",
        suggestedTemperature: 0.2,
        suggestedMaxTokens: 1200,
        suggestedTimeoutMs: 120000
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
      },
      {
        capability: "VISION_BEHAVIOR_ANALYSIS",
        providerType: "TONGYI",
        providerName: "阿里百炼",
        modelName: "qwen3.5-omni-plus",
        fit: "全模态调试项，用于同时验证文本、图片、音频和视频理解，不默认接管面试流程。",
        priceNote: "按百炼 Qwen-Omni 实际调用量计费；长音视频调试前先确认费用和额度。",
        howToUse: "添加后设为行为分析当前模型时，只作为多模态理解调试入口；面试追问接管请使用专业追问能力下的全模态接管项。",
        suggestedTemperature: 0.2,
        suggestedMaxTokens: 1600,
        suggestedTimeoutMs: 60000
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
