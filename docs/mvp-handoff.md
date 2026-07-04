# AI 面试训练 MVP 交付说明

## 本地启动

1. 安装依赖：`npm install`
2. 初始化数据库：`npm run db:generate && npm run db:push && npm run db:seed`
3. 构建生产包：`npm run build`
4. 启动开发服务：`npm run dev`
5. 打开：`http://127.0.0.1:3000`

## Linux 部署

优先使用 Docker Compose：

```bash
cp .env.example .env
docker compose up -d --build
```

也支持 Linux 裸机部署：

```bash
cp .env.example .env
chmod +x scripts/linux/*.sh
scripts/linux/setup.sh
scripts/linux/start.sh
```

完整说明见 `docs/linux-deployment.md`。

## 验证命令

- 单元测试：`npm test`
- 生产构建：`npm run build`
- 端到端测试：`npm run test:e2e`

`npm run test:e2e` 会启动 `next start` 并运行 Playwright。首次运行前需要安装 Playwright Chromium。

## MVP 已实现

- 服务后台入口：`/admin`
- 求职者档案：`/admin/candidates`
- 模板库：`/admin/templates`
- 创建训练任务：`/admin/tasks/new`
- 训练任务详情：`/admin/tasks/:taskId`
- 求职者练习链接：`/practice/:taskId`
- 数字人模拟面试间：`/practice/:taskId/room`
- 求职者报告：`/practice/:taskId/report`
- 后台完整报告：`/admin/reports/:sessionId`

## 当前模拟能力

- AI 面试官使用 mock provider。
- 数字人视频使用静态视觉替代画面。
- 语音转写使用文本输入模拟。
- 报告生成使用 mock AI 规则。
- 多服务商能力通过 AI provider adapter 预留。

## 后续替换点

- `lib/ai/mockProvider.ts`：替换为真实大模型 provider。
- `lib/ai/providerFactory.ts`：扩展 `AI_PROVIDER` 选择逻辑。
- `components/practice/InterviewRoom.tsx`：接入实时语音识别、语音合成和数字人视频。
- `AiCallLog`：接入真实延迟、成本、失败原因和 fallback provider。
- 数据治理：后续实现删除/归档接口时，再明确级联删除或保留策略。
