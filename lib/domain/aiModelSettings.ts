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
        voice: String(form.get("voice") || "Cherry"),
        instructions: String(form.get("instructions") || "")
      };
    case "DIGITAL_HUMAN_REALTIME":
      return {
        avatarId: String(form.get("avatarId") || ""),
        voiceId: String(form.get("voiceId") || ""),
        rtcMode: String(form.get("rtcMode") || "web")
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
