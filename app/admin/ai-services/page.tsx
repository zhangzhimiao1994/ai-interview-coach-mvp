import { AdminShell } from "@/components/admin/AdminShell";
import { AiDiagnosticsPanel } from "@/components/admin/AiDiagnosticsPanel";
import { AiServiceConfigPanel } from "@/components/admin/AiServiceConfigPanel";
import { DigitalHumanVideoConfigPanel } from "@/components/admin/DigitalHumanVideoConfigPanel";
import { getAllAiDiagnostics } from "@/lib/ai/diagnostics";
import { prisma } from "@/lib/db/prisma";
import { serializeMediaStorageConfig } from "@/lib/media/storage/ossCredentials";
import { digitalHumanVideoRuntimeSettingKey } from "@/lib/media/video/diagnostics";
import { parseDigitalHumanVideoRuntimeSettings } from "@/lib/media/video/settings";
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
  const [providers, models, diagnostics, multimodalTakeoverRow, videoRuntimeRow, videoProfiles, videoStorage] = await Promise.all([
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
    prisma.aiRuntimeSetting.findUnique({ where: { key: digitalHumanVideoRuntimeSettingKey } }),
    prisma.interviewerAvatarProfile.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.mediaStorageConfig.findFirst({ where: { providerKind: "ALI_OSS" }, orderBy: { updatedAt: "desc" } })
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
          initialConfig={safeVideoRuntime(videoRuntimeRow?.valueJson)}
          models={models.filter((model) => model.capability === "DIGITAL_HUMAN_VIDEO" && model.enabled && model.provider.enabled).map((model) => ({ id: model.id, displayName: model.displayName, modelName: model.modelName, providerType: model.provider.providerType }))}
          profiles={videoProfiles.map((profile) => ({ id: profile.id, displayName: profile.displayName, enabled: profile.enabled, voice: profile.voice, portraitAssetId: profile.portraitAssetId, style: safeObject(profile.styleJson), lingmouMapping: safeObject(profile.lingmouMappingJson), emoMapping: safeObject(profile.emoMappingJson), providerRole: profile.providerRole, complete: Boolean(profile.portraitAssetId && profile.voice.trim() && profile.lingmouMappingJson !== "{}" && profile.emoMappingJson !== "{}") }))}
          storage={videoStorage ? serializeMediaStorageConfig(videoStorage) : null}
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

function safeVideoRuntime(value: string | null | undefined) {
  try { return value ? parseDigitalHumanVideoRuntimeSettings(value) : null; } catch { return null; }
}

function safeObject(value: string): Record<string, unknown> {
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}
