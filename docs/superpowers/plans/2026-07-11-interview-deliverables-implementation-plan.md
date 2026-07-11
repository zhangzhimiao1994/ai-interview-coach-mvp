# 面试训练交付物实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让面试提纲成为可执行的中文作战手册，并将最终报告升级为有回答证据的求职者版和顾问版交付物。

**Architecture:** 在 `TrainingSession` 保存生成后的完整提纲，以问题 ID 建立回答与提纲的稳定关联；在 `CoachingReport` 增加一个 JSON 详情列保存扩展报告。AI 服务商、Mock 服务商和页面都只使用同一个扩展后的领域类型，旧报告由反序列化默认值兼容。

**Tech Stack:** Next.js 15、React 19、TypeScript、Zod、Prisma/SQLite、Vitest、Tailwind CSS。

---

### Task 1: 持久化提纲并建立问题关联

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260711174500_persist_session_outline/migration.sql`
- Modify: `app/api/sessions/route.ts`
- Modify: `app/api/sessions/[sessionId]/answer/route.ts`
- Modify: `app/api/sessions/[sessionId]/complete/route.ts`
- Modify: `tests/unit/session-api.test.ts`

- [ ] **Step 1: 写出会话保存提纲和回答校验的失败测试**

```ts
expect(prisma.trainingSession.update).toHaveBeenCalledWith({
  where: { id: "session-1" },
  data: { outlineJson: JSON.stringify(outline) }
});

await expect(postAnswer("unknown-question-id")).resolves.toMatchObject({ status: 400 });
```

- [ ] **Step 2: 运行单测并确认因 `outlineJson` 与问题校验尚不存在而失败**

Run: `npm.cmd test -- tests/unit/session-api.test.ts`

Expected: FAIL，断言指出会话更新或 400 校验不存在。

- [ ] **Step 3: 增加非破坏性数据库字段与迁移**

```prisma
model TrainingSession {
  // existing fields
  outlineJson String?
  turns       SessionTurn[]
}

model SessionTurn {
  // existing fields
  questionId String?

  @@unique([sessionId, questionId])
}
```

```sql
ALTER TABLE "TrainingSession" ADD COLUMN "outlineJson" TEXT;
ALTER TABLE "SessionTurn" ADD COLUMN "questionId" TEXT;
CREATE UNIQUE INDEX "SessionTurn_sessionId_questionId_key"
ON "SessionTurn"("sessionId", "questionId");
```

- [ ] **Step 4: 保存提纲，并仅接受已保存提纲中的问题或该问题产生的追问**

```ts
const outline = await aiOrchestrator.generateTrainingOutline(input);
const session = await prisma.trainingSession.create({ data: sessionData });
await prisma.trainingSession.update({
  where: { id: session.id },
  data: { outlineJson: JSON.stringify(outline) }
});

const savedOutline = trainingOutlineSchema.parse(JSON.parse(session.outlineJson));
const matchedQuestion = savedOutline.questions.find((question) => question.id === input.questionId);
if (!matchedQuestion) return NextResponse.json({ error: "Unknown session question" }, { status: 400 });
```

追问使用主问题 ID 加 `::follow-up::<序号>` 生成稳定 ID；完成报告时把 `SessionTurn.questionId` 一并传给 AI。

- [ ] **Step 5: 运行单测并确认通过**

Run: `npm.cmd test -- tests/unit/session-api.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add prisma/schema.prisma prisma/migrations app/api/sessions/route.ts app/api/sessions/[sessionId]/answer/route.ts app/api/sessions/[sessionId]/complete/route.ts tests/unit/session-api.test.ts
git commit -m "feat: persist session interview outlines"
```

### Task 2: 扩展中文提纲与报告领域契约

**Files:**
- Modify: `lib/ai/types.ts`
- Modify: `lib/ai/reportStorage.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260711174600_add_coaching_report_details/migration.sql`
- Modify: `tests/unit/orchestrator.test.ts`
- Modify: `tests/unit/session-api.test.ts`

- [ ] **Step 1: 写出扩展提纲与报告序列化的失败测试**

```ts
expect(outline.trainingObjective).toContain("产品经理");
expect(outline.questions[0].assessmentIntent).toBeTruthy();
expect(report.readinessVerdict.level).toBe("NEEDS_PRACTICE");
expect(report.perQuestionFeedback[0].answerEvidence).toHaveLength(1);
expect(deserializeStoredCoachingReport(legacyRecord).readinessVerdict.level).toBe("INSUFFICIENT_EVIDENCE");
```

- [ ] **Step 2: 运行单测并确认扩展字段不存在而失败**

Run: `npm.cmd test -- tests/unit/orchestrator.test.ts tests/unit/session-api.test.ts`

Expected: FAIL，类型或属性断言提示缺失新字段。

- [ ] **Step 3: 定义完整的数据结构**

```ts
export type TrainingQuestion = {
  id: string;
  stage: TrainingStageType;
  prompt: string;
  assessmentIntent: string;
  expectedFocus: string[];
  answerFramework: string[];
  scoringCriteria: string[];
  followUps: string[];
  difficulty: "LOW" | "MEDIUM" | "HIGH";
  timeLimitSeconds: number;
};

export type ReadinessVerdict = {
  level: "READY" | "NEEDS_PRACTICE" | "HIGH_RISK" | "INSUFFICIENT_EVIDENCE";
  summary: string;
  priorityRisk: string;
};
```

`TrainingOutline` 增加训练目标、核心胜任力、阶段目标和准备清单；`CoachingReportResult` 增加准备度结论、子分项说明、胜任力评估、优先行动、逐题回答证据、评分理由、改进动作、示范结构和七天计划。

- [ ] **Step 4: 将扩展详情保存为 JSON，并为旧报告提供兼容默认值**

```ts
export type SerializedCoachingReportForStorage = {
  // existing stored columns
  detailsJson: string;
};

const legacyDetails = {
  readinessVerdict: {
    level: "INSUFFICIENT_EVIDENCE",
    summary: "该报告由旧版格式生成，请重新完成一次练习以获取证据化分析。",
    priorityRisk: "旧版报告没有保留足够的逐题分析数据。"
  },
  scoreExplanations: {},
  competencyAssessment: [],
  priorityActions: [],
  weeklyPlan: []
};
```

在 `CoachingReport` 模型中新增 `detailsJson String @default("{}")`，新增迁移只添加列；反序列化在 `detailsJson` 为空、无效或缺失时合并上述兼容默认值。

- [ ] **Step 5: 运行单测并确认通过**

Run: `npm.cmd test -- tests/unit/orchestrator.test.ts tests/unit/session-api.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add prisma/schema.prisma prisma/migrations lib/ai/types.ts lib/ai/reportStorage.ts tests/unit/orchestrator.test.ts tests/unit/session-api.test.ts
git commit -m "feat: add evidence based coaching report contract"
```

### Task 3: 让 AI 与 Mock 服务商输出可追溯的中文交付数据

**Files:**
- Modify: `lib/ai/openAiCompatibleProvider.ts`
- Modify: `lib/ai/mockProvider.ts`
- Modify: `tests/unit/openai-compatible-provider.test.ts`
- Modify: `tests/unit/orchestrator.test.ts`

- [ ] **Step 1: 写出服务商中文输出与证据字段的失败测试**

```ts
expect(report.perQuestionFeedback[0]).toMatchObject({
  question: "介绍一个项目",
  answerEvidence: ["我负责增长项目"],
  scoreRationale: expect.any(String),
  improvementAction: expect.any(String),
  suggestedAnswerStructure: expect.any(Array)
});
expect(prompt).toContain("使用中文");
expect(prompt).toContain("不得编造候选人未说过的事实");
```

- [ ] **Step 2: 运行单测并确认当前提示词和 Mock 输出不满足要求**

Run: `npm.cmd test -- tests/unit/openai-compatible-provider.test.ts tests/unit/orchestrator.test.ts`

Expected: FAIL，缺少中文证据约束或扩展字段。

- [ ] **Step 3: 扩展 Zod schema 与 AI 提示词**

```ts
content: "你是一名资深中文面试训练顾问。只返回严格 JSON。所有判断必须引用 input.turns 中的实际回答；证据不足时写明\"证据不足\"，不得虚构项目、数字或原话。"
```

提纲提示词要求针对目标公司、岗位、JD、简历摘要和启用阶段生成胜任力、阶段目标、题目考察意图、答题框架与评分标准。报告提示词要求逐题生成原题、回答证据、评分理由、改进动作和示范结构，同时输出准备度结论、胜任力矩阵、优先行动和七天计划。

- [ ] **Step 4: 为本地演示生成稳定且具体的中文 Mock 数据**

```ts
answerEvidence: [
  `候选人回答中提到：${turn.answer.slice(0, 60) || "证据不足"}`
],
scoreRationale: "回答覆盖了问题背景，但个人行动与量化结果仍需更具体。",
improvementAction: "先用一句话给出结果，再补充你的行动和可验证的指标。"
```

Mock 提纲使用中文岗位、阶段和能力描述，并针对每道题填充考察意图、回答框架与评分标准。

- [ ] **Step 5: 运行单测并确认通过**

Run: `npm.cmd test -- tests/unit/openai-compatible-provider.test.ts tests/unit/orchestrator.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add lib/ai/openAiCompatibleProvider.ts lib/ai/mockProvider.ts tests/unit/openai-compatible-provider.test.ts tests/unit/orchestrator.test.ts
git commit -m "feat: generate Chinese evidence based interview deliverables"
```

### Task 4: 在进入面试前展示作战手册式提纲

**Files:**
- Create: `components/practice/InterviewOutlinePlaybook.tsx`
- Modify: `components/practice/PracticeEntry.tsx`
- Create: `tests/unit/practice-entry.test.tsx`
- Create: `tests/unit/interview-outline-playbook.test.tsx`

- [ ] **Step 1: 写出提纲作战手册的失败渲染测试**

```tsx
expect(markup).toContain("本次训练目标");
expect(markup).toContain("核心胜任力");
expect(markup).toContain("考察意图");
expect(markup).toContain("答题框架");
expect(markup).toContain("评分标准");
expect(markup).toContain("开始视频面试");
```

- [ ] **Step 2: 运行单测并确认组件尚不存在而失败**

Run: `npm.cmd test -- tests/unit/interview-outline-playbook.test.tsx tests/unit/practice-entry.test.tsx`

Expected: FAIL，模块或文本不存在。

- [ ] **Step 3: 创建不嵌套卡片的提纲组件**

```tsx
export function InterviewOutlinePlaybook({ outline, onStart }: Props) {
  return (
    <section aria-label="面试作战手册">
      <h2>本次训练目标</h2>
      <p>{outline.trainingObjective}</p>
      <CompetencyList items={outline.coreCompetencies} />
      <StageObjectives items={outline.stageObjectives} />
      <QuestionTable questions={outline.questions} />
      <PreparationChecklist items={outline.preparationChecklist} />
      <Button onClick={onStart}>开始视频面试</Button>
    </section>
  );
}
```

问题区域以可展开行展示考察意图、答题框架、评分标准、追问方向和限时；主页面保持桌面优先的紧凑布局，小屏幕按单列折叠。

- [ ] **Step 4: 将生成流程改为“生成提纲 → 确认开始 → 进入面试间”**

```ts
setPendingSession({ sessionId: payload.session.id, outline: payload.outline });
sessionStorage.setItem(storageKey(task.id), JSON.stringify(pendingSession));

function enterInterviewRoom() {
  router.push(`/practice/${task.id}/room` as Route);
}
```

生成完成后不立即跳转；提纲确认页使用同一次已保存的 session，避免重复调用模型和产生额外会话。

- [ ] **Step 5: 运行单测并确认通过**

Run: `npm.cmd test -- tests/unit/interview-outline-playbook.test.tsx tests/unit/practice-entry.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add components/practice/InterviewOutlinePlaybook.tsx components/practice/PracticeEntry.tsx tests/unit/interview-outline-playbook.test.tsx tests/unit/practice-entry.test.tsx
git commit -m "feat: show interview outline playbook before practice"
```

### Task 5: 构建中文求职者报告与顾问评估报告

**Files:**
- Modify: `components/practice/CandidateReport.tsx`
- Modify: `components/admin/ReportView.tsx`
- Modify: `tests/unit/admin-report-view.test.tsx`
- Create: `tests/unit/candidate-report.test.tsx`

- [ ] **Step 1: 写出双视图隔离与证据区块的失败测试**

```tsx
expect(candidateMarkup).toContain("面试结论");
expect(candidateMarkup).toContain("优先改进项");
expect(candidateMarkup).toContain("七天训练计划");
expect(candidateMarkup).not.toContain("录用风险评估");

expect(consultantMarkup).toContain("录用风险评估");
expect(consultantMarkup).toContain("证据台账");
expect(consultantMarkup).toContain("胜任力矩阵");
expect(consultantMarkup).toContain("服务跟进建议");
```

- [ ] **Step 2: 运行单测并确认当前页面没有这些区块而失败**

Run: `npm.cmd test -- tests/unit/candidate-report.test.tsx tests/unit/admin-report-view.test.tsx`

Expected: FAIL，页面文本或隔离断言失败。

- [ ] **Step 3: 重构求职者报告为结论优先的中文训练计划**

```tsx
<ReportVerdict verdict={report.readinessVerdict} score={report.overallScore} />
<PriorityActions actions={report.priorityActions} />
<CapabilityScorecard scores={report.subScores} explanations={report.scoreExplanations} />
<QuestionReplay feedback={report.perQuestionFeedback} />
<WeeklyTrainingPlan days={report.nextTrainingPlan.days} />
```

逐题回放必须展示原题、证据、评分理由、下一次怎么回答与示范结构；当证据不足时保持明确提示，不显示假设性优点。

- [ ] **Step 4: 重构顾问报告为完整评估与服务跟进视图**

```tsx
<ConsultantRiskSummary verdict={report.readinessVerdict} />
<EvidenceLedger feedback={report.perQuestionFeedback} />
<CompetencyMatrix items={report.competencyAssessment} />
<SessionReplay turns={session.turns} feedback={report.perQuestionFeedback} />
<ServiceFollowUpPlan actions={report.priorityActions} plan={report.nextTrainingPlan} />
```

顾问页保留原始对话记录，但以 `questionId` 匹配逐题反馈，不再依赖数组下标。

- [ ] **Step 5: 运行单测并确认通过**

Run: `npm.cmd test -- tests/unit/candidate-report.test.tsx tests/unit/admin-report-view.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add components/practice/CandidateReport.tsx components/admin/ReportView.tsx tests/unit/candidate-report.test.tsx tests/unit/admin-report-view.test.tsx
git commit -m "feat: add candidate and consultant report views"
```

### Task 6: 执行数据库、全量测试和构建验证

**Files:**
- Modify if needed: `scripts/linux/migrate.sh`
- Modify if needed: `docker-entrypoint.sh`
- Test: `tests/unit/**/*.test.ts*`

- [ ] **Step 1: 写出生产迁移脚本使用 Prisma migration deploy 的失败检查**

```ts
expect(readFileSync("scripts/linux/migrate.sh", "utf8")).toContain("prisma migrate deploy");
expect(readFileSync("docker-entrypoint.sh", "utf8")).toContain("prisma migrate deploy");
```

- [ ] **Step 2: 运行对应检查并确认现有脚本不满足时失败**

Run: `npm.cmd test -- tests/unit/deployment-scripts.test.ts`

Expected: FAIL（若该测试文件不存在，先创建它，再确认失败原因是脚本仍使用 `db push`）。

- [ ] **Step 3: 让生产启动使用已提交迁移**

```sh
npx prisma migrate deploy
npx prisma generate
```

保留本地开发的 `prisma db push` 命令，但 Linux 与 Docker 生产启动只执行 `migrate deploy`。

- [ ] **Step 4: 生成 Prisma 客户端并应用本地迁移**

Run: `npm.cmd run db:generate`

Run: `npx prisma migrate deploy`

Expected: Prisma Client 生成成功，迁移显示已应用或无待应用迁移。

- [ ] **Step 5: 运行全量质量验证**

Run: `npm.cmd test`

Run: `npm.cmd run build`

Expected: 全部 Vitest 测试通过，Next.js 构建退出码为 0。

- [ ] **Step 6: 提交本任务并推送**

```bash
git add prisma scripts/linux/migrate.sh docker-entrypoint.sh tests/unit/deployment-scripts.test.ts
git commit -m "chore: deploy interview report migrations safely"
git push origin main
```

## 计划自检

- 规格中的提纲、证据链、求职者视图、顾问视图、兼容策略和测试要求均映射到任务 1 至任务 6。
- 计划没有占位步骤；每个代码改动包含目标文件、验证命令与预期结果。
- 报告扩展字段统一由 `CoachingReportResult` 定义，并通过 `detailsJson` 保存，不重复定义第二套接口。
- 每个任务先写失败测试，再以最小实现使其通过，并独立提交。
