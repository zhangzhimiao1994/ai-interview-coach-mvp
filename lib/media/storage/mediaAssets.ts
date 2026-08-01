import { prisma } from "@/lib/db/prisma";
import type { PrivateMediaPurpose } from "./types";

type DigitalHumanMediaAssetWriter = Pick<
  typeof prisma.digitalHumanMediaAsset,
  "create"
>;

export async function persistDigitalHumanMediaAsset(
  input: {
    storageConfigId: string;
    objectKey: string;
    mimeType: string;
    byteLength: number;
    expiresAt: Date | null;
  } & (
    | { purpose: "PORTRAIT"; portraitWidth: number; portraitHeight: number }
    | { purpose: Exclude<PrivateMediaPurpose, "PORTRAIT">; portraitWidth?: never; portraitHeight?: never }
  ),
  assets: DigitalHumanMediaAssetWriter = prisma.digitalHumanMediaAsset
) {
  return assets.create({
    data: {
      storageConfigId: input.storageConfigId,
      objectKey: input.objectKey,
      mimeType: input.mimeType,
      byteLength: input.byteLength,
      purpose: input.purpose,
      ...(input.purpose === "PORTRAIT" ? {
        portraitWidth: input.portraitWidth,
        portraitHeight: input.portraitHeight
      } : {}),
      expiresAt: input.expiresAt
    }
  });
}
