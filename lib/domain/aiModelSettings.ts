import type { AiCapability } from "./aiServiceConstants";

export function modelSettingsFromForm(capability: AiCapability, form: FormData) {
  switch (capability) {
    case "SPEECH_TO_TEXT":
      return {
        language: String(form.get("language") || "zh-CN"),
        sampleRate: Number(form.get("sampleRate") || 16000),
        encoding: String(form.get("encoding") || "pcm")
      };
    case "TEXT_TO_SPEECH":
      return {
        voice: String(form.get("voice") || "longanhuan"),
        format: String(form.get("format") || "pcm"),
        sampleRate: Number(form.get("sampleRate") || 48000),
        channels: Number(form.get("channels") || 1),
        instruction: String(form.get("instruction") || "你说话的情感是 neutral.")
      };
    case "DIGITAL_HUMAN_REALTIME":
      return {
        configId: String(form.get("configId") || ""),
        instanceId: String(form.get("instanceId") || ""),
        renderMode: "cloud",
        integrationMode: "audio-driven",
        client: "web"
      };
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
