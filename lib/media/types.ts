export type MediaExecutionMetadata = {
  provider: string;
  model: string;
  mode: string;
  traceId: string;
  fallbackUsed: boolean;
};

export type CapabilityCheckResult = MediaExecutionMetadata & {
  available: boolean;
  latencyMs: number;
  checkedAt: string;
  code?: string;
  message?: string;
};

export type SpeechRecognitionSessionInput = {
  sessionId: string;
  language: string;
  encoding: "pcm" | "opus";
  sampleRate: number;
  channels: number;
};

export type SpeechRecognitionSessionResult = MediaExecutionMetadata & {
  connectionUrl: string;
  ticketExpiresAt: string;
  encoding: "pcm" | "opus";
  sampleRate: number;
  channels: number;
};

export interface SpeechToTextProvider {
  createClientSession(
    input: SpeechRecognitionSessionInput
  ): Promise<SpeechRecognitionSessionResult>;
  checkConnection(): Promise<CapabilityCheckResult>;
}

export type SpeechSynthesisInput = {
  text: string;
  voice?: string;
  language?: string;
  speed?: number;
  expression?: string;
  instructions?: string;
};

type SpeechAudioLocation =
  | { audioUrl: string; audioBase64?: never }
  | { audioBase64: string; audioUrl?: never };

export type SpeechSynthesisResult = MediaExecutionMetadata & SpeechAudioLocation & {
  mimeType: string;
  sampleRate?: number;
  expiresAt?: string;
};

export type SpeechPcmStreamResult = MediaExecutionMetadata & {
  encoding: "pcm_s16le";
  sampleRate: 48000;
  channels: 1;
  chunks: AsyncIterable<Uint8Array>;
};

export interface TextToSpeechProvider {
  synthesize(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult>;
  checkConnection(): Promise<CapabilityCheckResult>;
}

export interface StreamingTextToSpeechProvider extends TextToSpeechProvider {
  streamPcm(input: SpeechSynthesisInput): Promise<SpeechPcmStreamResult>;
}

export type DigitalHumanSessionInput = {
  trainingSessionId: string;
  avatarId?: string;
  personaId?: string;
  language?: string;
  context?: Record<string, unknown>;
  idempotencyKey?: string;
};

export type DigitalHumanConnection = {
  protocol: "rtc" | "webrtc" | "hls" | "local";
  url?: string;
  roomId?: string;
  token?: string;
  metadata?: Record<string, unknown>;
};

export type DigitalHumanSessionResult = MediaExecutionMetadata & {
  sessionId: string;
  providerSessionId?: string;
  connection: DigitalHumanConnection;
  expiresAt?: string;
};

export type DigitalHumanSpeakInput = {
  text: string;
  expression?:
    | "neutral"
    | "encouraging"
    | "listening"
    | "probing"
    | "skeptical"
    | "serious"
    | "summary";
  stage?: string;
  requestId?: string;
};

export type DigitalHumanSpeakResult = MediaExecutionMetadata & {
  speechId: string;
  accepted: boolean;
  audioDurationMs?: number;
};

export interface RealtimeDigitalHumanProvider {
  createSession(input: DigitalHumanSessionInput): Promise<DigitalHumanSessionResult>;
  speak(
    sessionId: string,
    input: DigitalHumanSpeakInput
  ): Promise<DigitalHumanSpeakResult>;
  stopSession(sessionId: string): Promise<void>;
  checkConnection(): Promise<CapabilityCheckResult>;
}

export type BehaviorAnalysisFrame = {
  dataBase64: string;
  mimeType: "image/jpeg" | "image/webp";
  capturedAtMs: number;
};

export type BehaviorAnalysisInput = {
  sessionId: string;
  questionId: string;
  stage: string;
  question: string;
  transcript: string;
  frames: BehaviorAnalysisFrame[];
  localSignals?: Record<string, number | boolean | string | null>;
  visualAnalysisConsent: boolean;
};

export type BehaviorObservation = {
  signal: string;
  evidence: string;
  confidence: number;
};

export type BehaviorAnalysisResult = MediaExecutionMetadata & {
  observations: BehaviorObservation[];
  strengths: string[];
  risks: string[];
  coachingTips: string[];
  limitations: string[];
};

export interface BehaviorAnalysisProvider {
  analyze(input: BehaviorAnalysisInput): Promise<BehaviorAnalysisResult>;
  checkConnection(): Promise<CapabilityCheckResult>;
}
