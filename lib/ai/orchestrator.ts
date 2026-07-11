import type { AiProvider, CoachingReportInput, FollowUpCoachingInput, TrainingOutlineRequest } from "./types";

export type AiOrchestratorOptions = {
  provider: AiProvider;
};

export function createAiOrchestrator({ provider }: AiOrchestratorOptions): AiProvider {
  return {
    generateTrainingOutline(request: TrainingOutlineRequest) {
      return provider.generateTrainingOutline(request);
    },
    generateFollowUpCoaching(input: FollowUpCoachingInput) {
      return provider.generateFollowUpCoaching(input);
    },
    generateCoachingReport(input: CoachingReportInput) {
      return provider.generateCoachingReport(input);
    }
  };
}
