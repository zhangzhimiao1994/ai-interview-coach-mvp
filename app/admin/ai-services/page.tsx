import { AiServiceConfigPanel } from "@/components/admin/AiServiceConfigPanel";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const modelInclude = {
  provider: {
    select: {
      id: true,
      displayName: true,
      providerType: true,
      enabled: true
    }
  }
} as const;

export default async function AiServicesPage() {
  const [providers, models] = await Promise.all([
    prisma.aiServiceProvider.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        displayName: true,
        providerType: true,
        baseUrl: true,
        apiKeyPreview: true,
        enabled: true,
        notes: true
      }
    }),
    prisma.aiModelConfig.findMany({
      orderBy: [{ capability: "asc" }, { createdAt: "desc" }],
      include: modelInclude
    })
  ]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <p className="text-sm font-medium text-brand">AI 配置中心</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">模型与服务商</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          配置不同 AI 服务商、模型和调用能力。密钥保存后只显示掩码，不会在后台页面展示原文。
        </p>
      </div>
      <AiServiceConfigPanel initialProviders={providers} initialModels={models} />
    </main>
  );
}
