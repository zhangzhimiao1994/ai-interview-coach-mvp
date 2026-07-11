import type { TrainingStageType } from "@/lib/domain/stages";

export type TrainingOutlineRequest = {
  targetRole: string;
  targetCompany?: string;
  jobDescription?: string;
  resumeSummary?: string;
  stages?: TrainingStageType[];
  questionCountPerStage?: number;
  preferredLanguage?: "zh-CN" | "en-US";
};

export type TrainingQuestion = {
  id: string;
  stage: TrainingStageType;
  prompt: string;
  expectedFocus: string[];
  followUps: string[];
  difficulty: "LOW" | "MEDIUM" | "HIGH";
  timeLimitSeconds: number;
};

export type TrainingOutline = {
  title: string;
  targetRole: string;
  targetCompany?: string;
  stages: TrainingStageType[];
  estimatedMinutes: number;
  questions: TrainingQuestion[];
};

export type SessionTurnInput = {
  questionId?: string;
  stage: TrainingStageType;
  question: string;
  answer: string;
  durationSeconds?: number;
};

export type FollowUpCoachingInput = {
  sessionId?: string;
  targetRole?: string;
  targetCompany?: string;
  currentTurn: SessionTurnInput;
  previousTurns?: SessionTurnInput[];
};

export type FollowUpCoachingResult = {
  instantFeedback: string;
  followUpQuestion: string;
  suggestedAnswerStructure: string[];
  riskTags: string[];
};

export type CoachingReportInput = {
  sessionId?: string;
  targetRole?: string;
  targetCompany?: string;
  turns: SessionTurnInput[];
};

export type CoachingReportResult = {
  overallScore: number;
  subScores: {
    expressionStructure: number;
    contentRelevance: number;
    confidence: number;
    pressureHandling: number;
    roleFit: number;
  };
  perQuestionFeedback: Array<{
    questionId: string;
    stage: TrainingStageType;
    score: number;
    strengths: string[];
    improvements: string[];
  }>;
  expressionAnalysis: {
    summary: string;
    strongPoints: string[];
    improvementPoints: string[];
  };
  answerQualityAnalysis: {
    summary: string;
    evidence: string[];
    gaps: string[];
  };
  strategySuggestions: string[];
  weakTags: string[];
  nextTrainingPlan: {
    focus: string;
    drills: string[];
    recommendedStages: TrainingStageType[];
  };
  candidateSummary: string;
};

export type AiProvider = {
  generateTrainingOutline(request: TrainingOutlineRequest): Promise<TrainingOutline>;
  generateFollowUpCoaching(input: FollowUpCoachingInput): Promise<FollowUpCoachingResult>;
  generateCoachingReport(input: CoachingReportInput): Promise<CoachingReportResult>;
};
