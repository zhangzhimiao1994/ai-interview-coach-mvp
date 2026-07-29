import React from "react";
import type {
  AiCapability,
  AiProviderType
} from "@/lib/domain/aiServiceConstants";

type CapabilitySettingsProps = {
  capability: AiCapability;
  providerType?: AiProviderType;
  settings?: Record<string, unknown>;
};

export function AlibabaProviderFields(): React.JSX.Element {
  return (
    <div className="grid gap-4 rounded-md border border-line p-4">
      <h3 className="text-sm font-medium text-ink">阿里百炼专用凭据</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <ConfigField label="地域" name="region" defaultValue="cn-beijing" />
        <ConfigField label="Workspace ID" name="workspaceId" placeholder="语音识别和合成必填" />
        <ConfigField label="DashScope API Key" name="apiKey" type="password" placeholder="加密保存，EMO 优先使用" />
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

export function CapabilitySettings({
  capability,
  providerType,
  settings = {}
}: CapabilitySettingsProps) {
  if (capability === "SPEECH_TO_TEXT") {
    return (
      <SettingsGrid>
        <ConfigField label="识别语言" name="language" defaultValue={stringSetting(settings, "language", "zh-CN")} />
        <ConfigField label="采样率" name="sampleRate" type="number" defaultValue={numberSetting(settings, "sampleRate", 16000)} />
        <ConfigField label="音频编码（当前仅支持 PCM）" name="encoding" defaultValue={stringSetting(settings, "encoding", "pcm")} readOnly />
      </SettingsGrid>
    );
  }

  if (capability === "TEXT_TO_SPEECH") {
    return (
      <SettingsGrid>
        <ConfigField label="音色" name="voice" defaultValue={stringSetting(settings, "voice", "longanhuan_v3.6")} />
        <ConfigField label="音频格式" name="format" defaultValue={stringSetting(settings, "format", "pcm")} readOnly />
        <ConfigField label="采样率" name="sampleRate" type="number" defaultValue={numberSetting(settings, "sampleRate", 48000)} readOnly />
        <ConfigField label="声道数" name="channels" type="number" defaultValue={numberSetting(settings, "channels", 1)} readOnly />
        <ConfigField
          label="默认情感指令"
          name="instruction"
          defaultValue={stringSetting(
            settings,
            "instruction",
            "像专业面试官一样自然、清晰地表达；可根据文本中的 [whisper]、[laughs]、[angry] 等标签添加情绪。"
          )}
        />
      </SettingsGrid>
    );
  }

  if (capability === "DIGITAL_HUMAN_REALTIME") {
    return (
      <SettingsGrid>
        <ConfigField label="配置 ID" name="configId" placeholder="灵眸数字人配置 ID" defaultValue={stringSetting(settings, "configId", "")} />
        <ConfigField label="实例 ID" name="instanceId" placeholder="灵眸数字人实例 ID" defaultValue={stringSetting(settings, "instanceId", "")} />
        <ConfigField label="渲染模式" name="renderMode" defaultValue={stringSetting(settings, "renderMode", "cloud")} readOnly />
        <ConfigField label="集成模式" name="integrationMode" defaultValue={stringSetting(settings, "integrationMode", "audio-driven")} readOnly />
        <ConfigField label="客户端" name="client" defaultValue={stringSetting(settings, "client", "web")} readOnly />
      </SettingsGrid>
    );
  }

  if (capability === "DIGITAL_HUMAN_VIDEO" && providerType === "LINGMOU") {
    return (
      <SettingsGrid>
        <ConfigField label="模板 ID" name="templateId" defaultValue={stringSetting(settings, "templateId", "")} />
        <ConfigField label="音频变量名" name="audioVariableName" defaultValue={stringSetting(settings, "audioVariableName", "audio_url")} />
        <ConfigField label="人物图变量名（可选）" name="portraitVariableName" defaultValue={stringSetting(settings, "portraitVariableName", "")} />
        <ConfigField label="分辨率" name="resolution" defaultValue={stringSetting(settings, "resolution", "1080p")} />
        <ConfigField label="帧率" name="fps" type="number" defaultValue={numberSetting(settings, "fps", 30)} />
        <ConfigField label="模式" name="mode" defaultValue={stringSetting(settings, "mode", "broadcast")} />
        <label className="flex items-center gap-2 text-sm">
          <input name="watermark" type="checkbox" defaultChecked={settings.watermark === true} />
          <span className="font-medium text-ink">显示水印</span>
        </label>
      </SettingsGrid>
    );
  }

  if (capability === "DIGITAL_HUMAN_VIDEO" && providerType === "TONGYI") {
    return (
      <SettingsGrid>
        <ConfigField label="模型" name="model" defaultValue="emo-v1" readOnly />
        <label className="grid gap-2 text-sm">
          <span className="font-medium text-ink">画面比例</span>
          <select
            className="rounded-md border border-line px-3 py-2"
            name="ratio"
            defaultValue={stringSetting(settings, "ratio", "1:1")}
          >
            <option value="1:1">1:1</option>
            <option value="3:4">3:4</option>
          </select>
        </label>
      </SettingsGrid>
    );
  }

  if (capability === "VISION_BEHAVIOR_ANALYSIS") {
    return (
      <SettingsGrid>
        <ConfigField label="最低置信度" name="minimumConfidence" type="number" step="0.05" defaultValue={numberSetting(settings, "minimumConfidence", 0.6)} />
        <ConfigField label="抽帧间隔 ms" name="frameIntervalMs" type="number" defaultValue={numberSetting(settings, "frameIntervalMs", 1000)} />
        <ConfigField label="最多帧数" name="maxFrames" type="number" defaultValue={numberSetting(settings, "maxFrames", 12)} />
      </SettingsGrid>
    );
  }

  return null;
}

function stringSetting(settings: Record<string, unknown>, key: string, fallback: string) {
  const value = settings[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberSetting(settings: Record<string, unknown>, key: string, fallback: number) {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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
