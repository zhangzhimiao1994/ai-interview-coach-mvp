import React from "react";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DigitalHumanVideoConfigPanel } from "@/components/admin/DigitalHumanVideoConfigPanel";

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let renderer: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

const modelOptions = [
  { id: "ling", displayName: "Lingmou preset", modelName: "lingmou-broadcast-video", providerType: "LINGMOU" },
  { id: "emo", displayName: "EMO preset", modelName: "emo-v1", providerType: "TONGYI" },
  { id: "custom", displayName: "Custom avatar", modelName: "avatar-v2", providerType: "LINGMOU" }
] as const;

describe("DigitalHumanVideoConfigPanel", () => {
  it("defaults to automatic race, synchronized profiles, and exposes provider/custom model options", () => {
    act(() => {
      renderer = TestRenderer.create(<DigitalHumanVideoConfigPanel initialConfig={null} models={[...modelOptions]} profiles={[]} storage={null} />);
    });
    const root = renderer!.root;
    expect(root.findByProps({ "aria-label": "Video runtime mode" }).props.value).toBe("AUTO_RACE");
    expect(root.findByProps({ "aria-label": "Synchronize interviewer profiles" }).props.checked).toBe(true);
    const runtimeOptions = root.findByProps({ "aria-label": "Video runtime mode" }).findAllByType("option").map((node) => node.props.value);
    expect(runtimeOptions).toEqual(["AUTO_RACE", "LINGMOU_ONLY", "EMO_ONLY"]);
    const modelText = JSON.stringify(renderer!.toJSON());
    expect(modelText).toContain("Lingmou preset");
    expect(modelText).toContain("EMO preset");
    expect(modelText).toContain("Custom avatar");
  });

  it("requires two different complete profiles when synchronization is disabled", async () => {
    act(() => {
      renderer = TestRenderer.create(<DigitalHumanVideoConfigPanel initialConfig={null} models={[...modelOptions]} profiles={[
        { id: "one", displayName: "Lin", complete: true, enabled: true },
        { id: "incomplete", displayName: "Qiao", complete: false, enabled: true }
      ]} storage={null} />);
    });
    await act(async () => {
      renderer!.root.findByProps({ "aria-label": "Synchronize interviewer profiles" }).props.onChange({ target: { checked: false } });
    });
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain("two distinct enabled complete profiles");
    expect(renderer!.root.findByProps({ type: "submit" }).props.disabled).toBe(true);
  });

  it("renders only credential previews and a paid-cost confirmation control", () => {
    act(() => {
      renderer = TestRenderer.create(<DigitalHumanVideoConfigPanel
        initialConfig={null}
        models={[...modelOptions]}
        profiles={[]}
        storage={{ id: "oss", displayName: "Private OSS", endpoint: "oss-cn-hangzhou.aliyuncs.com", bucket: "private-media", region: "cn-hangzhou", credentialsPreview: { accessKeyId: "LTAI****9xyz" }, enabled: true }}
      />);
    });
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain("LTAI****9xyz");
    expect(text).not.toMatch(/ciphertext|credentialsIv|credentialsTag|actual-secret-value/i);
    expect(renderer!.root.findByProps({ "aria-label": "Confirm paid Alibaba diagnostic" })).toBeTruthy();
    expect(text).toContain("may incur Alibaba charges");
  });

  it("saves OSS independently before profiles/runtime and then unlocks portrait upload", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => { requests.push(JSON.parse(String(init.body))); return Response.json({ storage: { id: "oss-new" } }); });
    act(() => { renderer = TestRenderer.create(<DigitalHumanVideoConfigPanel initialConfig={null} models={[...modelOptions]} profiles={[]} storage={null} />); });
    const root = renderer!.root;
    await act(async () => {
      root.findByProps({ "aria-label": "OSS endpoint" }).props.onChange({ target: { value: "oss-cn-hangzhou.aliyuncs.com" } });
      root.findByProps({ "aria-label": "OSS bucket" }).props.onChange({ target: { value: "private-bucket" } });
      root.findByProps({ name: "accessKeyId" }).props.onChange({ target: { value: "LTAI-example" } });
      root.findByProps({ name: "accessKeySecret" }).props.onChange({ target: { value: "secret-example" } });
    });
    await act(async () => {
      root.findAllByType("button").find((button) => button.props.children === "保存私有 OSS")!.props.onClick();
      await Promise.resolve(); await Promise.resolve();
    });
    expect(requests).toEqual([expect.objectContaining({ action: "SAVE_STORAGE", storage: expect.objectContaining({ bucket: "private-bucket" }) })]);
    expect(root.findByProps({ "aria-label": "Profile 1 portrait" }).props.disabled).toBe(false);
  });

  it("round-trips existing voice, nested style, mappings, ratio, and portrait", () => {
    act(() => { renderer = TestRenderer.create(<DigitalHumanVideoConfigPanel initialConfig={null} models={[...modelOptions]} profiles={[{ id: "p1", displayName: "林夏", complete: true, enabled: true, voice: "patient_voice", portraitAssetId: "portrait-1", style: { defaultInstruction: "耐心追问", speed: 0.88, intentVoices: { PRESSURE: "serious_voice" } }, lingmouMapping: { templateId: "tpl-1", audioVariableName: "audio", portraitVariableName: "portrait" }, emoMapping: { portraitWidth: 800, portraitHeight: 1000 }, providerRole: "PRIMARY" }]} storage={null} />); });
    const root = renderer!.root;
    expect(root.findByProps({ "aria-label": "Profile 1 voice" }).props.value).toBe("patient_voice");
    expect(root.findByProps({ "aria-label": "Profile 1 instruction" }).props.value).toBe("耐心追问");
    expect(root.findByProps({ "aria-label": "Profile 1 intent voices" }).props.value).toContain("serious_voice");
    expect(root.findByProps({ "aria-label": "Profile 1 portrait width" }).props.value).toBe("800");
  });

  it("adds a newly saved profile to the runtime dropdown and selects it immediately", async () => {
    vi.stubGlobal("fetch", async (url: string) => url.endsWith("/portrait") ? Response.json({ asset: { id: "portrait-new", width: 800, height: 1000 } }, { status: 201 }) : Response.json({ profile: { id: "profile-new" } }, { status: 201 }));
    act(() => { renderer = TestRenderer.create(<DigitalHumanVideoConfigPanel initialConfig={null} models={[...modelOptions]} profiles={[]} storage={{ id: "oss", displayName: "OSS", endpoint: "oss-cn-hangzhou.aliyuncs.com", bucket: "private-bucket", region: "cn-hangzhou", credentialsPreview: {}, enabled: true }} />); });
    const root = renderer!.root;
    await act(async () => { root.findAllByProps({ placeholder: "灵眸模板 ID" })[0].props.onChange({ target: { value: "tpl-new" } }); });
    await act(async () => { root.findByProps({ "aria-label": "Profile 1 portrait" }).props.onChange({ target: { files: [new File([new Uint8Array([1])], "portrait.png", { type: "image/png" })] } }); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { root.findAllByType("button").find((button) => renderedText(button) === "保存面试官 1")!.props.onClick(); await Promise.resolve(); await Promise.resolve(); });
    expect(root.findByProps({ "aria-label": "Primary interviewer profile" }).props.value).toBe("profile-new");
    expect(root.findByProps({ "aria-label": "Primary interviewer profile" }).findAllByType("option").map((option) => option.props.value)).toContain("profile-new");
  });
});

function renderedText(node: ReactTestInstance): string { return node.children.map((child) => typeof child === "string" ? child : renderedText(child)).join(""); }
