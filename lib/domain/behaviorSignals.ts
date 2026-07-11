import { z } from "zod";

export const behaviorSignalsSchema = z
  .object({
    answerDurationSeconds: z.number().finite().nonnegative().optional(),
    transcriptLength: z.number().int().nonnegative().optional(),
    averageVolume: z.number().finite().min(0).max(100).optional(),
    peakVolume: z.number().finite().min(0).max(100).optional(),
    longPauseCount: z.number().int().nonnegative().optional(),
    cameraEnabled: z.boolean().optional(),
    microphoneEnabled: z.boolean().optional(),
    speechRecognitionUsed: z.boolean().optional()
  })
  .strict();

export type BehaviorSignals = z.infer<typeof behaviorSignalsSchema>;

export function summarizeBehaviorSignals(signals: BehaviorSignals) {
  const observations: string[] = [];
  const risks: string[] = [];
  const coachingTips: string[] = [];

  if (signals.cameraEnabled === false) {
    observations.push("本题未启用摄像头，无法形成画面表现证据。");
    risks.push("缺少视频观察信号");
  }

  if (signals.microphoneEnabled === false) {
    observations.push("本题未启用麦克风，无法形成音量和停顿证据。");
    risks.push("缺少语音行为信号");
  }

  if ((signals.longPauseCount ?? 0) > 0) {
    observations.push(`回答中记录到 ${signals.longPauseCount} 次长停顿。`);
    risks.push("长停顿可能影响表达稳定性判断");
    coachingTips.push("练习先给结论，再用 2-3 个证据展开，减少临场组织压力。");
  }

  if ((signals.answerDurationSeconds ?? 0) > 0) {
    observations.push(`本题回答时长约 ${Math.round(signals.answerDurationSeconds ?? 0)} 秒。`);
  }

  if ((signals.transcriptLength ?? 0) > 0 && (signals.transcriptLength ?? 0) < 40) {
    observations.push("回答文本偏短，可能缺少背景、动作或结果证据。");
    risks.push("回答证据不足");
    coachingTips.push("把答案补成 STAR 结构：背景、任务、行动、结果。");
  }

  if ((signals.averageVolume ?? 0) > 0) {
    observations.push(`平均音量约 ${Math.round(signals.averageVolume ?? 0)}%，峰值约 ${Math.round(signals.peakVolume ?? 0)}%。`);
  }

  if (observations.length === 0) {
    observations.push("本题未记录到足够的可解释行为信号。");
  }

  if (coachingTips.length === 0) {
    coachingTips.push("保持镜头稳定、语速均匀，并在每题开头先给明确结论。");
  }

  return {
    observations,
    risks,
    coachingTips
  };
}
