# AI 数字人面试训练辅导 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable service-delivery MVP where a service provider can create candidates and training tasks, candidates can complete a simulated AI digital-human interview, and the system can generate a structured coaching report.

**Architecture:** Use a web-first full-stack app with a service backend, candidate practice flow, local persistence, and AI capability adapters. The MVP uses mock AI, speech, and digital-human providers behind stable interfaces, so real providers can be added without changing product workflows.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, SQLite for local MVP storage, Tailwind CSS, Vitest, Playwright, Zod.

---

## Scope

This plan implements a testable MVP vertical slice, not the full long-term platform.

Included in this plan:

- Service backend UI for candidates, templates, and training tasks.
- Candidate practice link and interview room.
- Configurable training stages.
- Interviewer templates and interviewer groups.
- Mock AI orchestration layer with provider adapters.
- Transcript capture and coaching report generation.
- Local database persistence with Prisma and SQLite.
- Unit tests and Playwright smoke tests.

Deferred after MVP:

- Real high-fidelity digital human provider.
- Real-time streaming voice integration.
- Native mobile app.
- Payment, contract, invoice, and SaaS tenant billing.
- Deep facial expression or posture analysis.
- Complex multi-role enterprise permissions.

## Proposed File Structure

Create a new Next.js application in the current workspace root.

```text
app/
  layout.tsx
  page.tsx
  admin/
    page.tsx
    candidates/page.tsx
    templates/page.tsx
    tasks/new/page.tsx
    tasks/[taskId]/page.tsx
    reports/[sessionId]/page.tsx
  practice/
    [taskId]/page.tsx
    [taskId]/room/page.tsx
    [taskId]/report/page.tsx
  api/
    candidates/route.ts
    templates/route.ts
    tasks/route.ts
    tasks/[taskId]/route.ts
    sessions/route.ts
    sessions/[sessionId]/answer/route.ts
    sessions/[sessionId]/complete/route.ts
components/
  admin/
    CandidateForm.tsx
    TemplateManager.tsx
    TrainingTaskForm.tsx
    ReportView.tsx
  practice/
    PracticeEntry.tsx
    InterviewRoom.tsx
    StageTimeline.tsx
    CandidateReport.tsx
  ui/
    Button.tsx
    Card.tsx
    Field.tsx
lib/
  ai/
    index.ts
    types.ts
    mockProvider.ts
    orchestrator.ts
  db/
    prisma.ts
    seed.ts
  domain/
    stages.ts
    interviewerTemplates.ts
    reports.ts
  validators/
    candidate.ts
    template.ts
    task.ts
prisma/
  schema.prisma
tests/
  unit/
    stages.test.ts
    orchestrator.test.ts
    reports.test.ts
  e2e/
    mvp-flow.spec.ts
```

Responsibilities:

- `app/admin/*`: service provider workflows.
- `app/practice/*`: candidate-facing workflows.
- `app/api/*`: thin HTTP handlers that validate input and call domain services.
- `components/admin/*`: focused backend UI components.
- `components/practice/*`: focused candidate practice UI components.
- `lib/ai/*`: provider-neutral AI interfaces and mock provider.
- `lib/domain/*`: stage configuration, interviewer template defaults, and report logic.
- `lib/validators/*`: request validation with Zod.
- `prisma/schema.prisma`: persisted MVP data model.
- `tests/unit/*`: domain and AI orchestration tests.
- `tests/e2e/*`: browser smoke test for the complete MVP flow.

## Data Model Summary

Implement these Prisma models:

- `Candidate`
- `MaterialAsset`
- `CompanyTemplate`
- `JobTemplate`
- `InterviewerTemplate`
- `TrainingTask`
- `TrainingStage`
- `TrainingSession`
- `SessionTurn`
- `CoachingReport`
- `AiCallLog`

Important relationships:

- Candidate has many material assets, training tasks, sessions, and reports.
- Training task belongs to candidate and references company, job, interviewer, and stage config.
- Training session belongs to task and stores turns.
- Coaching report belongs to session.
- AI call logs can reference task, session, or report.

## Task 1: Scaffold App and Tooling

**Files:**
- Create: `package.json`
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `postcss.config.mjs`
- Create: `tailwind.config.ts`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `app/globals.css`

- [ ] **Step 1: Create project package file**

Create `package.json`:

```json
{
  "name": "ai-interview-coach-mvp",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:generate": "prisma generate",
    "db:push": "prisma db push",
    "db:seed": "tsx lib/db/seed.ts"
  },
  "dependencies": {
    "@prisma/client": "^5.22.0",
    "clsx": "^2.1.1",
    "lucide-react": "^0.468.0",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@testing-library/react": "^16.1.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "eslint": "^9.16.0",
    "eslint-config-next": "^15.0.0",
    "postcss": "^8.4.49",
    "prisma": "^5.22.0",
    "tailwindcss": "^3.4.16",
    "tsx": "^4.19.2",
    "typescript": "^5.7.0",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create config files**

Create `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    typedRoutes: true
  }
};

export default nextConfig;
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/unit/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname
    }
  }
});
```

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
```

Create `postcss.config.mjs`:

```js
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};

export default config;
```

Create `tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        muted: "#6b7280",
        panel: "#ffffff",
        line: "#e5e7eb",
        brand: "#2563eb",
        accent: "#059669"
      }
    }
  },
  plugins: []
};

export default config;
```

- [ ] **Step 3: Create base app files**

Create `app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color: #111827;
  background: #f8fafc;
}

body {
  margin: 0;
  min-height: 100vh;
}

button,
input,
select,
textarea {
  font: inherit;
}
```

Create `app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 面试训练辅导平台",
  description: "服务交付型 AI 数字人面试训练 MVP"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
```

Create `app/page.tsx`:

```tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-12">
      <p className="text-sm font-medium text-brand">AI Interview Coach MVP</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-normal text-ink">
        AI 数字人面试训练辅导平台
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
        面向服务方的面试训练交付平台：创建求职者档案，配置训练任务，生成练习链接，并沉淀 AI 复盘报告。
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white" href="/admin">
          进入服务后台
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Install dependencies**

Run:

```bash
npm install
```

Expected: dependencies install successfully and `package-lock.json` is created.

- [ ] **Step 5: Verify scaffold**

Run:

```bash
npm run build
```

Expected: build completes successfully.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json next.config.ts tsconfig.json vitest.config.ts playwright.config.ts postcss.config.mjs tailwind.config.ts app
git commit -m "chore: scaffold interview coach app"
```

## Task 2: Add Domain Types and Stage Logic

**Files:**
- Create: `lib/domain/stages.ts`
- Create: `lib/domain/interviewerTemplates.ts`
- Create: `tests/unit/stages.test.ts`

- [ ] **Step 1: Write failing tests for configurable stages**

Create `tests/unit/stages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildStagePlan, defaultStageTemplates } from "@/lib/domain/stages";

describe("buildStagePlan", () => {
  it("returns only enabled stages in configured order", () => {
    const plan = buildStagePlan([
      { type: "FORMAL_INTERVIEW", enabled: true, durationMinutes: 15, visibleTransition: true },
      { type: "WARM_UP", enabled: false, durationMinutes: 5, visibleTransition: true },
      { type: "PRESSURE_FOLLOW_UP", enabled: true, durationMinutes: 8, visibleTransition: false }
    ]);

    expect(plan.map((stage) => stage.type)).toEqual(["FORMAL_INTERVIEW", "PRESSURE_FOLLOW_UP"]);
    expect(plan[1].visibleTransition).toBe(false);
  });

  it("contains the MVP default stage templates", () => {
    expect(defaultStageTemplates.map((stage) => stage.type)).toEqual([
      "WARM_UP",
      "FORMAL_INTERVIEW",
      "PRESSURE_FOLLOW_UP",
      "EXPERIENCE_DEEP_DIVE",
      "CASE_ANALYSIS",
      "ENGLISH_INTERVIEW",
      "AI_REVIEW",
      "FOLLOW_UP_PLAN"
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/unit/stages.test.ts
```

Expected: FAIL because `@/lib/domain/stages` does not exist.

- [ ] **Step 3: Implement stage domain logic**

Create `lib/domain/stages.ts`:

```ts
export type TrainingStageType =
  | "WARM_UP"
  | "FORMAL_INTERVIEW"
  | "PRESSURE_FOLLOW_UP"
  | "EXPERIENCE_DEEP_DIVE"
  | "CASE_ANALYSIS"
  | "ENGLISH_INTERVIEW"
  | "AI_REVIEW"
  | "FOLLOW_UP_PLAN";

export type StageConfigInput = {
  type: TrainingStageType;
  enabled: boolean;
  durationMinutes: number;
  visibleTransition: boolean;
};

export type StagePlanItem = StageConfigInput & {
  label: string;
  description: string;
};

export const defaultStageTemplates: StagePlanItem[] = [
  {
    type: "WARM_UP",
    label: "预热练习",
    description: "帮助求职者进入状态，观察紧张、语速和表达结构。",
    enabled: true,
    durationMinutes: 5,
    visibleTransition: true
  },
  {
    type: "FORMAL_INTERVIEW",
    label: "正式模拟",
    description: "围绕目标公司、岗位 JD 和简历进行正式面试。",
    enabled: true,
    durationMinutes: 15,
    visibleTransition: true
  },
  {
    type: "PRESSURE_FOLLOW_UP",
    label: "压力追问",
    description: "通过质疑、连续追问和轻度打断训练抗压能力。",
    enabled: true,
    durationMinutes: 8,
    visibleTransition: true
  },
  {
    type: "EXPERIENCE_DEEP_DIVE",
    label: "经历深挖",
    description: "围绕简历项目、职责、结果和细节进行追问。",
    enabled: false,
    durationMinutes: 10,
    visibleTransition: true
  },
  {
    type: "CASE_ANALYSIS",
    label: "案例分析",
    description: "给出业务场景，观察结构化分析和决策表达。",
    enabled: false,
    durationMinutes: 12,
    visibleTransition: true
  },
  {
    type: "ENGLISH_INTERVIEW",
    label: "英文面试",
    description: "模拟外企或跨文化面试场景。",
    enabled: false,
    durationMinutes: 10,
    visibleTransition: true
  },
  {
    type: "AI_REVIEW",
    label: "AI 复盘",
    description: "生成综合评分、逐题反馈和改进建议。",
    enabled: true,
    durationMinutes: 3,
    visibleTransition: true
  },
  {
    type: "FOLLOW_UP_PLAN",
    label: "复训计划",
    description: "根据弱项生成下一轮训练计划。",
    enabled: true,
    durationMinutes: 2,
    visibleTransition: true
  }
];

export function buildStagePlan(configs: StageConfigInput[]): StagePlanItem[] {
  return configs
    .filter((config) => config.enabled)
    .map((config) => {
      const template = defaultStageTemplates.find((stage) => stage.type === config.type);

      if (!template) {
        throw new Error(`Unsupported training stage: ${config.type}`);
      }

      return {
        ...template,
        ...config
      };
    });
}
```

- [ ] **Step 4: Add interviewer template defaults**

Create `lib/domain/interviewerTemplates.ts`:

```ts
export type InterviewerType =
  | "WARM_GUIDE"
  | "STANDARD_HR"
  | "BUSINESS_MANAGER"
  | "TECHNICAL_PROFESSIONAL"
  | "PRESSURE"
  | "EXPERIENCE_DEEP_DIVE"
  | "CASE_ANALYSIS"
  | "EXECUTIVE_FINAL"
  | "CROSS_CULTURAL_ENGLISH"
  | "COLD_LOW_FEEDBACK";

export type InterviewerTemplate = {
  type: InterviewerType;
  name: string;
  tone: string;
  followUpDepth: number;
  interruptFrequency: number;
  challengeIntensity: number;
  languageMode: "ZH" | "EN" | "MIXED";
  safetyBoundary: string;
};

export const defaultInterviewerTemplates: InterviewerTemplate[] = [
  {
    type: "WARM_GUIDE",
    name: "温和引导型",
    tone: "鼓励、耐心、降低紧张",
    followUpDepth: 2,
    interruptFrequency: 0,
    challengeIntensity: 1,
    languageMode: "ZH",
    safetyBoundary: "以支持和引导为主，不使用否定性压迫话术。"
  },
  {
    type: "STANDARD_HR",
    name: "标准 HR 型",
    tone: "专业、清晰、追问适中",
    followUpDepth: 3,
    interruptFrequency: 1,
    challengeIntensity: 2,
    languageMode: "ZH",
    safetyBoundary: "围绕动机、稳定性、沟通和职业规划提问。"
  },
  {
    type: "BUSINESS_MANAGER",
    name: "业务主管型",
    tone: "结果导向、关注岗位匹配",
    followUpDepth: 4,
    interruptFrequency: 1,
    challengeIntensity: 3,
    languageMode: "ZH",
    safetyBoundary: "追问业务理解、协作方式和结果产出。"
  },
  {
    type: "TECHNICAL_PROFESSIONAL",
    name: "技术或专业面试官型",
    tone: "严谨、关注专业细节",
    followUpDepth: 5,
    interruptFrequency: 1,
    challengeIntensity: 3,
    languageMode: "ZH",
    safetyBoundary: "追问专业能力，但不编造不存在的岗位要求。"
  },
  {
    type: "PRESSURE",
    name: "压力面试型",
    tone: "直接、质疑、连续追问",
    followUpDepth: 5,
    interruptFrequency: 3,
    challengeIntensity: 5,
    languageMode: "ZH",
    safetyBoundary: "可以质疑答案，但不能羞辱、攻击或贬低求职者。"
  },
  {
    type: "EXPERIENCE_DEEP_DIVE",
    name: "经历深挖型",
    tone: "细致、追求证据",
    followUpDepth: 5,
    interruptFrequency: 1,
    challengeIntensity: 3,
    languageMode: "ZH",
    safetyBoundary: "围绕简历事实深挖，不诱导求职者造假。"
  },
  {
    type: "CASE_ANALYSIS",
    name: "案例分析型",
    tone: "结构化、场景化",
    followUpDepth: 4,
    interruptFrequency: 1,
    challengeIntensity: 3,
    languageMode: "ZH",
    safetyBoundary: "评价分析过程，不把单一答案当成唯一正确答案。"
  },
  {
    type: "EXECUTIVE_FINAL",
    name: "高管终面型",
    tone: "宏观、战略、价值观导向",
    followUpDepth: 4,
    interruptFrequency: 1,
    challengeIntensity: 4,
    languageMode: "ZH",
    safetyBoundary: "关注长期规划、组织适配和判断力。"
  },
  {
    type: "CROSS_CULTURAL_ENGLISH",
    name: "跨文化或外企英文型",
    tone: "国际化、表达清晰",
    followUpDepth: 3,
    interruptFrequency: 1,
    challengeIntensity: 3,
    languageMode: "MIXED",
    safetyBoundary: "允许中英混合提示，但正式回答尽量用英文推进。"
  },
  {
    type: "COLD_LOW_FEEDBACK",
    name: "冷淡低反馈型",
    tone: "克制、反馈少、气场偏冷",
    followUpDepth: 3,
    interruptFrequency: 1,
    challengeIntensity: 3,
    languageMode: "ZH",
    safetyBoundary: "模拟冷淡环境，但不进行人格否定。"
  }
];
```

- [ ] **Step 5: Run unit tests**

Run:

```bash
npm test -- tests/unit/stages.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/domain tests/unit/stages.test.ts
git commit -m "feat: add training stage and interviewer templates"
```

## Task 3: Add Database Schema and Seed Data

**Files:**
- Create: `prisma/schema.prisma`
- Create: `lib/db/prisma.ts`
- Create: `lib/db/seed.ts`
- Modify: `.env`

- [ ] **Step 1: Create Prisma schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Candidate {
  id          String          @id @default(cuid())
  name        String
  email       String?
  phone       String?
  targetCompany String?
  targetRole  String?
  serviceStatus String       @default("ACTIVE")
  weakTags    String         @default("[]")
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt
  materials   MaterialAsset[]
  tasks       TrainingTask[]
  sessions    TrainingSession[]
}

model MaterialAsset {
  id          String    @id @default(cuid())
  candidateId String?
  candidate   Candidate? @relation(fields: [candidateId], references: [id])
  type        String
  title       String
  content     String
  source      String    @default("MANUAL")
  createdAt   DateTime  @default(now())
}

model CompanyTemplate {
  id          String   @id @default(cuid())
  name        String
  industry    String?
  interviewStyle String
  competencyModel String
  commonQuestions String
  scoringStandard String
  restrictedTopics String @default("[]")
  createdAt   DateTime @default(now())
  tasks       TrainingTask[]
}

model JobTemplate {
  id          String   @id @default(cuid())
  title       String
  category    String
  competencyModel String
  commonQuestions String
  riskQuestions String
  createdAt   DateTime @default(now())
  tasks       TrainingTask[]
}

model InterviewerTemplate {
  id          String   @id @default(cuid())
  type        String
  name        String
  tone        String
  followUpDepth Int
  interruptFrequency Int
  challengeIntensity Int
  languageMode String
  safetyBoundary String
  createdAt   DateTime @default(now())
  tasks       TrainingTask[]
}

model TrainingTask {
  id          String   @id @default(cuid())
  candidateId String
  candidate   Candidate @relation(fields: [candidateId], references: [id])
  companyTemplateId String?
  companyTemplate CompanyTemplate? @relation(fields: [companyTemplateId], references: [id])
  jobTemplateId String?
  jobTemplate JobTemplate? @relation(fields: [jobTemplateId], references: [id])
  interviewerTemplateId String?
  interviewerTemplate InterviewerTemplate? @relation(fields: [interviewerTemplateId], references: [id])
  title       String
  targetCompany String
  targetRole  String
  stageConfig String
  expectedMinutes Int
  status      String   @default("DRAFT")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  sessions    TrainingSession[]
}

model TrainingSession {
  id          String   @id @default(cuid())
  taskId      String
  task        TrainingTask @relation(fields: [taskId], references: [id])
  candidateId String
  candidate   Candidate @relation(fields: [candidateId], references: [id])
  status      String   @default("IN_PROGRESS")
  currentStage String?
  startedAt   DateTime @default(now())
  endedAt     DateTime?
  turns       SessionTurn[]
  report      CoachingReport?
  aiCalls     AiCallLog[]
}

model SessionTurn {
  id          String   @id @default(cuid())
  sessionId   String
  session     TrainingSession @relation(fields: [sessionId], references: [id])
  stage       String
  question    String
  answer      String
  feedback    String?
  createdAt   DateTime @default(now())
}

model CoachingReport {
  id          String   @id @default(cuid())
  sessionId   String   @unique
  session     TrainingSession @relation(fields: [sessionId], references: [id])
  overallScore Int
  subScores   String
  perQuestionFeedback String
  expressionAnalysis String
  answerQualityAnalysis String
  strategySuggestions String
  weakTags    String
  nextTrainingPlan String
  candidateSummary String
  createdAt   DateTime @default(now())
}

model AiCallLog {
  id          String   @id @default(cuid())
  sessionId   String?
  session     TrainingSession? @relation(fields: [sessionId], references: [id])
  capability  String
  provider    String
  latencyMs   Int
  costEstimate Float
  success     Boolean
  failureReason String?
  fallbackProvider String?
  createdAt   DateTime @default(now())
}
```

- [ ] **Step 2: Create Prisma client helper**

Create `lib/db/prisma.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 3: Create seed script**

Create `lib/db/seed.ts`:

```ts
import { prisma } from "@/lib/db/prisma";
import { defaultInterviewerTemplates } from "@/lib/domain/interviewerTemplates";

async function main() {
  for (const template of defaultInterviewerTemplates) {
    await prisma.interviewerTemplate.upsert({
      where: { id: template.type },
      update: {
        name: template.name,
        tone: template.tone,
        followUpDepth: template.followUpDepth,
        interruptFrequency: template.interruptFrequency,
        challengeIntensity: template.challengeIntensity,
        languageMode: template.languageMode,
        safetyBoundary: template.safetyBoundary
      },
      create: {
        id: template.type,
        type: template.type,
        name: template.name,
        tone: template.tone,
        followUpDepth: template.followUpDepth,
        interruptFrequency: template.interruptFrequency,
        challengeIntensity: template.challengeIntensity,
        languageMode: template.languageMode,
        safetyBoundary: template.safetyBoundary
      }
    });
  }

  await prisma.companyTemplate.upsert({
    where: { id: "demo-company" },
    update: {},
    create: {
      id: "demo-company",
      name: "示例科技公司",
      industry: "互联网",
      interviewStyle: "标准 HR + 业务主管复试，重视表达结构和项目结果。",
      competencyModel: "沟通表达、岗位理解、项目结果、协作能力、抗压能力",
      commonQuestions: "请做一个自我介绍。你为什么选择我们公司？讲一个最有代表性的项目。",
      scoringStandard: "表达清晰度、岗位匹配度、经历可信度、追问稳定性",
      restrictedTopics: "[]"
    }
  });

  await prisma.jobTemplate.upsert({
    where: { id: "demo-product-manager" },
    update: {},
    create: {
      id: "demo-product-manager",
      title: "产品经理",
      category: "产品",
      competencyModel: "用户理解、需求分析、数据意识、跨团队协作、结果复盘",
      commonQuestions: "你如何判断一个需求是否值得做？讲一个你推动项目落地的经历。",
      riskQuestions: "如果业务方和技术团队意见冲突，你怎么处理？"
    }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 4: Add environment file**

Create `.env`:

```env
DATABASE_URL="file:./dev.db"
```

- [ ] **Step 5: Generate and push database**

Run:

```bash
npm run db:generate
npm run db:push
npm run db:seed
```

Expected:

- Prisma Client is generated.
- SQLite database is created.
- Seed data inserts interviewer, company, and job templates.

- [ ] **Step 6: Commit**

```bash
git add prisma lib/db .env
git commit -m "feat: add prisma data model and seed data"
```

## Task 4: Add AI Orchestration Layer

**Files:**
- Create: `lib/ai/types.ts`
- Create: `lib/ai/mockProvider.ts`
- Create: `lib/ai/orchestrator.ts`
- Create: `lib/ai/index.ts`
- Create: `tests/unit/orchestrator.test.ts`

- [ ] **Step 1: Write failing AI orchestration tests**

Create `tests/unit/orchestrator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAiOrchestrator } from "@/lib/ai/orchestrator";
import { mockAiProvider } from "@/lib/ai/mockProvider";

describe("AI orchestrator", () => {
  it("generates a training outline with questions", async () => {
    const orchestrator = createAiOrchestrator({ provider: mockAiProvider });
    const outline = await orchestrator.generateTrainingOutline({
      candidateName: "张三",
      targetCompany: "示例科技公司",
      targetRole: "产品经理",
      interviewerName: "标准 HR 型",
      stages: ["WARM_UP", "FORMAL_INTERVIEW"]
    });

    expect(outline.questions.length).toBeGreaterThan(0);
    expect(outline.questions[0].stage).toBe("WARM_UP");
  });

  it("generates a coaching report from session turns", async () => {
    const orchestrator = createAiOrchestrator({ provider: mockAiProvider });
    const report = await orchestrator.generateCoachingReport({
      candidateName: "张三",
      targetRole: "产品经理",
      turns: [
        {
          stage: "FORMAL_INTERVIEW",
          question: "请介绍一个项目。",
          answer: "我负责了需求分析，并推动上线。"
        }
      ]
    });

    expect(report.overallScore).toBeGreaterThanOrEqual(60);
    expect(report.weakTags).toContain("表达结构");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/unit/orchestrator.test.ts
```

Expected: FAIL because AI modules do not exist.

- [ ] **Step 3: Add AI types**

Create `lib/ai/types.ts`:

```ts
import type { TrainingStageType } from "@/lib/domain/stages";

export type TrainingOutlineRequest = {
  candidateName: string;
  targetCompany: string;
  targetRole: string;
  interviewerName: string;
  stages: TrainingStageType[];
};

export type TrainingQuestion = {
  stage: TrainingStageType;
  question: string;
  intent: string;
};

export type TrainingOutline = {
  summary: string;
  questions: TrainingQuestion[];
};

export type SessionTurnInput = {
  stage: string;
  question: string;
  answer: string;
};

export type CoachingReportInput = {
  candidateName: string;
  targetRole: string;
  turns: SessionTurnInput[];
};

export type CoachingReportResult = {
  overallScore: number;
  subScores: Record<string, number>;
  perQuestionFeedback: Array<{
    question: string;
    feedback: string;
    suggestion: string;
  }>;
  expressionAnalysis: string;
  answerQualityAnalysis: string;
  strategySuggestions: string;
  weakTags: string[];
  nextTrainingPlan: string[];
  candidateSummary: string;
};

export type AiProvider = {
  name: string;
  generateTrainingOutline(input: TrainingOutlineRequest): Promise<TrainingOutline>;
  generateCoachingReport(input: CoachingReportInput): Promise<CoachingReportResult>;
};
```

- [ ] **Step 4: Add mock provider**

Create `lib/ai/mockProvider.ts`:

```ts
import type { AiProvider, CoachingReportInput, CoachingReportResult, TrainingOutline, TrainingOutlineRequest } from "@/lib/ai/types";

const questionsByStage = {
  WARM_UP: "请先用 1 分钟做一个自我介绍。",
  FORMAL_INTERVIEW: "请结合目标岗位，讲一个最能代表你能力的项目。",
  PRESSURE_FOLLOW_UP: "你刚才的结果听起来比较笼统，能给出具体指标和你的个人贡献吗？",
  EXPERIENCE_DEEP_DIVE: "这个项目中最困难的决策是什么？你如何证明自己的判断是对的？",
  CASE_ANALYSIS: "如果目标用户增长停滞，你会如何拆解原因并制定方案？",
  ENGLISH_INTERVIEW: "Please introduce a project that best demonstrates your role fit.",
  AI_REVIEW: "我们进入复盘阶段。",
  FOLLOW_UP_PLAN: "我会根据你的表现给出下一轮训练建议。"
} as const;

export const mockAiProvider: AiProvider = {
  name: "mock-ai-provider",

  async generateTrainingOutline(input: TrainingOutlineRequest): Promise<TrainingOutline> {
    return {
      summary: `${input.candidateName} 将针对 ${input.targetCompany} 的 ${input.targetRole} 岗位进行 ${input.interviewerName} 模拟面试。`,
      questions: input.stages.map((stage) => ({
        stage,
        question: questionsByStage[stage],
        intent: "观察表达结构、岗位匹配度和追问稳定性。"
      }))
    };
  },

  async generateCoachingReport(input: CoachingReportInput): Promise<CoachingReportResult> {
    const answeredCount = input.turns.filter((turn) => turn.answer.trim().length > 0).length;
    const overallScore = Math.min(88, 60 + answeredCount * 8);

    return {
      overallScore,
      subScores: {
        "表达结构": 72,
        "岗位匹配": 76,
        "经历可信度": 70,
        "临场稳定性": 68
      },
      perQuestionFeedback: input.turns.map((turn) => ({
        question: turn.question,
        feedback: `回答已覆盖主题，但还需要补充更明确的背景、行动和结果。`,
        suggestion: `建议用 STAR 结构重写，并加入量化结果。当前回答：${turn.answer}`
      })),
      expressionAnalysis: "整体表达可以完成回答，但部分内容偏概括，建议减少口头铺垫。",
      answerQualityAnalysis: "答案有岗位相关性，但项目细节和个人贡献需要更具体。",
      strategySuggestions: "遇到追问时先确认问题，再用结论、证据、反思三段式回答。",
      weakTags: ["表达结构", "量化结果", "追问稳定性"],
      nextTrainingPlan: ["重练 1 分钟自我介绍", "补充项目量化指标", "进行一轮压力追问训练"],
      candidateSummary: `${input.candidateName} 本轮适合继续强化 ${input.targetRole} 相关项目表达。`
    };
  }
};
```

- [ ] **Step 5: Add orchestrator**

Create `lib/ai/orchestrator.ts`:

```ts
import type { AiProvider, CoachingReportInput, CoachingReportResult, TrainingOutline, TrainingOutlineRequest } from "@/lib/ai/types";

export type AiOrchestrator = {
  generateTrainingOutline(input: TrainingOutlineRequest): Promise<TrainingOutline>;
  generateCoachingReport(input: CoachingReportInput): Promise<CoachingReportResult>;
};

export function createAiOrchestrator({ provider }: { provider: AiProvider }): AiOrchestrator {
  return {
    generateTrainingOutline(input) {
      return provider.generateTrainingOutline(input);
    },
    generateCoachingReport(input) {
      return provider.generateCoachingReport(input);
    }
  };
}
```

Create `lib/ai/index.ts`:

```ts
import { mockAiProvider } from "@/lib/ai/mockProvider";
import { createAiOrchestrator } from "@/lib/ai/orchestrator";

export const aiOrchestrator = createAiOrchestrator({
  provider: mockAiProvider
});

export type * from "@/lib/ai/types";
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- tests/unit/orchestrator.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/ai tests/unit/orchestrator.test.ts
git commit -m "feat: add ai orchestration adapter"
```

## Task 5: Add API Validation and CRUD Routes

**Files:**
- Create: `lib/validators/candidate.ts`
- Create: `lib/validators/template.ts`
- Create: `lib/validators/task.ts`
- Create: `app/api/candidates/route.ts`
- Create: `app/api/templates/route.ts`
- Create: `app/api/tasks/route.ts`
- Create: `app/api/tasks/[taskId]/route.ts`

- [ ] **Step 1: Add validators**

Create `lib/validators/candidate.ts`:

```ts
import { z } from "zod";

export const candidateInputSchema = z.object({
  name: z.string().min(1, "请输入姓名"),
  email: z.string().email("邮箱格式不正确").optional().or(z.literal("")),
  phone: z.string().optional(),
  targetCompany: z.string().optional(),
  targetRole: z.string().optional()
});

export type CandidateInput = z.infer<typeof candidateInputSchema>;
```

Create `lib/validators/template.ts`:

```ts
import { z } from "zod";

export const companyTemplateInputSchema = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  interviewStyle: z.string().min(1),
  competencyModel: z.string().min(1),
  commonQuestions: z.string().min(1),
  scoringStandard: z.string().min(1)
});

export const jobTemplateInputSchema = z.object({
  title: z.string().min(1),
  category: z.string().min(1),
  competencyModel: z.string().min(1),
  commonQuestions: z.string().min(1),
  riskQuestions: z.string().min(1)
});
```

Create `lib/validators/task.ts`:

```ts
import { z } from "zod";

export const trainingTaskInputSchema = z.object({
  candidateId: z.string().min(1),
  companyTemplateId: z.string().optional(),
  jobTemplateId: z.string().optional(),
  interviewerTemplateId: z.string().optional(),
  title: z.string().min(1),
  targetCompany: z.string().min(1),
  targetRole: z.string().min(1),
  stageConfig: z.string().min(2),
  expectedMinutes: z.coerce.number().int().min(5).max(120)
});
```

- [ ] **Step 2: Add candidate API**

Create `app/api/candidates/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { candidateInputSchema } from "@/lib/validators/candidate";

export async function GET() {
  const candidates = await prisma.candidate.findMany({
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json({ candidates });
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = candidateInputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const candidate = await prisma.candidate.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email || null,
      phone: parsed.data.phone,
      targetCompany: parsed.data.targetCompany,
      targetRole: parsed.data.targetRole
    }
  });

  return NextResponse.json({ candidate }, { status: 201 });
}
```

- [ ] **Step 3: Add templates API**

Create `app/api/templates/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const [companies, jobs, interviewers] = await Promise.all([
    prisma.companyTemplate.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.jobTemplate.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.interviewerTemplate.findMany({ orderBy: { createdAt: "asc" } })
  ]);

  return NextResponse.json({ companies, jobs, interviewers });
}
```

- [ ] **Step 4: Add training task API**

Create `app/api/tasks/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { trainingTaskInputSchema } from "@/lib/validators/task";

export async function GET() {
  const tasks = await prisma.trainingTask.findMany({
    include: {
      candidate: true,
      companyTemplate: true,
      jobTemplate: true,
      interviewerTemplate: true
    },
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json({ tasks });
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = trainingTaskInputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const task = await prisma.trainingTask.create({
    data: parsed.data
  });

  return NextResponse.json({ task }, { status: 201 });
}
```

Create `app/api/tasks/[taskId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(_: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const task = await prisma.trainingTask.findUnique({
    where: { id: taskId },
    include: {
      candidate: true,
      companyTemplate: true,
      jobTemplate: true,
      interviewerTemplate: true,
      sessions: {
        include: {
          report: true
        },
        orderBy: { startedAt: "desc" }
      }
    }
  });

  if (!task) {
    return NextResponse.json({ error: "Training task not found" }, { status: 404 });
  }

  return NextResponse.json({ task });
}
```

- [ ] **Step 5: Verify API typecheck**

Run:

```bash
npm run build
```

Expected: build completes successfully.

- [ ] **Step 6: Commit**

```bash
git add app/api lib/validators
git commit -m "feat: add admin data APIs"
```

## Task 6: Build Service Backend UI

**Files:**
- Create: `components/ui/Button.tsx`
- Create: `components/ui/Card.tsx`
- Create: `components/ui/Field.tsx`
- Create: `components/admin/CandidateForm.tsx`
- Create: `components/admin/TrainingTaskForm.tsx`
- Create: `components/admin/TemplateManager.tsx`
- Create: `app/admin/page.tsx`
- Create: `app/admin/candidates/page.tsx`
- Create: `app/admin/templates/page.tsx`
- Create: `app/admin/tasks/new/page.tsx`
- Create: `app/admin/tasks/[taskId]/page.tsx`

- [ ] **Step 1: Add reusable UI components**

Create `components/ui/Button.tsx`:

```tsx
import { clsx } from "clsx";
import type { ButtonHTMLAttributes } from "react";

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      {...props}
    />
  );
}
```

Create `components/ui/Card.tsx`:

```tsx
import { clsx } from "clsx";
import type { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("rounded-lg border border-line bg-panel p-5 shadow-sm", className)} {...props} />;
}
```

Create `components/ui/Field.tsx`:

```tsx
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

export function Field({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm" {...props} />
    </label>
  );
}

export function TextAreaField({
  label,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <textarea className="mt-1 min-h-24 w-full rounded-md border border-line px-3 py-2 text-sm" {...props} />
    </label>
  );
}
```

- [ ] **Step 2: Add admin landing page**

Create `app/admin/page.tsx`:

```tsx
import Link from "next/link";
import { Card } from "@/components/ui/Card";

const links = [
  { href: "/admin/candidates", title: "求职者档案", description: "创建客户，查看目标公司、岗位和服务状态。" },
  { href: "/admin/templates", title: "模板库", description: "查看公司、岗位和面试官模板。" },
  { href: "/admin/tasks/new", title: "创建训练任务", description: "配置阶段、面试官和练习链接。" }
];

export default function AdminPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-ink">服务后台</h1>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {links.map((link) => (
          <Link key={link.href} href={link.href}>
            <Card className="h-full transition hover:border-brand">
              <h2 className="text-lg font-medium text-ink">{link.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{link.description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Add candidate form and page**

Create `components/admin/CandidateForm.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

export function CandidateForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);

    await fetch("/api/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        phone: form.get("phone"),
        targetCompany: form.get("targetCompany"),
        targetRole: form.get("targetRole")
      })
    });

    setSaving(false);
    router.refresh();
    event.currentTarget.reset();
  }

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <Field label="姓名" name="name" required />
      <Field label="邮箱" name="email" type="email" />
      <Field label="手机号" name="phone" />
      <Field label="目标公司" name="targetCompany" />
      <Field label="目标岗位" name="targetRole" />
      <Button disabled={saving} type="submit">{saving ? "保存中" : "创建求职者"}</Button>
    </form>
  );
}
```

Create `app/admin/candidates/page.tsx`:

```tsx
import Link from "next/link";
import { CandidateForm } from "@/components/admin/CandidateForm";
import { Card } from "@/components/ui/Card";
import { prisma } from "@/lib/db/prisma";

export default async function CandidatesPage() {
  const candidates = await prisma.candidate.findMany({
    orderBy: { createdAt: "desc" }
  });

  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[360px_1fr]">
      <Card>
        <h1 className="text-xl font-semibold text-ink">创建求职者</h1>
        <div className="mt-5">
          <CandidateForm />
        </div>
      </Card>
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-ink">客户档案</h2>
          <Link className="text-sm font-medium text-brand" href="/admin">返回后台</Link>
        </div>
        <div className="mt-4 grid gap-3">
          {candidates.map((candidate) => (
            <Card key={candidate.id}>
              <h3 className="font-medium text-ink">{candidate.name}</h3>
              <p className="mt-1 text-sm text-muted">{candidate.targetCompany || "未填写公司"} / {candidate.targetRole || "未填写岗位"}</p>
              <p className="mt-1 text-xs text-muted">{candidate.email || candidate.phone || "未填写联系方式"}</p>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Add templates page**

Create `components/admin/TemplateManager.tsx`:

```tsx
import { Card } from "@/components/ui/Card";

type TemplateManagerProps = {
  companies: Array<{ id: string; name: string; interviewStyle: string }>;
  jobs: Array<{ id: string; title: string; category: string; competencyModel: string }>;
  interviewers: Array<{ id: string; name: string; tone: string; challengeIntensity: number }>;
};

export function TemplateManager({ companies, jobs, interviewers }: TemplateManagerProps) {
  return (
    <div className="grid gap-6">
      <section>
        <h2 className="text-lg font-semibold text-ink">公司模板</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {companies.map((company) => (
            <Card key={company.id}>
              <h3 className="font-medium">{company.name}</h3>
              <p className="mt-2 text-sm text-muted">{company.interviewStyle}</p>
            </Card>
          ))}
        </div>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-ink">岗位模板</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {jobs.map((job) => (
            <Card key={job.id}>
              <h3 className="font-medium">{job.title} · {job.category}</h3>
              <p className="mt-2 text-sm text-muted">{job.competencyModel}</p>
            </Card>
          ))}
        </div>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-ink">面试官模板</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {interviewers.map((interviewer) => (
            <Card key={interviewer.id}>
              <h3 className="font-medium">{interviewer.name}</h3>
              <p className="mt-2 text-sm text-muted">{interviewer.tone}</p>
              <p className="mt-2 text-xs text-muted">压力强度：{interviewer.challengeIntensity}/5</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
```

Create `app/admin/templates/page.tsx`:

```tsx
import Link from "next/link";
import { TemplateManager } from "@/components/admin/TemplateManager";
import { prisma } from "@/lib/db/prisma";

export default async function TemplatesPage() {
  const [companies, jobs, interviewers] = await Promise.all([
    prisma.companyTemplate.findMany(),
    prisma.jobTemplate.findMany(),
    prisma.interviewerTemplate.findMany()
  ]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">模板库</h1>
        <Link className="text-sm font-medium text-brand" href="/admin">返回后台</Link>
      </div>
      <div className="mt-6">
        <TemplateManager companies={companies} jobs={jobs} interviewers={interviewers} />
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Add training task form**

Create `components/admin/TrainingTaskForm.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { defaultStageTemplates } from "@/lib/domain/stages";

type TrainingTaskFormProps = {
  candidates: Array<{ id: string; name: string; targetCompany: string | null; targetRole: string | null }>;
  companies: Array<{ id: string; name: string }>;
  jobs: Array<{ id: string; title: string }>;
  interviewers: Array<{ id: string; name: string }>;
};

export function TrainingTaskForm({ candidates, companies, jobs, interviewers }: TrainingTaskFormProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const stageConfig = defaultStageTemplates.map((stage) => ({
      type: stage.type,
      enabled: form.get(`stage-${stage.type}`) === "on",
      durationMinutes: stage.durationMinutes,
      visibleTransition: form.get(`visible-${stage.type}`) === "on"
    }));

    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateId: form.get("candidateId"),
        companyTemplateId: form.get("companyTemplateId") || undefined,
        jobTemplateId: form.get("jobTemplateId") || undefined,
        interviewerTemplateId: form.get("interviewerTemplateId") || undefined,
        title: form.get("title"),
        targetCompany: form.get("targetCompany"),
        targetRole: form.get("targetRole"),
        expectedMinutes: form.get("expectedMinutes"),
        stageConfig: JSON.stringify(stageConfig)
      })
    });

    const payload = await response.json();
    setSaving(false);

    if (payload.task?.id) {
      router.push(`/admin/tasks/${payload.task.id}`);
    }
  }

  return (
    <form className="grid gap-5" onSubmit={onSubmit}>
      <Field label="训练标题" name="title" required defaultValue="面试冲刺训练" />
      <label className="block">
        <span className="text-sm font-medium text-ink">求职者</span>
        <select className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm" name="candidateId" required>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
          ))}
        </select>
      </label>
      <Field label="目标公司" name="targetCompany" required />
      <Field label="目标岗位" name="targetRole" required />
      <Field label="预计时长（分钟）" name="expectedMinutes" type="number" min={5} max={120} defaultValue={30} required />
      <label className="block">
        <span className="text-sm font-medium text-ink">公司模板</span>
        <select className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm" name="companyTemplateId">
          <option value="">不选择</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>{company.name}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-sm font-medium text-ink">岗位模板</span>
        <select className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm" name="jobTemplateId">
          <option value="">不选择</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>{job.title}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-sm font-medium text-ink">面试官</span>
        <select className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm" name="interviewerTemplateId">
          <option value="">默认</option>
          {interviewers.map((interviewer) => (
            <option key={interviewer.id} value={interviewer.id}>{interviewer.name}</option>
          ))}
        </select>
      </label>
      <section>
        <h2 className="text-sm font-semibold text-ink">训练阶段开关</h2>
        <div className="mt-3 grid gap-3">
          {defaultStageTemplates.map((stage) => (
            <div key={stage.type} className="rounded-md border border-line p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input name={`stage-${stage.type}`} type="checkbox" defaultChecked={stage.enabled} />
                {stage.label}
              </label>
              <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                <input name={`visible-${stage.type}`} type="checkbox" defaultChecked={stage.visibleTransition} />
                显示阶段切换提示
              </label>
            </div>
          ))}
        </div>
      </section>
      <Button disabled={saving} type="submit">{saving ? "创建中" : "创建训练任务"}</Button>
    </form>
  );
}
```

Create `app/admin/tasks/new/page.tsx`:

```tsx
import Link from "next/link";
import { TrainingTaskForm } from "@/components/admin/TrainingTaskForm";
import { Card } from "@/components/ui/Card";
import { prisma } from "@/lib/db/prisma";

export default async function NewTrainingTaskPage() {
  const [candidates, companies, jobs, interviewers] = await Promise.all([
    prisma.candidate.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.companyTemplate.findMany(),
    prisma.jobTemplate.findMany(),
    prisma.interviewerTemplate.findMany()
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">创建训练任务</h1>
        <Link className="text-sm font-medium text-brand" href="/admin">返回后台</Link>
      </div>
      <Card className="mt-6">
        <TrainingTaskForm candidates={candidates} companies={companies} jobs={jobs} interviewers={interviewers} />
      </Card>
    </main>
  );
}
```

- [ ] **Step 6: Add task detail page**

Create `app/admin/tasks/[taskId]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { prisma } from "@/lib/db/prisma";

export default async function TrainingTaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const task = await prisma.trainingTask.findUnique({
    where: { id: taskId },
    include: {
      candidate: true,
      interviewerTemplate: true,
      sessions: {
        include: { report: true },
        orderBy: { startedAt: "desc" }
      }
    }
  });

  if (!task) {
    notFound();
  }

  const practiceUrl = `/practice/${task.id}`;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Link className="text-sm font-medium text-brand" href="/admin">返回后台</Link>
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <h1 className="text-2xl font-semibold text-ink">{task.title}</h1>
          <p className="mt-2 text-muted">{task.candidate.name} · {task.targetCompany} · {task.targetRole}</p>
          <p className="mt-2 text-sm text-muted">面试官：{task.interviewerTemplate?.name || "默认面试官"}</p>
          <div className="mt-6 rounded-md bg-slate-50 p-4">
            <p className="text-sm font-medium text-ink">练习链接</p>
            <Link className="mt-2 block break-all text-sm text-brand" href={practiceUrl}>{practiceUrl}</Link>
          </div>
        </Card>
        <Card>
          <h2 className="font-semibold text-ink">训练记录</h2>
          <div className="mt-3 grid gap-3">
            {task.sessions.map((session) => (
              <Link key={session.id} className="rounded-md border border-line p-3 text-sm" href={`/admin/reports/${session.id}`}>
                {session.status} · {session.startedAt.toLocaleString("zh-CN")}
              </Link>
            ))}
            {task.sessions.length === 0 ? <p className="text-sm text-muted">暂无训练记录</p> : null}
          </div>
        </Card>
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/admin components
git commit -m "feat: build service backend ui"
```

## Task 7: Build Candidate Practice Flow and Session APIs

**Files:**
- Create: `app/api/sessions/route.ts`
- Create: `app/api/sessions/[sessionId]/answer/route.ts`
- Create: `app/api/sessions/[sessionId]/complete/route.ts`
- Create: `components/practice/PracticeEntry.tsx`
- Create: `components/practice/StageTimeline.tsx`
- Create: `components/practice/InterviewRoom.tsx`
- Create: `components/practice/CandidateReport.tsx`
- Create: `app/practice/[taskId]/page.tsx`
- Create: `app/practice/[taskId]/room/page.tsx`
- Create: `app/practice/[taskId]/report/page.tsx`

- [ ] **Step 1: Add session create API**

Create `app/api/sessions/route.ts`:

```ts
import { NextResponse } from "next/server";
import { aiOrchestrator } from "@/lib/ai";
import { prisma } from "@/lib/db/prisma";
import { buildStagePlan } from "@/lib/domain/stages";

export async function POST(request: Request) {
  const body = await request.json();
  const taskId = String(body.taskId || "");

  const task = await prisma.trainingTask.findUnique({
    where: { id: taskId },
    include: {
      candidate: true,
      interviewerTemplate: true
    }
  });

  if (!task) {
    return NextResponse.json({ error: "Training task not found" }, { status: 404 });
  }

  const stagePlan = buildStagePlan(JSON.parse(task.stageConfig));
  const outline = await aiOrchestrator.generateTrainingOutline({
    candidateName: task.candidate.name,
    targetCompany: task.targetCompany,
    targetRole: task.targetRole,
    interviewerName: task.interviewerTemplate?.name || "标准面试官",
    stages: stagePlan.map((stage) => stage.type)
  });

  const session = await prisma.trainingSession.create({
    data: {
      taskId: task.id,
      candidateId: task.candidateId,
      currentStage: stagePlan[0]?.type || null
    }
  });

  await prisma.aiCallLog.create({
    data: {
      sessionId: session.id,
      capability: "TRAINING_OUTLINE",
      provider: "mock-ai-provider",
      latencyMs: 30,
      costEstimate: 0,
      success: true
    }
  });

  return NextResponse.json({ session, outline });
}
```

- [ ] **Step 2: Add answer capture API**

Create `app/api/sessions/[sessionId]/answer/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const body = await request.json();

  const turn = await prisma.sessionTurn.create({
    data: {
      sessionId,
      stage: String(body.stage || "FORMAL_INTERVIEW"),
      question: String(body.question || ""),
      answer: String(body.answer || ""),
      feedback: "已记录回答，训练结束后统一复盘。"
    }
  });

  return NextResponse.json({ turn }, { status: 201 });
}
```

- [ ] **Step 3: Add complete session API**

Create `app/api/sessions/[sessionId]/complete/route.ts`:

```ts
import { NextResponse } from "next/server";
import { aiOrchestrator } from "@/lib/ai";
import { prisma } from "@/lib/db/prisma";

export async function POST(_: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    include: {
      candidate: true,
      task: true,
      turns: { orderBy: { createdAt: "asc" } }
    }
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const report = await aiOrchestrator.generateCoachingReport({
    candidateName: session.candidate.name,
    targetRole: session.task.targetRole,
    turns: session.turns.map((turn) => ({
      stage: turn.stage,
      question: turn.question,
      answer: turn.answer
    }))
  });

  const saved = await prisma.coachingReport.create({
    data: {
      sessionId: session.id,
      overallScore: report.overallScore,
      subScores: JSON.stringify(report.subScores),
      perQuestionFeedback: JSON.stringify(report.perQuestionFeedback),
      expressionAnalysis: report.expressionAnalysis,
      answerQualityAnalysis: report.answerQualityAnalysis,
      strategySuggestions: report.strategySuggestions,
      weakTags: JSON.stringify(report.weakTags),
      nextTrainingPlan: JSON.stringify(report.nextTrainingPlan),
      candidateSummary: report.candidateSummary
    }
  });

  await prisma.trainingSession.update({
    where: { id: session.id },
    data: {
      status: "COMPLETED",
      endedAt: new Date()
    }
  });

  await prisma.aiCallLog.create({
    data: {
      sessionId: session.id,
      capability: "COACHING_REPORT",
      provider: "mock-ai-provider",
      latencyMs: 50,
      costEstimate: 0,
      success: true
    }
  });

  return NextResponse.json({ report: saved });
}
```

- [ ] **Step 4: Add practice entry page component**

Create `components/practice/PracticeEntry.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function PracticeEntry({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  async function startPractice() {
    setStarting(true);
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId })
    });
    const payload = await response.json();
    sessionStorage.setItem(`outline-${taskId}`, JSON.stringify(payload.outline));
    sessionStorage.setItem(`session-${taskId}`, payload.session.id);
    router.push(`/practice/${taskId}/room`);
  }

  return <Button disabled={starting} onClick={startPractice}>{starting ? "准备中" : "开始训练"}</Button>;
}
```

Create `app/practice/[taskId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { PracticeEntry } from "@/components/practice/PracticeEntry";
import { prisma } from "@/lib/db/prisma";

export default async function PracticePage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const task = await prisma.trainingTask.findUnique({
    where: { id: taskId },
    include: { candidate: true, interviewerTemplate: true }
  });

  if (!task) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-10">
      <Card className="w-full">
        <p className="text-sm font-medium text-brand">面试训练</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">{task.title}</h1>
        <p className="mt-3 text-muted">{task.candidate.name} · {task.targetCompany} · {task.targetRole}</p>
        <p className="mt-2 text-sm text-muted">面试官：{task.interviewerTemplate?.name || "标准面试官"}</p>
        <div className="mt-6 rounded-md bg-slate-50 p-4 text-sm text-muted">
          系统会使用你的训练资料进行模拟面试、AI 分析、报告生成和历史进步追踪。
        </div>
        <div className="mt-6">
          <PracticeEntry taskId={task.id} />
        </div>
      </Card>
    </main>
  );
}
```

- [ ] **Step 5: Add interview room**

Create `components/practice/StageTimeline.tsx`:

```tsx
import type { StagePlanItem } from "@/lib/domain/stages";

export function StageTimeline({ stages, currentStage }: { stages: StagePlanItem[]; currentStage: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {stages.map((stage) => (
        <span
          key={stage.type}
          className={stage.type === currentStage ? "rounded-md bg-brand px-2 py-1 text-xs text-white" : "rounded-md bg-slate-100 px-2 py-1 text-xs text-muted"}
        >
          {stage.label}
        </span>
      ))}
    </div>
  );
}
```

Create `components/practice/InterviewRoom.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { TrainingOutline } from "@/lib/ai/types";

type InterviewRoomProps = {
  taskId: string;
};

export function InterviewRoom({ taskId }: InterviewRoomProps) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const outline = useMemo(() => {
    if (typeof window === "undefined") return null;
    const raw = sessionStorage.getItem(`outline-${taskId}`);
    return raw ? (JSON.parse(raw) as TrainingOutline) : null;
  }, [taskId]);
  const sessionId = typeof window !== "undefined" ? sessionStorage.getItem(`session-${taskId}`) : null;
  const currentQuestion = outline?.questions[questionIndex];

  async function submitAnswer() {
    if (!sessionId || !currentQuestion) return;
    await fetch(`/api/sessions/${sessionId}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: currentQuestion.stage,
        question: currentQuestion.question,
        answer
      })
    });
    setAnswer("");
    setQuestionIndex((index) => index + 1);
  }

  async function completeSession() {
    if (!sessionId) return;
    await fetch(`/api/sessions/${sessionId}/complete`, { method: "POST" });
    router.push(`/practice/${taskId}/report`);
  }

  if (!outline || !currentQuestion) {
    return (
      <div className="grid gap-4">
        <p className="text-muted">本轮问题已完成，可以生成复盘报告。</p>
        <Button onClick={completeSession}>生成 AI 复盘</Button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <section className="rounded-lg border border-line bg-ink p-6 text-white">
        <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-800 text-center">
          <div>
            <p className="text-sm opacity-70">AI 数字人面试官</p>
            <p className="mt-2 text-2xl font-semibold">实时模拟</p>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-200">{outline.summary}</p>
      </section>
      <section className="rounded-lg border border-line bg-panel p-6">
        <p className="text-xs font-medium text-brand">{currentQuestion.stage}</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">{currentQuestion.question}</h1>
        <p className="mt-2 text-sm text-muted">{currentQuestion.intent}</p>
        <textarea
          className="mt-6 min-h-48 w-full rounded-md border border-line p-3 text-sm"
          placeholder="MVP 阶段先用文字输入模拟语音转写。后续替换为实时语音识别。"
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
        />
        <div className="mt-4 flex gap-3">
          <Button disabled={!answer.trim()} onClick={submitAnswer}>提交回答</Button>
          <button className="rounded-md border border-line px-4 py-2 text-sm" onClick={() => setAnswer("")}>清空</button>
        </div>
      </section>
    </div>
  );
}
```

Create `app/practice/[taskId]/room/page.tsx`:

```tsx
import { InterviewRoom } from "@/components/practice/InterviewRoom";

export default async function PracticeRoomPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <InterviewRoom taskId={taskId} />
    </main>
  );
}
```

- [ ] **Step 6: Add candidate report page**

Create `components/practice/CandidateReport.tsx`:

```tsx
import { Card } from "@/components/ui/Card";

type CandidateReportProps = {
  report: {
    overallScore: number;
    weakTags: string;
    nextTrainingPlan: string;
    candidateSummary: string;
  };
};

export function CandidateReport({ report }: CandidateReportProps) {
  const weakTags = JSON.parse(report.weakTags) as string[];
  const nextTrainingPlan = JSON.parse(report.nextTrainingPlan) as string[];

  return (
    <Card>
      <p className="text-sm font-medium text-brand">AI 复盘报告</p>
      <h1 className="mt-2 text-3xl font-semibold text-ink">{report.overallScore} 分</h1>
      <p className="mt-3 text-muted">{report.candidateSummary}</p>
      <h2 className="mt-6 font-semibold text-ink">最需要改进的问题</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {weakTags.map((tag) => (
          <span key={tag} className="rounded-md bg-slate-100 px-2 py-1 text-sm text-muted">{tag}</span>
        ))}
      </div>
      <h2 className="mt-6 font-semibold text-ink">下一轮训练计划</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
        {nextTrainingPlan.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    </Card>
  );
}
```

Create `app/practice/[taskId]/report/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { CandidateReport } from "@/components/practice/CandidateReport";
import { prisma } from "@/lib/db/prisma";

export default async function PracticeReportPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const session = await prisma.trainingSession.findFirst({
    where: { taskId, status: "COMPLETED" },
    include: { report: true },
    orderBy: { endedAt: "desc" }
  });

  if (!session?.report) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <CandidateReport report={session.report} />
      <div className="mt-6">
        <Link className="text-sm font-medium text-brand" href={`/practice/${taskId}`}>
          再练一次
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/api/sessions app/practice components/practice
git commit -m "feat: add candidate practice flow"
```

## Task 8: Build Backend Report View

**Files:**
- Create: `components/admin/ReportView.tsx`
- Create: `app/admin/reports/[sessionId]/page.tsx`

- [ ] **Step 1: Add report view component**

Create `components/admin/ReportView.tsx`:

```tsx
import { Card } from "@/components/ui/Card";

type ReportViewProps = {
  session: {
    status: string;
    task: { title: string; targetCompany: string; targetRole: string };
    candidate: { name: string };
    turns: Array<{ id: string; stage: string; question: string; answer: string; feedback: string | null }>;
    report: {
      overallScore: number;
      subScores: string;
      perQuestionFeedback: string;
      expressionAnalysis: string;
      answerQualityAnalysis: string;
      strategySuggestions: string;
      weakTags: string;
      nextTrainingPlan: string;
    } | null;
  };
};

export function ReportView({ session }: ReportViewProps) {
  const report = session.report;
  const subScores = report ? (JSON.parse(report.subScores) as Record<string, number>) : {};
  const perQuestion = report ? (JSON.parse(report.perQuestionFeedback) as Array<{ question: string; feedback: string; suggestion: string }>) : [];
  const weakTags = report ? (JSON.parse(report.weakTags) as string[]) : [];
  const nextPlan = report ? (JSON.parse(report.nextTrainingPlan) as string[]) : [];

  return (
    <div className="grid gap-6">
      <Card>
        <p className="text-sm font-medium text-brand">后台完整报告</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">{session.task.title}</h1>
        <p className="mt-2 text-muted">{session.candidate.name} · {session.task.targetCompany} · {session.task.targetRole}</p>
      </Card>
      {report ? (
        <>
          <Card>
            <h2 className="font-semibold text-ink">综合评分：{report.overallScore}</h2>
            <div className="mt-3 grid gap-2 md:grid-cols-4">
              {Object.entries(subScores).map(([name, score]) => (
                <div key={name} className="rounded-md bg-slate-50 p-3 text-sm">
                  <p className="text-muted">{name}</p>
                  <p className="mt-1 text-xl font-semibold text-ink">{score}</p>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <h2 className="font-semibold text-ink">逐题反馈</h2>
            <div className="mt-3 grid gap-3">
              {perQuestion.map((item) => (
                <div key={item.question} className="rounded-md border border-line p-3 text-sm">
                  <p className="font-medium text-ink">{item.question}</p>
                  <p className="mt-2 text-muted">{item.feedback}</p>
                  <p className="mt-2 text-muted">建议：{item.suggestion}</p>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <h2 className="font-semibold text-ink">策略与复训</h2>
            <p className="mt-2 text-sm text-muted">{report.strategySuggestions}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {weakTags.map((tag) => (
                <span key={tag} className="rounded-md bg-slate-100 px-2 py-1 text-sm text-muted">{tag}</span>
              ))}
            </div>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
              {nextPlan.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </Card>
        </>
      ) : (
        <Card>
          <p className="text-muted">本次训练尚未生成报告。</p>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add admin report route**

Create `app/admin/reports/[sessionId]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportView } from "@/components/admin/ReportView";
import { prisma } from "@/lib/db/prisma";

export default async function AdminReportPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    include: {
      candidate: true,
      task: true,
      turns: { orderBy: { createdAt: "asc" } },
      report: true
    }
  });

  if (!session) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Link className="text-sm font-medium text-brand" href={`/admin/tasks/${session.taskId}`}>返回训练任务</Link>
      <div className="mt-4">
        <ReportView session={session} />
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/admin/reports components/admin/ReportView.tsx
git commit -m "feat: add backend report view"
```

## Task 9: Add Report Domain Helpers and Tests

**Files:**
- Create: `lib/domain/reports.ts`
- Create: `tests/unit/reports.test.ts`

- [ ] **Step 1: Write failing report helper tests**

Create `tests/unit/reports.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getTopWeakTags, parseJsonList } from "@/lib/domain/reports";

describe("report helpers", () => {
  it("parses JSON lists safely", () => {
    expect(parseJsonList<string>('["表达结构","量化结果"]')).toEqual(["表达结构", "量化结果"]);
    expect(parseJsonList<string>("bad-json")).toEqual([]);
  });

  it("limits top weak tags", () => {
    expect(getTopWeakTags(["表达结构", "量化结果", "追问稳定性", "语速控制"], 3)).toEqual([
      "表达结构",
      "量化结果",
      "追问稳定性"
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/unit/reports.test.ts
```

Expected: FAIL because `lib/domain/reports.ts` does not exist.

- [ ] **Step 3: Implement helpers**

Create `lib/domain/reports.ts`:

```ts
export function parseJsonList<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function getTopWeakTags(tags: string[], limit = 3): string[] {
  return tags.slice(0, limit);
}
```

- [ ] **Step 4: Run report tests**

Run:

```bash
npm test -- tests/unit/reports.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/reports.ts tests/unit/reports.test.ts
git commit -m "test: add report parsing helpers"
```

## Task 10: Add End-to-End MVP Flow Test

**Files:**
- Create: `tests/e2e/mvp-flow.spec.ts`

- [ ] **Step 1: Write Playwright flow**

Create `tests/e2e/mvp-flow.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("service provider creates a candidate and opens admin", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "进入服务后台" }).click();
  await expect(page.getByRole("heading", { name: "服务后台" })).toBeVisible();

  await page.getByRole("link", { name: "求职者档案" }).click();
  await page.getByLabel("姓名").fill("测试求职者");
  await page.getByLabel("邮箱").fill("candidate@example.com");
  await page.getByLabel("目标公司").fill("示例科技公司");
  await page.getByLabel("目标岗位").fill("产品经理");
  await page.getByRole("button", { name: "创建求职者" }).click();

  await expect(page.getByText("测试求职者")).toBeVisible();
});
```

- [ ] **Step 2: Run E2E test**

Run:

```bash
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/mvp-flow.spec.ts
git commit -m "test: add mvp browser smoke test"
```

## Task 11: Final Verification and Handoff Notes

**Files:**
- Create: `docs/mvp-handoff.md`

- [ ] **Step 1: Create handoff document**

Create `docs/mvp-handoff.md`:

```markdown
# AI 面试训练 MVP 交付说明

## 本地启动

1. 安装依赖：`npm install`
2. 初始化数据库：`npm run db:generate && npm run db:push && npm run db:seed`
3. 启动开发服务：`npm run dev`
4. 打开：`http://127.0.0.1:3000`

## MVP 已实现

- 服务后台入口：`/admin`
- 求职者档案：`/admin/candidates`
- 模板库：`/admin/templates`
- 创建训练任务：`/admin/tasks/new`
- 求职者练习链接：`/practice/:taskId`
- 数字人模拟面试间：`/practice/:taskId/room`
- 求职者报告：`/practice/:taskId/report`
- 后台报告：`/admin/reports/:sessionId`

## 当前模拟能力

- AI 面试官使用 mock provider。
- 数字人视频使用静态视觉替代画面。
- 语音转写使用文本输入模拟。
- 报告生成使用 mock AI 规则。

## 后续替换点

- `lib/ai/mockProvider.ts` 替换为真实大模型 provider。
- `components/practice/InterviewRoom.tsx` 接入实时语音识别、语音合成和数字人视频。
- `AiCallLog` 接入真实延迟、成本和失败记录。
```

- [ ] **Step 2: Run unit tests**

Run:

```bash
npm test
```

Expected: all unit tests pass.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: build completes successfully.

- [ ] **Step 4: Run E2E tests**

Run:

```bash
npm run test:e2e
```

Expected: browser smoke test passes.

- [ ] **Step 5: Commit**

```bash
git add docs/mvp-handoff.md
git commit -m "docs: add mvp handoff notes"
```

## Self-Review Checklist

- Spec coverage:
  - Service backend: covered by Tasks 5, 6, and 8.
  - Candidate practice link and room: covered by Task 7.
  - Configurable stages: covered by Tasks 2, 6, and 7.
  - Interviewer templates: covered by Tasks 2, 3, and 6.
  - Multi-provider AI architecture: covered by Task 4 with provider adapter boundary.
  - Reports and next training plan: covered by Tasks 4, 7, 8, and 9.
  - Data persistence: covered by Task 3.
  - Testing: covered by Tasks 2, 4, 9, 10, and 11.

- MVP boundary:
  - Real digital-human and voice providers are intentionally mocked behind adapters.
  - High-fidelity video, native apps, payments, and complex SaaS permissions are out of scope.

- Verification commands:
  - `npm test`
  - `npm run build`
  - `npm run test:e2e`
