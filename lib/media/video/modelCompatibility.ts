import type { ResolvedMediaModel } from "@/lib/media/config";
import { resolveAlibabaEmoConfiguration, type AlibabaEmoConfiguration } from "./providers/alibabaEmo";
import { resolveLingmouBroadcastConfiguration, type LingmouBroadcastConfiguration } from "./providers/lingmouBroadcast";

export type VideoModelSlot = "LINGMOU_BROADCAST" | "ALIBABA_EMO";
export type CompatibleVideoModel =
  | { slot: "LINGMOU_BROADCAST"; model: ResolvedMediaModel; configuration: LingmouBroadcastConfiguration }
  | { slot: "ALIBABA_EMO"; model: ResolvedMediaModel; configuration: AlibabaEmoConfiguration };

export function assertCompatibleVideoModel(
  model: ResolvedMediaModel,
  slot: VideoModelSlot,
  readConfigSecret: () => string
): CompatibleVideoModel {
  return slot === "LINGMOU_BROADCAST"
    ? { slot, model, configuration: resolveLingmouBroadcastConfiguration(model, readConfigSecret) }
    : { slot, model, configuration: resolveAlibabaEmoConfiguration(model, readConfigSecret) };
}
