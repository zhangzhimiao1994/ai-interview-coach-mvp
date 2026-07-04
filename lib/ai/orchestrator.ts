import type { AiProvider, CoachingReportInput, TrainingOutlineRequest } from "./types";

export type AiOrchestratorOptions = {
  provider: AiProvider;
};

export function createAiOrchestrator({ provider }: AiOrchestratorOptions): AiProvider {
  return {
    generateTrainingOutline(request: TrainingOutlineRequest) {
      return provider.generateTrainingOutline(request);
    },
    generateCoachingReport(input: CoachingReportInput) {
      return provider.generateCoachingReport(input);
    }
  };
}
