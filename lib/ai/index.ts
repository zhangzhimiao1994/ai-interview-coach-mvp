import { mockAiProvider } from "./mockProvider";
import { createAiOrchestrator } from "./orchestrator";
import { createConfiguredAiOrchestrator } from "./providerFactory";

const aiOrchestrator = createConfiguredAiOrchestrator();

export default aiOrchestrator;
export {
  aiOrchestrator,
  createAiOrchestrator,
  createConfiguredAiOrchestrator,
  mockAiProvider
};
export { buildQuestionId } from "./questionIds";
export {
  deserializeStoredCoachingReport,
  safeDeserializeStoredCoachingReport,
  serializeCoachingReportForStorage
} from "./reportStorage";
export type {
  SafeDeserializeStoredCoachingReportResult,
  SerializedCoachingReportForStorage,
  StoredCoachingReportRecord
} from "./reportStorage";
export type {
  AiProvider,
  CoachingReportInput,
  CoachingReportResult,
  SessionTurnInput,
  TrainingOutline,
  TrainingOutlineRequest,
  TrainingQuestion
} from "./types";
