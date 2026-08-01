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

type ProfileStyle = {
  defaultInstruction?: string;
  stageVoices?: Record<string, string>;
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

  const profileStyle = parseProfileStyle(profile.styleJson);
  const normalizedStage = input.stage.toUpperCase();
  const stageVoices = {
    [normalizedStage]: profile.voice.trim(),
    ...profileStyle.stageVoices
  };
  const styleContext = input.behaviorSignals
    ? `${input.question}\nBehavior signals: ${stableJson(input.behaviorSignals)}`
    : input.question;
  const style = buildInterviewTtsStyle({
    stage: input.stage,
    text: styleContext,
    defaultInstruction: profileStyle.defaultInstruction ?? modelInstruction(model),
    stageVoices
  });
  const speechInput: SpeechSynthesisInput = {
    text: input.question,
    instructions: style.instructions,
    voice: style.voice ?? profile.voice.trim(),
    ...(profileStyle.speed === undefined ? {} : { speed: profileStyle.speed })
  };
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

function parseProfileStyle(value: string): ProfileStyle {
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
  const defaultInstruction = optionalText(record.defaultInstruction);
  const speed = record.speed;
  if (speed !== undefined && (
    typeof speed !== "number" || !Number.isFinite(speed) || speed < 0.5 || speed > 2
  )) {
    throw new VideoSpeechAssetError("VIDEO_SPEECH_PROFILE_STYLE_INVALID");
  }
  let stageVoices: Record<string, string> | undefined;
  if (record.stageVoices !== undefined) {
    if (!record.stageVoices || typeof record.stageVoices !== "object" || Array.isArray(record.stageVoices)) {
      throw new VideoSpeechAssetError("VIDEO_SPEECH_PROFILE_STYLE_INVALID");
    }
    stageVoices = Object.fromEntries(
      Object.entries(record.stageVoices as Record<string, unknown>)
        .filter((entry): entry is [string, string] =>
          typeof entry[1] === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(entry[1].trim())
        )
        .map(([stage, voice]) => [stage.trim().toUpperCase(), voice.trim()])
    );
  }
  return { defaultInstruction, stageVoices, speed: speed as number | undefined };
}

function modelInstruction(model: ResolvedMediaModel) {
  return optionalText(model.modelSettings.instruction) ??
    optionalText(model.modelSettings.instructions);
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stableJson(value: Record<string, unknown>) {
  return JSON.stringify(value, Object.keys(value).sort());
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
