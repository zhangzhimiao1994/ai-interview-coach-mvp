import React from "react";
import type { AiCapability } from "@/lib/domain/aiServiceConstants";

export function AlibabaProviderFields() {
  return (
    <div className="grid gap-4 rounded-md border border-line p-4">
      <h3 className="text-sm font-medium text-ink">阿里百炼与 Avatar 参数</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <ConfigField label="地域" name="region" defaultValue="cn-beijing" />
        <ConfigField label="Workspace ID" name="workspaceId" placeholder="语音识别和合成必填" />
        <ConfigField label="RTC App ID" name="rtcAppId" placeholder="实时数字人使用" />
        <ConfigField label="ASR API Key" name="asrApiKey" type="password" placeholder="留空则使用主 API Key" />
        <ConfigField label="TTS API Key" name="ttsApiKey" type="password" placeholder="留空则使用主 API Key" />
        <ConfigField label="RTC App Key" name="rtcAppKey" type="password" placeholder="加密保存" />
      </div>
    </div>
  );
}

export function CapabilitySettings({ capability }: { capability: AiCapability }) {
  if (capability === "SPEECH_TO_TEXT") {
    return (
      <SettingsGrid>
        <ConfigField label="识别语言" name="language" defaultValue="zh-CN" />
        <ConfigField label="采样率" name="sampleRate" type="number" defaultValue={16000} />
        <ConfigField label="音频编码（当前仅支持 PCM）" name="encoding" defaultValue="pcm" readOnly />
      </SettingsGrid>
    );
  }

  if (capability === "TEXT_TO_SPEECH") {
    return (
      <SettingsGrid>
        <ConfigField label="音色" name="voice" defaultValue="Cherry" />
        <ConfigField label="默认语气指令（可选）" name="instructions" defaultValue="语气专业、自然、清晰。" />
      </SettingsGrid>
    );
  }

  if (capability === "DIGITAL_HUMAN_REALTIME") {
    return (
      <SettingsGrid>
        <ConfigField label="Avatar ID" name="avatarId" placeholder="阿里云数字人形象 ID" />
        <ConfigField label="Voice ID" name="voiceId" placeholder="数字人音色 ID" />
        <ConfigField label="RTC 模式" name="rtcMode" defaultValue="web" />
      </SettingsGrid>
    );
  }

  if (capability === "VISION_BEHAVIOR_ANALYSIS") {
    return (
      <SettingsGrid>
        <ConfigField label="最低置信度" name="minimumConfidence" type="number" step="0.05" defaultValue={0.6} />
        <ConfigField label="抽帧间隔 ms" name="frameIntervalMs" type="number" defaultValue={1000} />
        <ConfigField label="最多帧数" name="maxFrames" type="number" defaultValue={12} />
      </SettingsGrid>
    );
  }

  return null;
}

function SettingsGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 rounded-md border border-line p-4 sm:grid-cols-3">{children}</div>;
}

function ConfigField({
  label,
  name,
  type = "text",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium text-ink">{label}</span>
      <input className="rounded-md border border-line px-3 py-2" name={name} type={type} {...props} />
    </label>
  );
}
