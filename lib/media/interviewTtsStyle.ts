const stageInstructions: Record<string, string> = {
  WARM_UP: "暖场阶段：语气温和、放松、慢一点，降低候选人紧张感。",
  FORMAL_INTERVIEW: "正式面试阶段：语气专业、清晰、节奏稳定，保持中性但有现场感。",
  PRESSURE_FOLLOW_UP: "压力追问阶段：语气更认真、直接、略有压迫感，但不要攻击、讽刺或羞辱候选人。",
  EXPERIENCE_DEEP_DIVE: "经历深挖阶段：语气专注、好奇，强调细节追问和事实核验。",
  CASE_ANALYSIS: "案例分析阶段：语气冷静、结构化，突出业务推演和逻辑推进。",
  ENGLISH_INTERVIEW: "英文面试阶段：使用自然、清楚、友好的英语面试官语气。",
  AI_REVIEW: "复盘阶段：语气清晰、鼓励、建设性，指出问题时保持支持感。",
  FOLLOW_UP_PLAN: "复训计划阶段：语气坚定、鼓励，强调下一步行动和可执行改进。"
};

const inlineEmotionTagPattern = /\[(angry|whisper|whispers|laughs|laughing|breaths|breath|sad|serious|excited|calm)\]/gi;

const intentRules = [
  {
    pattern: /为什么|为何|失败|没完成|没有达成|质疑|解释|证明|短板|问题|风险|压力/,
    instruction: "当前问题带有核验或压力追问意图：语气应更严肃、直接，停顿更短，但仍保持职业尊重。"
  },
  {
    pattern: /复盘|总结|回顾|建议|改进|下一步|计划/,
    instruction: "当前问题带有复盘和建议意图：语气应清晰、鼓励、建设性，帮助候选人看到下一步。"
  },
  {
    pattern: /简单聊聊|先聊|自我介绍|背景|开始|轻松|暖场/,
    instruction: "当前问题带有破冰或背景了解意图：语气应更亲和、温和，语速略慢。"
  },
  {
    pattern: /细节|具体|量化|指标|数据|职责|结果|过程|怎么做/,
    instruction: "当前问题带有细节深挖意图：语气应专注、好奇，强调事实和结构。"
  }
];

export type InterviewTtsStyleInput = {
  stage: string;
  text: string;
  defaultInstruction?: string;
  stageVoices?: Record<string, string>;
};

function safeStageVoice(stageVoices: Record<string, string> | undefined, stage: string) {
  const value = stageVoices?.[stage];
  return typeof value === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(value.trim())
    ? value.trim()
    : undefined;
}

export function buildInterviewTtsStyle({
  stage,
  text,
  defaultInstruction,
  stageVoices
}: InterviewTtsStyleInput) {
  const normalizedStage = stage.trim().toUpperCase();
  const inlineTags = Array.from(new Set(text.match(inlineEmotionTagPattern) ?? []));
  const tagInstruction = inlineTags.length > 0
    ? `文本包含内联情绪标签 ${inlineTags.join(" ")}，请在真实合成时遵循这些标签表达，但不要读出标签本身。`
    : "如果文本包含 [whisper]、[laughs]、[angry]、[breaths] 等内联情绪标签，请按标签表达但不要读出标签本身。";
  const intentInstruction = intentRules.find((rule) => rule.pattern.test(text))?.instruction;

  return {
    voice: safeStageVoice(stageVoices, normalizedStage),
    instructions: [
      defaultInstruction?.trim(),
      stageInstructions[normalizedStage] ?? stageInstructions.FORMAL_INTERVIEW,
      intentInstruction,
      tagInstruction,
      "整体保持真实面试官的自然口吻；根据问题严肃程度动态调整停顿、语速和情绪。"
    ].filter(Boolean).join("\n")
  };
}
