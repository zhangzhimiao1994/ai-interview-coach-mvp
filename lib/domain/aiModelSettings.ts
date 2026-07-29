import type {
  AiCapability,
  AiProviderType
} from "./aiServiceConstants";

export interface LingmouBroadcastVideoSettings {
  templateId: string;
  audioVariableName: string;
  portraitVariableName: string | null;
  resolution: string;
  fps: number;
  watermark: boolean;
  mode: string;
}

export interface AlibabaEmoVideoSettings {
  model: "emo-v1";
  ratio: "1:1" | "3:4";
}

export function modelSettingsFromForm(
  capability: AiCapability,
  providerType: AiProviderType,
  form: FormData
) {
  switch (capability) {
    case "SPEECH_TO_TEXT":
      return {
        language: String(form.get("language") || "zh-CN"),
        sampleRate: Number(form.get("sampleRate") || 16000),
        encoding: String(form.get("encoding") || "pcm")
      };
    case "TEXT_TO_SPEECH":
      return {
        voice: String(form.get("voice") || "longanhuan_v3.6"),
        format: String(form.get("format") || "pcm"),
        sampleRate: Number(form.get("sampleRate") || 48000),
        channels: Number(form.get("channels") || 1),
        instruction: String(form.get("instruction") || "像专业面试官一样自然、清晰地表达；可根据文本中的 [whisper]、[laughs]、[angry] 等标签添加情绪。")
      };
    case "DIGITAL_HUMAN_REALTIME":
      return {
        configId: String(form.get("configId") || ""),
        instanceId: String(form.get("instanceId") || ""),
        renderMode: String(form.get("renderMode") || "cloud"),
        integrationMode: String(form.get("integrationMode") || "audio-driven"),
        client: "web"
      };
    case "DIGITAL_HUMAN_VIDEO":
      if (providerType === "LINGMOU") {
        return {
          templateId: String(form.get("templateId") || ""),
          audioVariableName: String(form.get("audioVariableName") || "audio_url"),
          portraitVariableName:
            String(form.get("portraitVariableName") || "").trim() || null,
          resolution: String(form.get("resolution") || "1080p"),
          fps: Number(form.get("fps") || 30),
          watermark: ["true", "on", "1"].includes(
            String(form.get("watermark") || "")
          ),
          mode: String(form.get("mode") || "broadcast")
        } satisfies LingmouBroadcastVideoSettings;
      }

      if (providerType === "TONGYI") {
        return {
          model: "emo-v1",
          ratio: form.get("ratio") === "3:4" ? "3:4" : "1:1"
        } satisfies AlibabaEmoVideoSettings;
      }

      return {};
    case "VISION_BEHAVIOR_ANALYSIS":
      return {
        minimumConfidence: Number(form.get("minimumConfidence") || 0.6),
        frameIntervalMs: Number(form.get("frameIntervalMs") || 1000),
        maxFrames: Number(form.get("maxFrames") || 12)
      };
    default:
      return {};
  }
}
