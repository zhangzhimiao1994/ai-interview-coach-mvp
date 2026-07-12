"use client";

import { Cpu, KeyRound, Plus, Route, Server, Star, Trash2 } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  aiCapabilities,
  aiProviderTypes,
  type AiCapability,
  type AiProviderType
} from "@/lib/domain/aiServiceConstants";
import {
  modelRecommendationGroups,
  modelRecommendationLastUpdated,
  type ModelRecommendation
} from "@/lib/domain/modelRecommendations";

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

type ApiResult<T> = T & {
  error?: string;
  message?: string;
  issues?: Array<{ message?: string }>;
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
  INTERVIEW_DIALOGUE: "实时面试对话",
  INTERVIEW_OUTLINE: "面试提纲生成",
  INTERVIEW_FOLLOW_UP: "面试追问",
  REPORT_ANALYSIS: "报告分析",
  COMPANY_RESEARCH: "公司/岗位研究",
  SPEECH_TO_TEXT: "语音识别",
  TEXT_TO_SPEECH: "语音合成",
  DIGITAL_HUMAN_REALTIME: "实时数字人",
  DIGITAL_HUMAN_VIDEO: "数字人视频",
  VISION_BEHAVIOR_ANALYSIS: "神态/行为分析",
  EMBEDDING: "知识库向量",
  SAFETY_REVIEW: "安全复核"
};

const providerBaseUrlPresets: Partial<Record<AiProviderType, string>> = {
  OPENAI: "https://api.openai.com/v1",
  OPENAI_COMPATIBLE: "https://api.example.com/v1",
  DEEPSEEK: "https://api.deepseek.com",
  TONGYI: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  VOLCANO_ARK: "https://ark.cn-beijing.volces.com/api/v3",
  ZHIPU: "https://open.bigmodel.cn/api/paas/v4",
  MINIMAX: "https://api.minimax.chat/v1",
  TENCENT: "https://api.hunyuan.cloud.tencent.com/v1"
};

const initialModelDraft = {
  displayName: "",
  modelName: "",
  capability: "INTERVIEW_OUTLINE" as AiCapability,
  temperature: 0.4,
  maxTokens: 1200,
  timeoutMs: 30000,
  costNote: ""
};

function apiErrorMessage(result: ApiResult<unknown> | null, fallback: string) {
  if (!result) {
    return fallback;
  }

  if (result.message) {
    return result.message;
  }

  const firstIssue = result.issues?.find((issue) => issue.message)?.message;

  if (firstIssue) {
    return firstIssue;
  }

  return result.error || fallback;
}

export function AiServiceConfigPanel({ initialProviders, initialModels }: AiServiceConfigPanelProps) {
  const [providers, setProviders] = useState(initialProviders);
  const [models, setModels] = useState(initialModels);
  const [providerMessage, setProviderMessage] = useState("");
  const [modelMessage, setModelMessage] = useState("");
  const [savingProvider, setSavingProvider] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [providerType, setProviderType] = useState<AiProviderType>("OPENAI_COMPATIBLE");
  const [baseUrl, setBaseUrl] = useState(providerBaseUrlPresets.OPENAI_COMPATIBLE ?? "");
  const [modelDraft, setModelDraft] = useState(initialModelDraft);

  const enabledProviders = useMemo(() => providers.filter((provider) => provider.enabled), [providers]);

  function updateModelDraft<K extends keyof typeof initialModelDraft>(key: K, value: (typeof initialModelDraft)[K]) {
    setModelDraft((current) => ({ ...current, [key]: value }));
  }

  function applyRecommendation(recommendation: ModelRecommendation) {
    setProviderType(recommendation.providerType);
    setBaseUrl(providerBaseUrlPresets[recommendation.providerType] ?? "");
    setModelDraft({
      displayName: `${recommendation.providerName} ${capabilityLabels[recommendation.capability]}`,
      modelName: recommendation.modelName,
      capability: recommendation.capability,
      temperature: recommendation.suggestedTemperature,
      maxTokens: recommendation.suggestedMaxTokens,
      timeoutMs: recommendation.suggestedTimeoutMs,
      costNote: recommendation.priceNote
    });
    setModelMessage("已填入推荐模型参数，请选择对应服务商后保存。");
  }

  async function createProvider(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProvider(true);
    setProviderMessage("");

    const form = new FormData(event.currentTarget);
    const payload = {
      displayName: String(form.get("displayName") || ""),
      providerType,
      baseUrl,
      apiKey: String(form.get("apiKey") || ""),
      enabled: form.get("enabled") === "on",
      notes: String(form.get("notes") || "")
    };

    try {
      const response = await fetch("/api/ai-services/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload)
      });
      const result = (await response.json().catch(() => null)) as ApiResult<{ provider?: Provider }> | null;

      if (!response.ok || !result?.provider) {
        setProviderMessage(apiErrorMessage(result, "服务商保存失败。"));
        return;
      }

      setProviders((current) => [result.provider!, ...current]);
      event.currentTarget.reset();
      setProviderType("OPENAI_COMPATIBLE");
      setBaseUrl(providerBaseUrlPresets.OPENAI_COMPATIBLE ?? "");
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
        credentials: "same-origin",
        body: JSON.stringify(payload)
      });
      const result = (await response.json().catch(() => null)) as ApiResult<{ model?: ModelConfig }> | null;

      if (!response.ok || !result?.model) {
        setModelMessage(apiErrorMessage(result, "模型保存失败。"));
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
      setModelDraft(initialModelDraft);
      setModelMessage("模型配置已保存。");
    } catch {
      setModelMessage("服务不可达，请稍后重试。");
    } finally {
      setSavingModel(false);
    }
  }

  async function patchModel(modelId: string, payload: { enabled?: boolean; isDefault?: boolean }) {
    setModelMessage("");

    try {
      const response = await fetch(`/api/ai-services/models/${modelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload)
      });
      const result = (await response.json().catch(() => null)) as ApiResult<{ model?: ModelConfig }> | null;

      if (!response.ok || !result?.model) {
        setModelMessage(apiErrorMessage(result, "模型更新失败。"));
        return;
      }

      setModels((current) =>
        current.map((model) => {
          if (result.model!.isDefault && model.capability === result.model!.capability && model.id !== result.model!.id) {
            return { ...model, isDefault: false };
          }

          return model.id === result.model!.id ? result.model! : model;
        })
      );
      setModelMessage("模型配置已更新。");
    } catch {
      setModelMessage("服务不可达，请稍后重试。");
    }
  }

  async function deleteModel(model: ModelConfig) {
    setModelMessage("");

    if (!window.confirm(`确认删除模型「${model.displayName}」吗？`)) {
      return;
    }

    try {
      const response = await fetch(`/api/ai-services/models/${model.id}`, {
        method: "DELETE",
        credentials: "same-origin"
      });
      const result = (await response.json().catch(() => null)) as ApiResult<{ model?: ModelConfig }> | null;

      if (!response.ok) {
        setModelMessage(apiErrorMessage(result, "模型删除失败。"));
        return;
      }

      setModels((current) => current.filter((item) => item.id !== model.id));
      setModelMessage("模型已删除。");
    } catch {
      setModelMessage("服务不可达，请稍后重试。");
    }
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <CapabilityCard
          title="实时面试"
          items={["INTERVIEW_DIALOGUE", "INTERVIEW_OUTLINE", "INTERVIEW_FOLLOW_UP", "REPORT_ANALYSIS"]}
        />
        <CapabilityCard
          title="专业资料"
          items={["COMPANY_RESEARCH", "EMBEDDING", "SAFETY_REVIEW"]}
        />
        <CapabilityCard
          title="语音与数字人"
          id="digital-human"
          items={["SPEECH_TO_TEXT", "TEXT_TO_SPEECH", "DIGITAL_HUMAN_REALTIME", "DIGITAL_HUMAN_VIDEO"]}
          note="接口：POST /api/digital-human/render 与 /api/digital-human/speech"
        />
        <CapabilityCard
          title="行为分析"
          id="behavior-analysis"
          items={["VISION_BEHAVIOR_ANALYSIS"]}
          note="接口：POST /api/behavior-analysis"
        />
      </section>

      <section className="rounded-lg border border-line bg-panel p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-ink">模型推荐矩阵</h2>
            <p className="mt-1 text-sm text-muted">
              按能力配置默认模型。价格会随厂商调整，以下只作为选型参考，最终以控制台账单为准。
            </p>
          </div>
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-muted">
            更新日期 {modelRecommendationLastUpdated}
          </span>
        </div>
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {modelRecommendationGroups.map((group) => (
            <div key={group.title} className="rounded-md border border-line p-4">
              <h3 className="font-medium text-ink">{group.title}</h3>
              <p className="mt-1 text-xs leading-5 text-muted">{group.description}</p>
              <div className="mt-4 grid gap-3">
                {group.recommendations.map((recommendation) => (
                  <div key={`${recommendation.capability}-${recommendation.providerName}-${recommendation.modelName}`} className="rounded-md bg-slate-50 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-ink">
                          {capabilityLabels[recommendation.capability]} / {recommendation.providerName}
                        </p>
                        <p className="mt-1 break-all text-xs text-muted">{recommendation.modelName}</p>
                      </div>
                      <Button
                        className="min-h-8 px-3 py-1 text-xs"
                        type="button"
                        variant="secondary"
                        onClick={() => applyRecommendation(recommendation)}
                      >
                        添加参考
                      </Button>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted">{recommendation.fit}</p>
                    <p className="mt-2 text-xs leading-5 text-muted">{recommendation.priceNote}</p>
                    <p className="mt-2 text-xs leading-5 text-muted">{recommendation.howToUse}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

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
              <select
                name="providerType"
                className="rounded-md border border-line px-3 py-2"
                value={providerType}
                onChange={(event) => {
                  const nextType = event.target.value as AiProviderType;
                  setProviderType(nextType);
                  setBaseUrl(providerBaseUrlPresets[nextType] ?? "");
                }}
              >
                {aiProviderTypes.map((type) => (
                  <option key={type} value={type}>
                    {providerTypeLabels[type]}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="Base URL"
              name="baseUrl"
              placeholder="https://api.example.com/v1"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
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
            <Field
              label="显示名称"
              name="displayName"
              placeholder="DeepSeek Chat 报告分析"
              value={modelDraft.displayName}
              onChange={(event) => updateModelDraft("displayName", event.target.value)}
              required
            />
            <Field
              label="模型名称"
              name="modelName"
              placeholder="deepseek-chat / gpt-4.1-mini"
              value={modelDraft.modelName}
              onChange={(event) => updateModelDraft("modelName", event.target.value)}
              required
            />
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-ink">能力类型</span>
              <select
                name="capability"
                className="rounded-md border border-line px-3 py-2"
                value={modelDraft.capability}
                onChange={(event) => updateModelDraft("capability", event.target.value as AiCapability)}
              >
                {aiCapabilities.map((capability) => (
                  <option key={capability} value={capability}>
                    {capabilityLabels[capability]}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label="温度"
                name="temperature"
                type="number"
                step="0.1"
                value={modelDraft.temperature}
                onChange={(event) => updateModelDraft("temperature", Number(event.target.value))}
              />
              <Field
                label="最大 token"
                name="maxTokens"
                type="number"
                value={modelDraft.maxTokens}
                onChange={(event) => updateModelDraft("maxTokens", Number(event.target.value))}
              />
              <Field
                label="超时 ms"
                name="timeoutMs"
                type="number"
                value={modelDraft.timeoutMs}
                onChange={(event) => updateModelDraft("timeoutMs", Number(event.target.value))}
              />
            </div>
            <Field
              label="成本备注"
              name="costNote"
              placeholder="低成本 / 高质量 / 备用"
              value={modelDraft.costNote}
              onChange={(event) => updateModelDraft("costNote", event.target.value)}
            />
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
                <div className="mt-3 flex flex-wrap gap-2">
                  {!model.isDefault ? (
                    <Button className="min-h-8 gap-1 px-3 py-1 text-xs" variant="secondary" onClick={() => patchModel(model.id, { isDefault: true })}>
                      <Star className="h-3.5 w-3.5" aria-hidden="true" />
                      设为默认
                    </Button>
                  ) : null}
                  <Button
                    className="min-h-8 px-3 py-1 text-xs"
                    variant="secondary"
                    onClick={() => patchModel(model.id, { enabled: !model.enabled })}
                  >
                    {model.enabled ? "停用" : "启用"}
                  </Button>
                  <Button className="min-h-8 gap-1 px-3 py-1 text-xs" variant="ghost" onClick={() => deleteModel(model)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    删除
                  </Button>
                </div>
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

function CapabilityCard({
  title,
  items,
  id,
  note
}: {
  title: string;
  items: AiCapability[];
  id?: string;
  note?: string;
}) {
  return (
    <div id={id} className="rounded-lg border border-line bg-panel p-4 shadow-sm">
      <h2 className="font-semibold text-ink">{title}</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <span key={item} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-muted">
            {capabilityLabels[item]}
          </span>
        ))}
      </div>
      {note ? <p className="mt-3 text-xs leading-5 text-muted">{note}</p> : null}
    </div>
  );
}
