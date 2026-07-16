# AI 配置诊断与 Docker 同步实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为所有 AI 能力提供安全的配置摘要、管理员主动触发的文本模型真实连通测试，以及与源码同分支构建的 Docker/Linux 验证契约。

**Architecture:** 将公共响应类型、OpenAI-compatible 最小探测、配置诊断服务、API 路由和后台展示拆成独立单元。诊断服务只按 `isSelected` 读取当前模型，解密仅用于内存内判断必填凭据，不向响应返回密钥或上游正文；文本能力可主动执行极低 token 请求，其余能力在适配器落地前明确返回 `CONFIGURED_NOT_ADAPTED`。

**Tech Stack:** Next.js 15 App Router、React 19、TypeScript、Prisma 5、Zod、Vitest、Docker Compose、POSIX shell。

---

## 文件结构

- `lib/ai/diagnosticTypes.ts`：客户端和服务端共享的诊断状态、稳定代码、响应结构及文本能力集合。
- `lib/ai/openAiCompatibleProvider.ts`：在现有请求实现旁增加最小真实探测，并把上游失败归一化为安全代码。
- `lib/ai/diagnostics.ts`：读取当前模型、解析配置和凭据、执行能力规则及可选真实探测。
- `lib/validators/aiDiagnostics.ts`：严格校验单能力诊断请求。
- `app/api/ai-services/diagnostics/route.ts`：实现 GET 全量摘要和 POST 单项诊断。
- `components/admin/AiDiagnosticsPanel.tsx`：展示状态并主动触发配置或真实检查。
- `app/admin/ai-services/page.tsx`：服务端加载无付费调用的诊断摘要。
- `tests/unit/ai-diagnostics.test.ts`：覆盖选模、必填参数、安全脱敏和真实探测编排。
- `tests/unit/ai-diagnostics-route.test.ts`：覆盖 GET/POST 协议和输入校验。
- `tests/unit/ai-diagnostics-ui.test.tsx`：覆盖后台状态、模型信息和操作按钮。
- `tests/unit/openai-compatible-provider.test.ts`：覆盖最小探测请求及 401、404、429、5xx、超时映射。
- `tests/unit/linux-deployment-package.test.ts`：覆盖诊断路由进入 Docker 构建上下文且健康检查保持独立。
- `docs/linux-deployment.md`：补充源码与 Docker 更新、诊断验证命令和付费调用边界。

### Task 1: 诊断领域逻辑与 API

**Files:**
- Create: `lib/ai/diagnosticTypes.ts`
- Create: `lib/ai/diagnostics.ts`
- Create: `lib/validators/aiDiagnostics.ts`
- Create: `app/api/ai-services/diagnostics/route.ts`
- Modify: `lib/ai/openAiCompatibleProvider.ts`
- Test: `tests/unit/ai-diagnostics.test.ts`
- Test: `tests/unit/ai-diagnostics-route.test.ts`
- Modify test: `tests/unit/openai-compatible-provider.test.ts`

- [ ] **Step 1: 先写公共协议和 API 的失败测试**

在 `tests/unit/ai-diagnostics-route.test.ts` 中 mock `@/lib/ai/diagnostics`，写出以下断言：

```ts
it("returns every capability summary without starting live checks", async () => {
  getAllAiDiagnostics.mockResolvedValue([diagnostic({ capability: "INTERVIEW_DIALOGUE" })]);
  const { GET } = await import("@/app/api/ai-services/diagnostics/route");
  const response = await GET();
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ diagnostics: [expect.objectContaining({
    capability: "INTERVIEW_DIALOGUE",
    checkMode: "CONFIG"
  })] });
});

it("validates and runs one requested live check", async () => {
  diagnoseAiCapability.mockResolvedValue(diagnostic({ status: "AVAILABLE", checkMode: "LIVE" }));
  const { POST } = await import("@/app/api/ai-services/diagnostics/route");
  const response = await POST(new Request("http://localhost/api/ai-services/diagnostics", {
    method: "POST",
    body: JSON.stringify({ capability: "INTERVIEW_DIALOGUE", liveCheck: true })
  }));
  expect(response.status).toBe(200);
  expect(diagnoseAiCapability).toHaveBeenCalledWith("INTERVIEW_DIALOGUE", { liveCheck: true });
});

it("rejects unknown capabilities", async () => {
  const { POST } = await import("@/app/api/ai-services/diagnostics/route");
  const response = await POST(new Request("http://localhost/api/ai-services/diagnostics", {
    method: "POST",
    body: JSON.stringify({ capability: "UNKNOWN", liveCheck: true })
  }));
  expect(response.status).toBe(400);
});
```

- [ ] **Step 2: 运行 API 测试并确认因路由不存在而失败**

Run: `npx vitest run tests/unit/ai-diagnostics-route.test.ts`

Expected: FAIL，错误包含无法解析 `app/api/ai-services/diagnostics/route`。

- [ ] **Step 3: 定义稳定诊断协议和请求校验**

`lib/ai/diagnosticTypes.ts` 定义：

```ts
export const aiDiagnosticStatuses = [
  "AVAILABLE", "CONFIG_VALID", "CONFIGURED_NOT_ADAPTED",
  "NOT_SELECTED", "MISCONFIGURED", "UNREACHABLE"
] as const;

export const textDiagnosticCapabilities = [
  "INTERVIEW_DIALOGUE", "INTERVIEW_OUTLINE", "INTERVIEW_FOLLOW_UP",
  "REPORT_ANALYSIS", "COMPANY_RESEARCH", "SAFETY_REVIEW"
] as const;

export type AiDiagnosticStatus = (typeof aiDiagnosticStatuses)[number];
export type AiDiagnosticCheckMode = "CONFIG" | "LIVE";

export type AiDiagnosticResult = {
  capability: AiCapability;
  providerName: string | null;
  modelDisplayName: string | null;
  modelName: string | null;
  checkMode: AiDiagnosticCheckMode;
  status: AiDiagnosticStatus;
  code: string;
  latencyMs: number;
  message: string;
  checkedAt: string;
};
```

`lib/validators/aiDiagnostics.ts` 使用严格 Zod 对象：

```ts
export const aiDiagnosticRequestSchema = z.object({
  capability: z.enum(aiCapabilities),
  liveCheck: z.boolean()
}).strict();

export function parseAiDiagnosticRequest(input: unknown) {
  return aiDiagnosticRequestSchema.parse(input);
}
```

- [ ] **Step 4: 实现 GET/POST 薄路由并跑绿 API 测试**

`app/api/ai-services/diagnostics/route.ts` 只返回安全诊断结构：

```ts
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ diagnostics: await getAllAiDiagnostics() });
  } catch (error) {
    return postErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = parseAiDiagnosticRequest(await request.json());
    const diagnostic = await diagnoseAiCapability(input.capability, {
      liveCheck: input.liveCheck
    });
    return NextResponse.json({ diagnostic });
  } catch (error) {
    return postErrorResponse(error);
  }
}
```

Run: `npx vitest run tests/unit/ai-diagnostics-route.test.ts`

Expected: PASS。

- [ ] **Step 5: 先写 OpenAI-compatible 最小真实探测的失败测试**

在 `tests/unit/openai-compatible-provider.test.ts` 增加表格测试，确认请求使用固定诊断提示、`temperature: 0`、`max_tokens: 1` 且不携带 `response_format`；再分别让 fetch 返回 401、404、429、503，以及抛出名为 `AbortError` 的异常，断言结果只包含以下稳定代码而不包含上游正文：

```ts
expect(result).toEqual(expect.objectContaining({
  ok: false,
  code: expectedCode
}));
expect(JSON.stringify(result)).not.toContain("upstream-secret-sentinel");
```

映射为：`AUTHENTICATION_FAILED`、`MODEL_NOT_FOUND`、`RATE_LIMITED`、`UPSTREAM_UNAVAILABLE`、`TIMEOUT`。

- [ ] **Step 6: 运行探测测试并确认导出不存在**

Run: `npx vitest run tests/unit/openai-compatible-provider.test.ts`

Expected: FAIL，错误指向 `probeOpenAiCompatibleModel` 尚未导出。

- [ ] **Step 7: 用现有 executeRequest 实现最小探测**

在 `lib/ai/openAiCompatibleProvider.ts` 导出安全结果联合类型，并复用现有 `executeRequest`：

```ts
export type OpenAiCompatibleProbeResult =
  | { ok: true; code: "LIVE_CHECK_SUCCEEDED"; message: string }
  | { ok: false; code: "AUTHENTICATION_FAILED" | "MODEL_NOT_FOUND" |
      "RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" | "TIMEOUT" |
      "NETWORK_ERROR" | "INVALID_RESPONSE" | "UPSTREAM_REQUEST_FAILED";
      message: string };

export async function probeOpenAiCompatibleModel(
  config: OpenAiCompatibleProviderConfig
): Promise<OpenAiCompatibleProbeResult> {
  try {
    await executeRequest(
      { ...config, temperature: 0, maxTokens: 1 },
      [
        { role: "system", content: "Connection diagnostic. Reply with OK." },
        { role: "user", content: "OK" }
      ],
      false
    );
    return { ok: true, code: "LIVE_CHECK_SUCCEEDED", message: "真实连通测试通过。" };
  } catch (error) {
    return safeProbeFailure(error);
  }
}
```

`safeProbeFailure` 仅根据私有 HTTP 状态、`AbortError`、`TypeError` 或 `AiProviderError` 分类，所有 message 使用固定中文文案，不拼接 `responseBody` 或原始异常消息。

Run: `npx vitest run tests/unit/openai-compatible-provider.test.ts`

Expected: PASS。

- [ ] **Step 8: 先写配置诊断服务的失败测试**

在 `tests/unit/ai-diagnostics.test.ts` 使用注入的 `findModel`、`probeTextModel` 和内存加密凭据，逐项覆盖：

```ts
it.each([
  ["no selected model", null, "NOT_SELECTED", "MODEL_NOT_SELECTED"],
  ["disabled model", selectedModel({ enabled: false }), "MISCONFIGURED", "MODEL_DISABLED"],
  ["disabled provider", selectedModel({ provider: { enabled: false } }), "MISCONFIGURED", "PROVIDER_DISABLED"]
])("diagnoses %s", async (_name, model, status, code) => {
  const result = await diagnoseAiCapability("INTERVIEW_DIALOGUE", {
    liveCheck: false,
    dependencies: dependencies({ model })
  });
  expect(result).toMatchObject({ status, code });
});
```

再覆盖以下行为：

- 查询条件只包含 `isSelected: true`，不使用 `isDefault`；
- 模型名称、HTTP(S) Base URL、凭据包、provider/model settings 的缺失或损坏返回安全 `MISCONFIGURED`；
- 阿里 ASR 接受主 API Key 或 `asrApiKey`，并要求 language/sampleRate/encoding；
- 阿里 TTS 要求主 API Key、voice/sampleRate/format；
- 阿里实时数字人要求主 API Key、rtcAppId、rtcAppKey、avatarId、rtcMode；
- 阿里行为分析要求主 API Key、0 到 1 的 minimumConfidence、正数 frameIntervalMs 和正整数 maxFrames；
- 配置检查从不调用 `probeTextModel`；
- 文本 `liveCheck: true` 把探测成功映射为 `AVAILABLE`，失败映射为 `UNREACHABLE`；
- 非文本能力配置完整时返回 `CONFIGURED_NOT_ADAPTED` 且不发外部请求；
- 返回 JSON 不包含 API Key、RTC Key、密文、IV、Tag、配置损坏哨兵或上游正文。

- [ ] **Step 9: 运行诊断服务测试并确认模块不存在**

Run: `npx vitest run tests/unit/ai-diagnostics.test.ts`

Expected: FAIL，错误指向 `lib/ai/diagnostics` 尚未实现。

- [ ] **Step 10: 实现诊断服务的最小规则**

`lib/ai/diagnostics.ts` 提供以下边界：

```ts
export type DiagnoseAiCapabilityOptions = {
  liveCheck: boolean;
  dependencies?: Partial<AiDiagnosticDependencies>;
};

export async function findDiagnosticModel(capability: AiCapability) {
  return prisma.aiModelConfig.findFirst({
    where: { capability, isSelected: true },
    include: { provider: true }
  });
}

export async function diagnoseAiCapability(
  capability: AiCapability,
  options: DiagnoseAiCapabilityOptions
): Promise<AiDiagnosticResult>;

export async function getAllAiDiagnostics(): Promise<AiDiagnosticResult[]> {
  return Promise.all(aiCapabilities.map((capability) =>
    diagnoseAiCapability(capability, { liveCheck: false })
  ));
}
```

实现顺序固定为：读取当前选择模型 → 检查模型/服务商启用 → 安全解析 settings → 校验/解密完整凭据包 → 执行通用和阿里专属规则 → 配置模式返回 → 文本能力主动探测或非文本能力返回未适配。捕获数据库、解析、解密和探测异常时只返回固定 code/message；任何错误路径都不得把原始值插入 message。

- [ ] **Step 11: 跑阶段 1 全部相关测试、全量测试和类型检查**

Run: `npx vitest run tests/unit/ai-diagnostics.test.ts tests/unit/ai-diagnostics-route.test.ts tests/unit/openai-compatible-provider.test.ts`

Expected: PASS。

Run: `npm test`

Expected: 所有测试文件和测试项通过。

Run: `npx tsc --noEmit`

Expected: exit 0。

- [ ] **Step 12: 检查范围、提交并推送阶段 1**

```bash
git status -sb
git diff --check
git add lib/ai/diagnosticTypes.ts lib/ai/diagnostics.ts lib/ai/openAiCompatibleProvider.ts lib/validators/aiDiagnostics.ts app/api/ai-services/diagnostics/route.ts tests/unit/ai-diagnostics.test.ts tests/unit/ai-diagnostics-route.test.ts tests/unit/openai-compatible-provider.test.ts
git commit -m "add AI configuration diagnostics API"
git push origin feature/alibaba-multimodal-integration
```

### Task 2: 后台诊断面板

**Files:**
- Create: `components/admin/AiDiagnosticsPanel.tsx`
- Modify: `app/admin/ai-services/page.tsx`
- Test: `tests/unit/ai-diagnostics-ui.test.tsx`

- [ ] **Step 1: 先写后台面板失败测试**

使用 `renderToStaticMarkup` 传入文本 `CONFIG_VALID`、未选择 `NOT_SELECTED` 和多媒体 `CONFIGURED_NOT_ADAPTED` 三个结果，断言：

```ts
expect(markup).toContain("配置诊断");
expect(markup).toContain("检查配置");
expect(markup).toContain("真实连通测试");
expect(markup).toContain("真实测试（当前仅配置）");
expect(markup).toContain("已配置，等待适配器");
expect(markup).toContain("不会自动触发付费请求");
expect(markup).not.toContain("ciphertext");
```

- [ ] **Step 2: 运行 UI 测试并确认组件不存在**

Run: `npx vitest run tests/unit/ai-diagnostics-ui.test.tsx`

Expected: FAIL，错误指向 `AiDiagnosticsPanel` 尚未实现。

- [ ] **Step 3: 实现独立客户端诊断面板**

`AiDiagnosticsPanel` 接收 `initialDiagnostics: AiDiagnosticResult[]`，使用按能力布尔表维护请求中状态，保证只禁用正在检查的能力按钮。按钮调用：

```ts
const response = await fetch("/api/ai-services/diagnostics", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ capability, liveCheck })
});
const payload = await response.json();
if (!response.ok || !payload.diagnostic) {
  throw new Error("diagnostic request failed");
}
setDiagnostics((current) => current.map((item) =>
  item.capability === capability ? payload.diagnostic : item
));
```

catch 分支统一显示“检查失败，请稍后重试。”，不渲染服务端原始异常。文本能力显示“真实连通测试”；非文本能力显示“真实测试（当前仅配置）”，仍提交 `liveCheck: true`，由服务端明确返回未适配且不触发外部调用。

- [ ] **Step 4: 服务端首屏只读取配置摘要**

在 `app/admin/ai-services/page.tsx` 的现有 `Promise.all` 中加入 `getAllAiDiagnostics()`，并在配置表单前渲染：

```tsx
<AiDiagnosticsPanel initialDiagnostics={diagnostics} />
<AiServiceConfigPanel initialProviders={providers} initialModels={models} />
```

首屏调用只走 `liveCheck: false`，不得执行付费请求。

- [ ] **Step 5: 跑 UI、全量测试、类型检查和生产构建**

Run: `npx vitest run tests/unit/ai-diagnostics-ui.test.tsx tests/unit/ai-service-selection-ui.test.tsx`

Expected: PASS。

Run: `npm test`

Expected: 所有测试通过。

Run: `npx tsc --noEmit`

Expected: exit 0。

Run: `npm run build`

Expected: Next.js 生产构建成功，路由清单包含 `/api/ai-services/diagnostics`。

- [ ] **Step 6: 检查范围、提交并推送阶段 2**

```bash
git status -sb
git diff --check
git add components/admin/AiDiagnosticsPanel.tsx app/admin/ai-services/page.tsx tests/unit/ai-diagnostics-ui.test.tsx
git commit -m "add AI diagnostics admin panel"
git push origin feature/alibaba-multimodal-integration
```

### Task 3: Docker/Linux 同步契约与发布验证

**Files:**
- Modify: `tests/unit/linux-deployment-package.test.ts`
- Modify: `docs/linux-deployment.md`
- Verify: `.dockerignore`
- Verify: `Dockerfile`
- Verify: `docker-compose.yml`

- [ ] **Step 1: 先写 Docker 同步契约失败测试**

在 `tests/unit/linux-deployment-package.test.ts` 增加：

```ts
it("packages the diagnostics API and admin assets in the Docker build context", () => {
  expect(existsSync(join(root, "app/api/ai-services/diagnostics/route.ts"))).toBe(true);
  expect(existsSync(join(root, "components/admin/AiDiagnosticsPanel.tsx"))).toBe(true);
  expect(readWorkspaceFile("Dockerfile")).toContain("COPY . .");
  const dockerIgnore = readWorkspaceFile(".dockerignore");
  expect(dockerIgnore).not.toMatch(/^app(?:\/|$)/m);
  expect(dockerIgnore).not.toMatch(/^components(?:\/|$)/m);
  expect(dockerIgnore).not.toMatch(/^lib(?:\/|$)/m);
});

it("documents authenticated diagnostics after source and Docker updates", () => {
  const docs = readWorkspaceFile("docs/linux-deployment.md");
  expect(docs).toContain("git pull");
  expect(docs).toContain("docker compose up -d --build");
  expect(docs).toContain("/api/ai-services/diagnostics");
  expect(docs).toContain("真实连通测试不会自动执行");
});
```

- [ ] **Step 2: 运行部署契约并确认文档断言失败**

Run: `npx vitest run tests/unit/linux-deployment-package.test.ts`

Expected: FAIL，缺少诊断更新与验证说明。

- [ ] **Step 3: 同步 Linux 与 Docker 更新文档**

在 `docs/linux-deployment.md` 增加“更新与配置诊断”章节，明确写出原生源码更新：

```bash
git switch feature/alibaba-multimodal-integration
git pull
npm ci
npm run db:generate
npm run db:migrate:deploy
npm run build
```

Docker 更新必须从同一工作区执行：

```bash
git switch feature/alibaba-multimodal-integration
git pull
docker compose up -d --build
docker compose ps
```

受 Basic Auth 保护的无付费摘要验证：

```bash
curl -u "$ADMIN_USERNAME:$ADMIN_PASSWORD" \
  http://127.0.0.1:3000/api/ai-services/diagnostics
```

文档同时说明 `/api/health` 仍是公开就绪检查；诊断端点不是健康检查；真实连通测试不会自动执行，只能由管理员在后台主动触发；不得使用 `docker compose down -v`。

- [ ] **Step 4: 跑绿部署契约并检查 Compose 配置**

Run: `npx vitest run tests/unit/linux-deployment-package.test.ts`

Expected: PASS。

Run: `docker compose config`

Expected: exit 0，服务仍挂载 `app-data:/app/data`，健康检查仍指向 `/api/health`。

- [ ] **Step 5: 执行完整源码与 Docker 验证**

Run: `npm test`

Expected: 所有测试通过。

Run: `npx tsc --noEmit`

Expected: exit 0。

Run: `npm run build`

Expected: Next.js 生产构建成功并包含诊断路由。

Run: `docker compose build interview-coach`

Expected: Docker 镜像从当前提交工作区构建成功，构建过程完成 Prisma generate 与 Next.js build。如果当前环境没有 Docker Engine，只记录明确环境阻塞，不把结构契约冒充为镜像实测。

- [ ] **Step 6: 逐项复核设计、安全边界和 Git 差异**

```bash
git status -sb
git diff --check
git diff -- .dockerignore Dockerfile docker-compose.yml docs/linux-deployment.md tests/unit/linux-deployment-package.test.ts
```

确认响应和文档没有密钥、数据库、候选人数据或上游错误正文，Docker 与源码来自同一分支，且 `/api/health` 没有被诊断接口替换。

- [ ] **Step 7: 提交并推送阶段 3**

```bash
git add docs/linux-deployment.md tests/unit/linux-deployment-package.test.ts
git commit -m "sync diagnostics with Docker deployment"
git push origin feature/alibaba-multimodal-integration
```
