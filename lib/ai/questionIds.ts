import type { TrainingStageType } from "@/lib/domain/stages";

export function buildQuestionId(stage: TrainingStageType, index: number): string {
  return `${stage.toLowerCase().replaceAll("_", "-")}-${index + 1}`;
}
