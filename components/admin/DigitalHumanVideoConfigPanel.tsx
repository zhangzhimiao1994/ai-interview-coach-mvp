"use client";

import React, { useMemo, useState, type FormEvent } from "react";

type ModelOption = { id: string; displayName: string; modelName: string; providerType: string };
type ProfileOption = { id: string; displayName: string; complete: boolean; enabled: boolean; voice?: string; portraitAssetId?: string | null; style?: Record<string, unknown>; lingmouMapping?: Record<string, unknown>; emoMapping?: Record<string, unknown>; providerRole?: string };
type StorageView = { id: string; displayName: string; endpoint: string; bucket: string; region: string | null; credentialsPreview: Record<string, string>; enabled: boolean };
type RuntimeView = { mode: "AUTO_RACE" | "LINGMOU_ONLY" | "EMO_ONLY"; synchronizeProfiles: boolean; primaryProfileId: string; secondaryProfileId: string | null; lingmouModelId: string; emoModelId: string };

export function DigitalHumanVideoConfigPanel({ initialConfig, models, profiles, storage }: { initialConfig: RuntimeView | null; models: ModelOption[]; profiles: ProfileOption[]; storage: StorageView | null }) {
  const lingModels = models.filter((model) => model.providerType === "LINGMOU");
  const emoModels = models.filter((model) => model.providerType === "TONGYI");
  const [mode, setMode] = useState(initialConfig?.mode ?? "AUTO_RACE");
  const [synchronize, setSynchronize] = useState(initialConfig?.synchronizeProfiles ?? true);
  const [primary, setPrimary] = useState(initialConfig?.primaryProfileId ?? profiles.find((profile) => profile.complete && profile.enabled)?.id ?? "");
  const [secondary, setSecondary] = useState(initialConfig?.secondaryProfileId ?? "");
  const [lingModel, setLingModel] = useState(initialConfig?.lingmouModelId ?? lingModels[0]?.id ?? "CUSTOM");
  const [emoModel, setEmoModel] = useState(initialConfig?.emoModelId ?? emoModels[0]?.id ?? "CUSTOM");
  const [message, setMessage] = useState("");
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [storageDraft, setStorageDraft] = useState({ displayName: storage?.displayName ?? "面试数字人私有 OSS", endpoint: storage?.endpoint ?? "", bucket: storage?.bucket ?? "", region: storage?.region ?? "cn-hangzhou" });
  const [savedStorageId, setSavedStorageId] = useState(storage?.id ?? "");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [accessKeySecret, setAccessKeySecret] = useState("");
  const [securityToken, setSecurityToken] = useState("");
  const [profileDrafts, setProfileDrafts] = useState(() => [0, 1].map((index) => profileDraft(profiles[index], index)));
  const complete = useMemo(() => {
    const values = profiles.filter((profile) => profile.complete && profile.enabled);
    for (const draft of profileDrafts) if (draft.id && draft.portraitAssetId && draft.voice && draft.templateId && draft.audioVariableName && !values.some(({ id }) => id === draft.id)) values.push({ id: draft.id, displayName: draft.displayName, complete: true, enabled: true });
    return values;
  }, [profileDrafts, profiles]);
  const profileInvalid = !synchronize && (!primary || !secondary || primary === secondary || !complete.some(({ id }) => id === primary) || !complete.some(({ id }) => id === secondary));
  const cannotSave = profileInvalid || !primary || !savedStorageId || lingModel === "CUSTOM" || emoModel === "CUSTOM";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (cannotSave) return;
    const response = await fetch("/api/ai-services/digital-human-video-runtime", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      runtime: { mode, maxWaitMs: 8000, lingmouPollMs: [3000, 6000], emoPollMs: [8000], synchronizeProfiles: synchronize, primaryProfileId: primary, secondaryProfileId: synchronize ? null : secondary, lingmouModelId: lingModel, emoModelId: emoModel },
      storage: null
    }) });
    setMessage(response.ok ? "Configuration saved locally." : "Configuration validation failed; the previous settings remain active.");
  }

  async function saveStorage() {
    if (!storageDraft.endpoint.trim() || !storageDraft.bucket.trim()) { setMessage("请填写 OSS endpoint 和 bucket。"); return; }
    if (Boolean(accessKeyId.trim()) !== Boolean(accessKeySecret.trim())) { setMessage("AccessKey ID 和 Secret 必须同时填写。"); return; }
    const credentials = accessKeyId.trim() && accessKeySecret.trim() ? { accessKeyId: accessKeyId.trim(), accessKeySecret: accessKeySecret.trim(), ...(securityToken.trim() ? { securityToken: securityToken.trim() } : {}) } : undefined;
    const response = await fetch("/api/ai-services/digital-human-video-runtime", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SAVE_STORAGE", storage: { ...(savedStorageId ? { id: savedStorageId } : {}), ...storageDraft, region: storageDraft.region.trim() || null, enabled: true, ...(credentials ? { credentials } : {}) } }) });
    const payload = await response.json().catch(() => null) as { storage?: { id?: string } } | null;
    if (response.ok && payload?.storage?.id) { setSavedStorageId(payload.storage.id); setAccessKeyId(""); setAccessKeySecret(""); setSecurityToken(""); setMessage("私有 OSS 已保存，可以上传人物图片。"); }
    else setMessage("OSS 配置校验失败，原配置保持不变。");
  }

  async function diagnose() {
    if (!confirmPaid) return;
    const response = await fetch("/api/admin/interviewer-profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "PAID_DIAGNOSTIC", providerKind: mode === "EMO_ONLY" ? "ALIBABA_EMO" : "LINGMOU_BROADCAST", confirmPaidRequest: true }) });
    setMessage(response.ok ? "Paid diagnostic completed." : "Paid diagnostic failed safely.");
  }

  async function saveProfile(index: number) {
    const draft = profileDrafts[index];
    let style: Record<string, unknown>;
    try { style = { defaultInstruction: draft.defaultInstruction, speed: Number(draft.speed), stageVoices: parseMap(draft.stageVoices), intentVoices: parseMap(draft.intentVoices), signalVoices: parseMap(draft.signalVoices) }; }
    catch { setMessage("音色映射必须是有效的 JSON 对象。"); return; }
    const response = await fetch("/api/admin/interviewer-profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SAVE_PROFILE", ...(draft.id ? { id: draft.id } : {}), displayName: draft.displayName, voice: draft.voice, style, portraitAssetId: draft.portraitAssetId, lingmouMapping: { templateId: draft.templateId, audioVariableName: draft.audioVariableName, portraitVariableName: draft.portraitVariableName || null }, emoMapping: { portraitWidth: Number(draft.portraitWidth), portraitHeight: Number(draft.portraitHeight) }, providerRole: index === 0 ? "PRIMARY" : "SECONDARY", enabled: true }) });
    const payload = await response.json().catch(() => null) as { profile?: { id?: string } } | null;
    if (response.ok && payload?.profile?.id) { updateDraft(index, { id: payload.profile.id }); if (index === 0) setPrimary(payload.profile.id); else setSecondary(payload.profile.id); setMessage(`面试官 ${index + 1} 已保存。`); }
    else setMessage(`面试官 ${index + 1} 配置校验失败。`);
  }
  async function uploadPortrait(index: number, file: File | undefined) {
    if (!file) return; const body = new FormData(); body.set("portrait", file);
    const response = await fetch("/api/admin/interviewer-profiles/portrait", { method: "POST", body });
    const payload = await response.json().catch(() => null) as { asset?: { id?: string; width?: number; height?: number } } | null;
    if (response.ok && payload?.asset?.id) updateDraft(index, { portraitAssetId: payload.asset.id, portraitWidth: String(payload.asset.width ?? 400), portraitHeight: String(payload.asset.height ?? 400) });
    else setMessage("人物图片不符合格式、尺寸或私有存储要求。");
  }
  function updateDraft(index: number, values: Partial<(typeof profileDrafts)[number]>) { setProfileDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...values } : item)); }

  return <section className="rounded-lg border border-line bg-panel p-5 shadow-sm">
    <h2 className="text-lg font-semibold text-ink">阿里云双路数字人</h2>
    <p className="mt-1 text-sm text-muted">配置保存只做本地校验，不调用付费接口。密钥只写入、不回显。</p>
    <form className="mt-5 grid gap-4" onSubmit={save}>
      <label>运行模式<select aria-label="Video runtime mode" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="AUTO_RACE">双路竞速（默认）</option><option value="LINGMOU_ONLY">仅灵眸</option><option value="EMO_ONLY">仅 EMO</option></select></label>
      <label>灵眸模型<select aria-label="Lingmou video model" value={lingModel} onChange={(event) => setLingModel(event.target.value)}>{lingModels.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}<option value="CUSTOM">自定义（请先在上方模型配置中新建兼容模型）</option></select></label>
      <label>EMO 模型<select aria-label="EMO video model" value={emoModel} onChange={(event) => setEmoModel(event.target.value)}>{emoModels.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}<option value="CUSTOM">自定义（请先在上方模型配置中新建兼容模型）</option></select></label>
      <label><input aria-label="Synchronize interviewer profiles" type="checkbox" checked={synchronize} onChange={(event) => setSynchronize(event.target.checked)} /> Synchronize interviewer profiles</label>
      <label>Primary profile<select aria-label="Primary interviewer profile" value={primary} onChange={(event) => setPrimary(event.target.value)}><option value="">Select</option>{complete.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}</select></label>
      {!synchronize ? <><label>Secondary profile<select aria-label="Secondary interviewer profile" value={secondary} onChange={(event) => setSecondary(event.target.value)}><option value="">Select</option>{complete.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}</select></label>{profileInvalid ? <p role="alert">Select two distinct enabled complete profiles.</p> : null}</> : null}
      <fieldset className="grid gap-2"><legend>私有 OSS 存储（请先保存）</legend><input aria-label="OSS display name" value={storageDraft.displayName} onChange={(event) => setStorageDraft((current) => ({ ...current, displayName: event.target.value }))} /><input aria-label="OSS endpoint" placeholder="oss-cn-hangzhou.aliyuncs.com" value={storageDraft.endpoint} onChange={(event) => setStorageDraft((current) => ({ ...current, endpoint: event.target.value }))} /><input aria-label="OSS bucket" placeholder="private-bucket" value={storageDraft.bucket} onChange={(event) => setStorageDraft((current) => ({ ...current, bucket: event.target.value }))} /><input aria-label="OSS region" value={storageDraft.region ?? ""} onChange={(event) => setStorageDraft((current) => ({ ...current, region: event.target.value }))} /><p>{storage?.credentialsPreview.accessKeyId ?? (savedStorageId ? "密钥已保存" : "尚未配置密钥")}</p><input name="accessKeyId" type="password" autoComplete="off" placeholder="AccessKey ID（留空则保留原值）" value={accessKeyId} onChange={(event) => setAccessKeyId(event.target.value)} /><input name="accessKeySecret" type="password" autoComplete="new-password" placeholder="AccessKey Secret（留空则保留原值）" value={accessKeySecret} onChange={(event) => setAccessKeySecret(event.target.value)} /><input name="securityToken" type="password" autoComplete="off" placeholder="STS Token（可选）" value={securityToken} onChange={(event) => setSecurityToken(event.target.value)} /><button type="button" onClick={() => void saveStorage()}>保存私有 OSS</button></fieldset>
      <button type="submit" disabled={cannotSave}>Save video configuration</button>
    </form>
    <div className="mt-5 grid gap-4 xl:grid-cols-2">{profileDrafts.map((draft, index) => <fieldset key={index} className="grid gap-2 rounded-md border border-line p-3"><legend>面试官 {index + 1}</legend><input aria-label={`Profile ${index + 1} display name`} placeholder="显示名称" value={draft.displayName} onChange={(event) => updateDraft(index, { displayName: event.target.value })} /><input aria-label={`Profile ${index + 1} voice`} placeholder="音色，例如 longanhuan_v3.6" value={draft.voice} onChange={(event) => updateDraft(index, { voice: event.target.value })} /><textarea aria-label={`Profile ${index + 1} instruction`} placeholder="自然语言语气，例如：专业、耐心，必要时放慢语速" value={draft.defaultInstruction} onChange={(event) => updateDraft(index, { defaultInstruction: event.target.value })} /><input aria-label={`Profile ${index + 1} speed`} type="number" min="0.5" max="2" step="0.05" value={draft.speed} onChange={(event) => updateDraft(index, { speed: event.target.value })} /><textarea aria-label={`Profile ${index + 1} stage voices`} placeholder='阶段音色 JSON，如 {"WARM_UP":"warm_voice"}' value={draft.stageVoices} onChange={(event) => updateDraft(index, { stageVoices: event.target.value })} /><textarea aria-label={`Profile ${index + 1} intent voices`} placeholder='问题意图音色 JSON，如 {"PRESSURE":"serious_voice"}' value={draft.intentVoices} onChange={(event) => updateDraft(index, { intentVoices: event.target.value })} /><textarea aria-label={`Profile ${index + 1} signal voices`} placeholder='行为信号音色 JSON，如 {"HESITATION":"patient_voice"}' value={draft.signalVoices} onChange={(event) => updateDraft(index, { signalVoices: event.target.value })} /><input placeholder="灵眸模板 ID" value={draft.templateId} onChange={(event) => updateDraft(index, { templateId: event.target.value })} /><input placeholder="灵眸音频变量名" value={draft.audioVariableName} onChange={(event) => updateDraft(index, { audioVariableName: event.target.value })} /><input placeholder="灵眸人物图片变量名（可选）" value={draft.portraitVariableName} onChange={(event) => updateDraft(index, { portraitVariableName: event.target.value })} /><div className="grid grid-cols-2 gap-2"><input type="number" min="400" max="7000" aria-label={`Profile ${index + 1} portrait width`} value={draft.portraitWidth} onChange={(event) => updateDraft(index, { portraitWidth: event.target.value })} /><input type="number" min="400" max="7000" aria-label={`Profile ${index + 1} portrait height`} value={draft.portraitHeight} onChange={(event) => updateDraft(index, { portraitHeight: event.target.value })} /></div><input aria-label={`Profile ${index + 1} portrait`} type="file" accept="image/png,image/jpeg" disabled={!savedStorageId} onChange={(event) => void uploadPortrait(index, event.target.files?.[0])} /><p>{draft.portraitAssetId ? "人物图片已私有保存" : savedStorageId ? "请上传人物图片（400–7000 像素）" : "请先保存私有 OSS"}</p><button type="button" onClick={() => void saveProfile(index)}>保存面试官 {index + 1}</button></fieldset>)}</div>
    <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-3"><label><input type="checkbox" aria-label="Confirm paid Alibaba diagnostic" checked={confirmPaid} onChange={(event) => setConfirmPaid(event.target.checked)} /> I understand this diagnostic may incur Alibaba charges.</label><button type="button" disabled={!confirmPaid} onClick={() => void diagnose()}>Run paid diagnostic</button></div>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}

function parseMap(value: string) { const parsed = JSON.parse(value || "{}"); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("VOICE_MAP_INVALID"); return parsed; }
function profileDraft(profile: ProfileOption | undefined, index: number) { return { id: profile?.id, displayName: profile?.displayName ?? (index === 0 ? "主面试官" : "追问面试官"), voice: profile?.voice ?? "longanhuan_v3.6", portraitAssetId: profile?.portraitAssetId ?? "", defaultInstruction: String(profile?.style?.defaultInstruction ?? "保持专业、自然，并根据问题和候选人状态调整语气。"), speed: String(profile?.style?.speed ?? 0.95), stageVoices: JSON.stringify(profile?.style?.stageVoices ?? {}), intentVoices: JSON.stringify(profile?.style?.intentVoices ?? {}), signalVoices: JSON.stringify(profile?.style?.signalVoices ?? {}), templateId: String(profile?.lingmouMapping?.templateId ?? ""), audioVariableName: String(profile?.lingmouMapping?.audioVariableName ?? "audioUrl"), portraitVariableName: String(profile?.lingmouMapping?.portraitVariableName ?? "portraitUrl"), portraitWidth: String(profile?.emoMapping?.portraitWidth ?? 400), portraitHeight: String(profile?.emoMapping?.portraitHeight ?? 400) }; }
