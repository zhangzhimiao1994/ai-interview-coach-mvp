import { prisma } from "@/lib/db/prisma";
import type { ResolvedMediaModel } from "@/lib/media/config";
import { resolveMediaModel } from "@/lib/media/config";
import { pcm16MonoToWav } from "@/lib/media/audio/pcmWav";
import { buildInterviewTtsStyle } from "@/lib/media/interviewTtsStyle";
import { createAlibabaTtsProvider } from "@/lib/media/providers/alibabaTts";
import { persistDigitalHumanMediaAsset } from "@/lib/media/storage/mediaAssets";
import { createOssPrivateMediaStorage } from "@/lib/media/storage/ossStorage";
import type { PrivateMediaStorage } from "@/lib/media/storage/types";
import type { SpeechPcmStreamResult, SpeechSynthesisInput } from "@/lib/media/types";
import { readAiConfigSecret } from "@/lib/domain/aiServices";

const speechAssetLifetimeMs = 60 * 60 * 1000;
const maxPcmBytes = 10 * 1024 * 1024;

export interface VideoSpeechAssetRequest {
  sessionId: string;
  questionId: string;
  question: string;
  stage: string;
  interviewerProfileId: string;
  behaviorSignals: Record<string, unknown> | null;
}

export type VideoSpeechProfile = {
  id: string;
  voice: string;
  styleJson: string;
  enabled: boolean;
};

export type PersistVideoSpeechAssetInput = {
  storageConfigId: string;
  objectKey: string;
  mimeType: "audio/wav";
  byteLength: number;
  purpose: "TTS_AUDIO";
  expiresAt: Date;
};

export interface VideoSpeechAssetDependencies {
  resolveTtsModel: () => Promise<ResolvedMediaModel>;
  findProfile: (id: string) => Promise<VideoSpeechProfile | null>;
  streamPcm: (
    model: ResolvedMediaModel,
    input: SpeechSynthesisInput
  ) => Promise<SpeechPcmStreamResult>;
  storageConfigId: string;
  storage: PrivateMediaStorage;
  persistAsset: (
    input: PersistVideoSpeechAssetInput
  ) => Promise<{ id: string }>;
  now: () => Date;
}

export class VideoSpeechAssetError extends Error {
  constructor(readonly code: string) {
    super("Video speech asset creation failed");
    this.name = "VideoSpeechAssetError";
  }
}

export type VideoSpeechQuestionIntent =
  | "GENERAL"
  | "WARM_UP"
  | "PRESSURE"
  | "DETAIL"
  | "REVIEW";

export type VideoSpeechBehaviorStyle =
  | "HESITATION"
  | "LOW_CONFIDENCE"
  | "STRESS";

export type VideoSpeechProfileStyle = {
  defaultInstruction?: string;
  stageVoices?: Record<string, string>;
  intentVoices?: Partial<Record<VideoSpeechQuestionIntent, string>>;
  signalVoices?: Partial<Record<VideoSpeechBehaviorStyle, string>>;
  speed?: number;
};

export async function createVideoSpeechAsset(
  request: VideoSpeechAssetRequest,
  dependencyOverrides: Partial<VideoSpeechAssetDependencies> = {}
) {
  const input = validateRequest(request);
  const storageContext = dependencyOverrides.storage && dependencyOverrides.storageConfigId
    ? {
      storage: dependencyOverrides.storage,
      storageConfigId: dependencyOverrides.storageConfigId
    }
    : await loadDefaultStorage();
  const deps: VideoSpeechAssetDependencies = {
    resolveTtsModel: () => resolveMediaModel("TEXT_TO_SPEECH"),
    findProfile: findDefaultProfile,
    streamPcm: (model, speechInput) =>
      createAlibabaTtsProvider(model).streamPcm(speechInput),
    persistAsset: (asset) => persistDigitalHumanMediaAsset(asset),
    now: () => new Date(),
    ...dependencyOverrides,
    ...storageContext
  };

  const [model, profile] = await Promise.all([
    deps.resolveTtsModel(),
    deps.findProfile(input.interviewerProfileId)
  ]);
  if (!profile || !profile.enabled || profile.id !== input.interviewerProfileId) {
    throw new VideoSpeechAssetError("VIDEO_SPEECH_PROFILE_NOT_CONFIGURED");
  }

  const speechInput = resolveVideoSpeechSynthesisInput({ question: input.question, stage: input.stage, behaviorSignals: input.behaviorSignals, profile, model });
  const stream = await deps.streamPcm(model, speechInput);
  const pcm = await collectPcm(stream);
  const wav = pcm16MonoToWav(pcm, stream.sampleRate);
  const expiresAt = new Date(deps.now().getTime() + speechAssetLifetimeMs);

  const uploaded = await deps.storage.putObject({
    purpose: "TTS_AUDIO",
    body: wav,
    contentType: "audio/wav",
    expiresAt
  });

  try {
    const asset = await deps.persistAsset({
      storageConfigId: deps.storageConfigId,
      objectKey: uploaded.objectKey,
      mimeType: "audio/wav",
      byteLength: uploaded.byteLength,
      purpose: "TTS_AUDIO",
      expiresAt
    });
    return {
      assetId: asset.id,
      mimeType: "audio/wav" as const,
      byteLength: uploaded.byteLength,
      sampleRate: stream.sampleRate,
      channels: stream.channels
    };
  } catch (error) {
    await deps.storage.removeObject(uploaded.objectKey).catch(() => undefined);
    throw error;
  }
}

export function resolveVideoSpeechSynthesisInput(input: {
  question: string;
  stage: string;
  behaviorSignals: Record<string, unknown> | null;
  profile: VideoSpeechProfile;
  model: ResolvedMediaModel;
}): SpeechSynthesisInput {
  if (!input.profile.enabled || !text(input.profile.voice)) throw new VideoSpeechAssetError("VIDEO_SPEECH_PROFILE_NOT_CONFIGURED");
  const profileStyle = parseVideoSpeechProfileStyle(input.profile.styleJson);
  const normalizedStage = input.stage.toUpperCase();
  const stageVoices = { [normalizedStage]: input.profile.voice.trim(), ...profileStyle.stageVoices };
  const intent = classifyQuestionIntent(input.question);
  const behavior = classifyBehaviorStyle(input.behaviorSignals);
  const contextualInstruction = [profileStyle.defaultInstruction ?? modelInstruction(input.model), behavior?.instruction].filter(Boolean).join("\n");
  const style = buildInterviewTtsStyle({ stage: input.stage, text: input.question, defaultInstruction: contextualInstruction, stageVoices });
  const contextualVoice = behavior ? profileStyle.signalVoices?.[behavior.kind] : undefined;
  const intentVoice = profileStyle.intentVoices?.[intent];
  return {
    text: input.question,
    instructions: style.instructions,
    voice: contextualVoice ?? intentVoice ?? style.voice ?? input.profile.voice.trim(),
    ...(profileStyle.speed === undefined ? {} : { speed: profileStyle.speed })
  };
}

function validateRequest(request: VideoSpeechAssetRequest): VideoSpeechAssetRequest {
  if (
    !text(request.sessionId) ||
    !text(request.questionId) ||
    !text(request.question) ||
    !text(request.stage) ||
    !text(request.interviewerProfileId) ||
    (
      request.behaviorSignals !== null &&
      (typeof request.behaviorSignals !== "object" || Array.isArray(request.behaviorSignals))
    )
  ) {
    throw new VideoSpeechAssetError("VIDEO_SPEECH_INPUT_INVALID");
  }
  return {
    ...request,
    sessionId: request.sessionId.trim(),
    questionId: request.questionId.trim(),
    question: request.question.trim(),
    stage: request.stage.trim(),
    interviewerProfileId: request.interviewerProfileId.trim()
  };
}

async function collectPcm(stream: SpeechPcmStreamResult): Promise<Buffer> {
  if (
    stream.encoding !== "pcm_s16le" ||
    stream.channels !== 1 ||
    !Number.isSafeInteger(stream.sampleRate) ||
    stream.sampleRate <= 0 ||
    !stream.chunks ||
    typeof stream.chunks[Symbol.asyncIterator] !== "function"
  ) {
    throw new VideoSpeechAssetError("VIDEO_SPEECH_PCM_REQUIRED");
  }

  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of stream.chunks) {
    if (!(chunk instanceof Uint8Array)) {
      throw new VideoSpeechAssetError("VIDEO_SPEECH_PCM_REQUIRED");
    }
    byteLength += chunk.byteLength;
    if (byteLength > maxPcmBytes) {
      throw new VideoSpeechAssetError("VIDEO_SPEECH_PCM_TOO_LARGE");
    }
    chunks.push(Buffer.from(chunk));
  }
  if (byteLength === 0 || byteLength % 2 !== 0) {
    throw new VideoSpeechAssetError("VIDEO_SPEECH_PCM_REQUIRED");
  }
  return Buffer.concat(chunks, byteLength);
}

export function parseVideoSpeechProfileStyle(value: string): VideoSpeechProfileStyle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new VideoSpeechAssetError("VIDEO_SPEECH_PROFILE_STYLE_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new VideoSpeechAssetError("VIDEO_SPEECH_PROFILE_STYLE_INVALID");
  }
  const record = parsed as Record<string, unknown>;
  const allowedKeys = new Set([
    "defaultInstruction",
    "stageVoices",
    "intentVoices",
    "signalVoices",
    "speed"
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new VideoSpeechAssetError("VIDEO_SPEECH_PROFILE_STYLE_INVALID");
  }
  const defaultInstruction = optionalBoundedInstruction(record.defaultInstruction);
  if (record.defaultInstruction !== undefined && !defaultInstruction) {
    throw new VideoSpeechAssetError("VIDEO_SPEECH_PROFILE_STYLE_INVALID");
  }
  const speed = record.speed;
  if (speed !== undefined && (
    typeof speed !== "number" || !Number.isFinite(speed) || speed < 0.5 || speed > 2
  )) {
    throw new VideoSpeechAssetError("VIDEO_SPEECH_PROFILE_STYLE_INVALID");
  }
  const stageVoices = parseVoiceMap(record.stageVoices, (key) =>
    /^[A-Z0-9_]{1,64}$/.test(key)
  );
  const intentVoices = parseVoiceMap(record.intentVoices, (key) =>
    (["GENERAL", "WARM_UP", "PRESSURE", "DETAIL", "REVIEW"] as string[]).includes(key)
  ) as VideoSpeechProfileStyle["intentVoices"];
  const signalVoices = parseVoiceMap(record.signalVoices, (key) =>
    (["HESITATION", "LOW_CONFIDENCE", "STRESS"] as string[]).includes(key)
  ) as VideoSpeechProfileStyle["signalVoices"];
  return {
    defaultInstruction,
    stageVoices,
    intentVoices,
    signalVoices,
    speed: speed as number | undefined
  };
}

function parseVoiceMap(
  value: unknown,
  validKey: (key: string) => boolean
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VideoSpeechAssetError("VIDEO_SPEECH_PROFILE_STYLE_INVALID");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const normalized: Record<string, string> = {};
  for (const [rawKey, rawVoice] of entries) {
    const key = rawKey.trim().toUpperCase();
    if (
      !validKey(key) ||
      typeof rawVoice !== "string" ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(rawVoice.trim())
    ) {
      throw new VideoSpeechAssetError("VIDEO_SPEECH_PROFILE_STYLE_INVALID");
    }
    normalized[key] = rawVoice.trim();
  }
  return normalized;
}

function classifyQuestionIntent(question: string): VideoSpeechQuestionIntent {
  if (/为什么|为何|失败|没有达成|质疑|证明|风险|压力|why|fail/i.test(question)) {
    return "PRESSURE";
  }
  if (/复盘|总结|回顾|建议|改进|下一步|review|improve/i.test(question)) {
    return "REVIEW";
  }
  if (/介绍|背景|开始|暖场|简单聊|introduce|background/i.test(question)) {
    return "WARM_UP";
  }
  if (/细节|具体|量化|指标|数据|结果|过程|怎么做|detail|metric|how/i.test(question)) {
    return "DETAIL";
  }
  return "GENERAL";
}

function classifyBehaviorStyle(signals: Record<string, unknown> | null): {
  kind: VideoSpeechBehaviorStyle;
  instruction: string;
} | null {
  if (!signals) return null;
  if (signals.needsEncouragement === true || thresholdAtLeast(signals.hesitation, 0.7)) {
    return {
      kind: "HESITATION",
      instruction: "The candidate appears hesitant; respond patiently, warmly, and with slightly slower pacing."
    };
  }
  if (thresholdAtLeast(signals.stress, 0.7) || thresholdAtLeast(signals.frustration, 0.7)) {
    return {
      kind: "STRESS",
      instruction: "The candidate appears stressed; keep a calm, steady, non-confrontational tone."
    };
  }
  if (thresholdAtMost(signals.confidence, 0.3)) {
    return {
      kind: "LOW_CONFIDENCE",
      instruction: "The candidate appears uncertain; use an encouraging but professional tone."
    };
  }
  return null;
}

function thresholdAtLeast(value: unknown, minimum: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= 1;
}

function thresholdAtMost(value: unknown, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum;
}

function modelInstruction(model: ResolvedMediaModel) {
  return optionalText(model.modelSettings.instruction) ??
    optionalText(model.modelSettings.instructions);
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalBoundedInstruction(value: unknown) {
  const normalized = optionalText(value);
  return normalized && normalized.length <= 1000 ? normalized : undefined;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function findDefaultProfile(id: string): Promise<VideoSpeechProfile | null> {
  return prisma.interviewerAvatarProfile.findUnique({
    where: { id },
    select: { id: true, voice: true, styleJson: true, enabled: true }
  });
}

async function loadDefaultStorage() {
  const config = await prisma.mediaStorageConfig.findFirst({
    where: { enabled: true },
    orderBy: { createdAt: "asc" }
  });
  if (!config || config.providerKind !== "ALI_OSS") {
    throw new VideoSpeechAssetError("VIDEO_SPEECH_STORAGE_NOT_CONFIGURED");
  }
  try {
    return {
      storageConfigId: config.id,
      storage: createOssPrivateMediaStorage(config, readAiConfigSecret())
    };
  } catch {
    throw new VideoSpeechAssetError("VIDEO_SPEECH_STORAGE_NOT_CONFIGURED");
  }
}
