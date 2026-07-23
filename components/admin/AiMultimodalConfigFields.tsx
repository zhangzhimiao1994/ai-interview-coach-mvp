import React from "react";
import type { AiCapability } from "@/lib/domain/aiServiceConstants";

export function AlibabaProviderFields(): React.JSX.Element {
  return (
    <div className="grid gap-4 rounded-md border border-line p-4">
      <h3 className="text-sm font-medium text-ink">阿里百炼专用凭据</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <ConfigField label="地域" name="region" defaultValue="cn-beijing" />
        <ConfigField label="Workspace ID" name="workspaceId" placeholder="语音识别和合成必填" />
        <ConfigField label="ASR API Key" name="asrApiKey" type="password" placeholder="加密保存" />
        <ConfigField label="TTS API Key" name="ttsApiKey" type="password" placeholder="加密保存" />
      </div>
    </div>
  );
}

export function LingmouProviderFields(): React.JSX.Element {
  return (
    <div className="grid gap-4 rounded-md border border-line p-4">
      <h3 className="text-sm font-medium text-ink">灵眸 RAM 凭据</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <ConfigField label="地域" name="region" defaultValue="cn-beijing" />
        <ConfigField label="AccessKey ID" name="accessKeyId" type="password" />
        <ConfigField label="AccessKey Secret" name="accessKeySecret" type="password" />
      </div>
    </div>
  );
}

export function DuixProviderFields(): React.JSX.Element {
  return (
    <div className="grid gap-4 rounded-md border border-line p-4">
      <h3 className="text-sm font-medium text-ink">硅基 DUIX 凭据</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <ConfigField label="App ID" name="appId" type="password" />
        <ConfigField label="App Secret" name="appSecret" type="password" />
        <ConfigField label="平台域名" name="platform" defaultValue="duix.com" />
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
        <ConfigField label="音色" name="voice" defaultValue="longanhuan" />
        <ConfigField label="音频格式" name="format" defaultValue="pcm" readOnly />
        <ConfigField label="采样率" name="sampleRate" type="number" defaultValue={48000} readOnly />
        <ConfigField label="声道数" name="channels" type="number" defaultValue={1} readOnly />
        <ConfigField label="默认情感指令" name="instruction" defaultValue="你说话的情感是 neutral." />
      </SettingsGrid>
    );
  }

  if (capability === "DIGITAL_HUMAN_REALTIME") {
    return (
      <SettingsGrid>
        <ConfigField label="配置 ID" name="configId" placeholder="灵眸数字人配置 ID" />
        <ConfigField label="实例 ID" name="instanceId" placeholder="灵眸数字人实例 ID" />
        <ConfigField label="DUIX Conversation ID" name="conversationId" placeholder="DUIX 会话 ID" />
        <ConfigField label="渲染模式" name="renderMode" defaultValue="cloud" readOnly />
        <ConfigField label="集成模式" name="integrationMode" defaultValue="audio-driven" readOnly />
        <ConfigField label="DUIX 交互模式" name="interactionMode" defaultValue="direct-drive" readOnly />
        <ConfigField label="DUIX 语音模式" name="speechMode" defaultValue="duix-managed" readOnly />
        <ConfigField label="客户端" name="client" defaultValue="web" readOnly />
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
