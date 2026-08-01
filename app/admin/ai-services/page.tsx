import { AdminShell } from "@/components/admin/AdminShell";
import { AiDiagnosticsPanel } from "@/components/admin/AiDiagnosticsPanel";
import { AiServiceConfigPanel } from "@/components/admin/AiServiceConfigPanel";
import { DigitalHumanVideoConfigPanel } from "@/components/admin/DigitalHumanVideoConfigPanel";
import { getAllAiDiagnostics } from "@/lib/ai/diagnostics";
import { prisma } from "@/lib/db/prisma";
import { loadDigitalHumanVideoConfig } from "@/app/api/ai-services/digital-human-video-runtime/handler";
import {
  multimodalTakeoverSettingKey,
  parseMultimodalTakeoverSettings
} from "@/lib/domain/multimodalTakeover";

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
  const [providers, models, diagnostics, multimodalTakeoverRow, videoConfig] = await Promise.all([
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
    }),
    getAllAiDiagnostics(),
    prisma.aiRuntimeSetting.findUnique({
      where: { key: multimodalTakeoverSettingKey }
    }),
    loadDigitalHumanVideoConfig()
  ]);

  return (
    <AdminShell
      active="ai-services"
      eyebrow="AI 配置中心"
      title="模型与服务商"
      description="配置不同 AI 服务商、模型和调用能力。密钥保存后只显示掩码，不会在后台页面展示原文。"
      backHref={"/admin"}
      backLabel="返回后台"
    >
      <div className="grid gap-6">
        <DigitalHumanVideoConfigPanel
          initialConfig={videoConfig.runtime}
          models={videoConfig.models}
          profiles={videoConfig.profiles}
          storage={videoConfig.storage}
        />
        <AiDiagnosticsPanel initialDiagnostics={diagnostics} />
        <AiServiceConfigPanel
          initialProviders={providers}
          initialModels={models}
          initialMultimodalTakeover={parseMultimodalTakeoverSettings(multimodalTakeoverRow?.valueJson)}
        />
      </div>
    </AdminShell>
  );
}
