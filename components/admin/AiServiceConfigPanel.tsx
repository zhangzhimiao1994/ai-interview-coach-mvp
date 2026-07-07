"use client";

import { Cpu, KeyRound, Plus, Route, Server } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  aiCapabilities,
  aiProviderTypes,
  type AiCapability,
  type AiProviderType
} from "@/lib/domain/aiServiceConstants";

type Provider = {
  id: string;
  displayName: string;
  providerType: string;
  baseUrl: string | null;
  apiKeyPreview: string | null;
  enabled: boolean;
  notes: string | null;
};

type ModelConfig = {
  id: string;
  providerId: string;
  displayName: string;
  modelName: string;
  capability: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  costNote: string | null;
  enabled: boolean;
  isDefault: boolean;
  provider: {
    id: string;
    displayName: string;
    providerType: string;
    enabled: boolean;
  };
};

type AiServiceConfigPanelProps = {
  initialProviders: Provider[];
  initialModels: ModelConfig[];
};

const providerTypeLabels: Record<AiProviderType, string> = {
  MOCK: "Mock 模拟服务",
  OPENAI_COMPATIBLE: "OpenAI-compatible",
  OPENAI: "OpenAI",
  AZURE_OPENAI: "Azure OpenAI",
  DEEPSEEK: "DeepSeek",
  TONGYI: "通义千问 / 百炼",
  VOLCANO_ARK: "火山方舟",
  ZHIPU: "智谱",
  MINIMAX: "MiniMax",
  TENCENT: "腾讯云",
  CUSTOM: "自定义服务商"
};

const capabilityLabels: Record<AiCapability, string> = {
  INTERVIEW_OUTLINE: "面试提纲生成",
  INTERVIEW_FOLLOW_UP: "面试追问",
  REPORT_ANALYSIS: "报告分析",
  SPEECH_TO_TEXT: "语音识别",
  TEXT_TO_SPEECH: "语音合成",
  DIGITAL_HUMAN_VIDEO: "数字人视频"
};

export function AiServiceConfigPanel({ initialProviders, initialModels }: AiServiceConfigPanelProps) {
  const [providers, setProviders] = useState(initialProviders);
  const [models, setModels] = useState(initialModels);
  const [providerMessage, setProviderMessage] = useState("");
  const [modelMessage, setModelMessage] = useState("");
  const [savingProvider, setSavingProvider] = useState(false);
  const [savingModel, setSavingModel] = useState(false);

  const enabledProviders = useMemo(() => providers.filter((provider) => provider.enabled), [providers]);

  async function createProvider(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProvider(true);
    setProviderMessage("");

    const form = new FormData(event.currentTarget);
    const payload = {
      displayName: String(form.get("displayName") || ""),
      providerType: String(form.get("providerType") || "OPENAI_COMPATIBLE"),
      baseUrl: String(form.get("baseUrl") || ""),
      apiKey: String(form.get("apiKey") || ""),
      enabled: form.get("enabled") === "on",
      notes: String(form.get("notes") || "")
    };

    try {
      const response = await fetch("/api/ai-services/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = (await response.json().catch(() => null)) as { provider?: Provider; error?: string } | null;

      if (!response.ok || !result?.provider) {
        setProviderMessage(result?.error || "服务商保存失败。");
        return;
      }

      setProviders((current) => [result.provider!, ...current]);
      event.currentTarget.reset();
      setProviderMessage("服务商已保存，密钥已加密存储。");
    } catch {
      setProviderMessage("服务不可达，请稍后重试。");
    } finally {
      setSavingProvider(false);
    }
  }

  async function createModel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingModel(true);
    setModelMessage("");

    const form = new FormData(event.currentTarget);
    const payload = {
      providerId: String(form.get("providerId") || ""),
      displayName: String(form.get("displayName") || ""),
      modelName: String(form.get("modelName") || ""),
      capability: String(form.get("capability") || "INTERVIEW_OUTLINE"),
      temperature: Number(form.get("temperature") || 0.4),
      maxTokens: Number(form.get("maxTokens") || 1200),
      timeoutMs: Number(form.get("timeoutMs") || 30000),
      costNote: String(form.get("costNote") || ""),
      enabled: form.get("enabled") === "on",
      isDefault: form.get("isDefault") === "on"
    };

    try {
      const response = await fetch("/api/ai-services/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = (await response.json().catch(() => null)) as { model?: ModelConfig; error?: string } | null;

      if (!response.ok || !result?.model) {
        setModelMessage(result?.error || "模型保存失败。");
        return;
      }

      setModels((current) => {
        const normalized = result.model!.isDefault
          ? current.map((model) =>
              model.capability === result.model!.capability ? { ...model, isDefault: false } : model
            )
          : current;

        return [result.model!, ...normalized];
      });
      event.currentTarget.reset();
      setModelMessage("模型配置已保存。");
    } catch {
      setModelMessage("服务不可达，请稍后重试。");
    } finally {
      setSavingModel(false);
    }
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <form className="rounded-lg border border-line bg-panel p-5 shadow-sm" onSubmit={createProvider}>
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-brand" aria-hidden="true" />
            <h2 className="font-semibold text-ink">新增服务商</h2>
          </div>
          <div className="mt-5 grid gap-4">
            <Field label="服务商名称" name="displayName" placeholder="DeepSeek / 通义千问 / OpenAI" required />
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-ink">服务商类型</span>
              <select name="providerType" className="rounded-md border border-line px-3 py-2">
                {aiProviderTypes.map((type) => (
                  <option key={type} value={type}>
                    {providerTypeLabels[type]}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Base URL" name="baseUrl" placeholder="https://api.example.com/v1" />
            <Field label="API Key" name="apiKey" type="password" placeholder="保存后仅显示掩码" />
            <Field label="备注" name="notes" placeholder="适合报告分析、备用模型等" />
            <label className="flex items-center gap-2 text-sm text-ink">
              <input name="enabled" type="checkbox" defaultChecked />
              启用服务商
            </label>
          </div>
          {providerMessage ? <p className="mt-4 text-sm text-muted">{providerMessage}</p> : null}
          <Button className="mt-5 gap-2" disabled={savingProvider}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {savingProvider ? "保存中..." : "保存服务商"}
          </Button>
        </form>

        <form className="rounded-lg border border-line bg-panel p-5 shadow-sm" onSubmit={createModel}>
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-brand" aria-hidden="true" />
            <h2 className="font-semibold text-ink">新增模型</h2>
          </div>
          <div className="mt-5 grid gap-4">
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-ink">所属服务商</span>
              <select name="providerId" className="rounded-md border border-line px-3 py-2" required>
                <option value="">请选择服务商</option>
                {enabledProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.displayName}
                  </option>
                ))}
              </select>
            </label>
            <Field label="显示名称" name="displayName" placeholder="DeepSeek Chat 报告分析" required />
            <Field label="模型名称" name="modelName" placeholder="deepseek-chat / gpt-4.1-mini" required />
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-ink">能力类型</span>
              <select name="capability" className="rounded-md border border-line px-3 py-2">
                {aiCapabilities.map((capability) => (
                  <option key={capability} value={capability}>
                    {capabilityLabels[capability]}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="温度" name="temperature" type="number" step="0.1" defaultValue="0.4" />
              <Field label="最大 token" name="maxTokens" type="number" defaultValue="1200" />
              <Field label="超时 ms" name="timeoutMs" type="number" defaultValue="30000" />
            </div>
            <Field label="成本备注" name="costNote" placeholder="低成本 / 高质量 / 备用" />
            <div className="flex flex-wrap gap-4 text-sm text-ink">
              <label className="flex items-center gap-2">
                <input name="enabled" type="checkbox" defaultChecked />
                启用模型
              </label>
              <label className="flex items-center gap-2">
                <input name="isDefault" type="checkbox" />
                设为该能力默认模型
              </label>
            </div>
          </div>
          {modelMessage ? <p className="mt-4 text-sm text-muted">{modelMessage}</p> : null}
          <Button className="mt-5 gap-2" disabled={savingModel || enabledProviders.length === 0}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {savingModel ? "保存中..." : "保存模型"}
          </Button>
        </form>
      </section>

      <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="rounded-lg border border-line bg-panel p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-brand" aria-hidden="true" />
            <h2 className="font-semibold text-ink">服务商列表</h2>
          </div>
          <div className="mt-4 grid gap-3">
            {providers.map((provider) => (
              <div key={provider.id} className="rounded-md border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium text-ink">{provider.displayName}</h3>
                    <p className="mt-1 text-xs text-muted">{providerTypeLabels[provider.providerType as AiProviderType] ?? provider.providerType}</p>
                  </div>
                  <Status enabled={provider.enabled} />
                </div>
                <p className="mt-2 break-all text-xs text-muted">{provider.baseUrl || "未配置 Base URL"}</p>
                <p className="mt-2 text-xs text-muted">密钥：{provider.apiKeyPreview || "未保存"}</p>
              </div>
            ))}
            {providers.length === 0 ? <p className="text-sm text-muted">还没有配置服务商。</p> : null}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-panel p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Route className="h-5 w-5 text-brand" aria-hidden="true" />
            <h2 className="font-semibold text-ink">模型与调用策略</h2>
          </div>
          <div className="mt-4 grid gap-3">
            {models.map((model) => (
              <div key={model.id} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium text-ink">{model.displayName}</h3>
                    <p className="mt-1 text-xs text-muted">
                      {model.provider.displayName} / {model.modelName}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {model.isDefault ? (
                      <span className="rounded-md bg-blue-50 px-2 py-1 text-xs text-brand">默认</span>
                    ) : null}
                    <Status enabled={model.enabled} />
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-4">
                  <span>{capabilityLabels[model.capability as AiCapability] ?? model.capability}</span>
                  <span>温度 {model.temperature}</span>
                  <span>{model.maxTokens} token</span>
                  <span>{model.timeoutMs} ms</span>
                </div>
                {model.costNote ? <p className="mt-2 text-xs text-muted">{model.costNote}</p> : null}
              </div>
            ))}
            {models.length === 0 ? <p className="text-sm text-muted">还没有配置模型。</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({
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

function Status({ enabled }: { enabled: boolean }) {
  return (
    <span className={enabled ? "rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-700" : "rounded-md bg-slate-100 px-2 py-1 text-xs text-muted"}>
      {enabled ? "启用" : "停用"}
    </span>
  );
}
