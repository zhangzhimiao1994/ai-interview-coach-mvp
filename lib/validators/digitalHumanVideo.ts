import { z } from "zod";
import { videoRenderModes, type DigitalHumanVideoRuntimeSettings } from "@/lib/media/video/types";

const requiredId = z.string().trim().min(1);

export const digitalHumanVideoRuntimeSettingsSchema = z
  .object({
    mode: z.enum(videoRenderModes),
    maxWaitMs: z.literal(8000),
    lingmouPollMs: z.tuple([z.literal(3000), z.literal(6000)]),
    emoPollMs: z.tuple([z.literal(8000)]),
    synchronizeProfiles: z.boolean(),
    primaryProfileId: requiredId,
    secondaryProfileId: requiredId.nullable(),
    lingmouModelId: requiredId,
    emoModelId: requiredId
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.synchronizeProfiles && value.secondaryProfileId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["secondaryProfileId"],
        message: "A secondary profile is required when profiles are not synchronized"
      });
    }
  });

export function validateDigitalHumanVideoRuntimeSettings(value: unknown): DigitalHumanVideoRuntimeSettings {
  return digitalHumanVideoRuntimeSettingsSchema.parse(value);
}
