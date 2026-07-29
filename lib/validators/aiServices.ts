import { z } from "zod";
import { aiCapabilities, aiProviderTypes } from "@/lib/domain/aiServiceConstants";

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional()
);
const unsafeRecordKeys = new Set(["__proto__", "prototype", "constructor"]);
const recordKey = z.string().refine((key) => {
  const normalized = key.trim();
  return normalized.length > 0 && !unsafeRecordKeys.has(normalized);
}, "Invalid record key");
const primitiveSetting = z.union([z.string(), z.number().finite(), z.boolean()]);
const modelPrimitiveSetting = z.union([primitiveSetting, z.null()]);

const lingmouBroadcastVideoSettingsSchema = z
  .object({
    templateId: z.string().trim().min(1),
    audioVariableName: z.string().trim().min(1),
    portraitVariableName: z.string().trim().min(1).nullable(),
    resolution: z.string().trim().min(1),
    fps: z.number().int().positive(),
    watermark: z.boolean(),
    mode: z.string().trim().min(1)
  })
  .strict();

const alibabaEmoVideoSettingsSchema = z
  .object({
    model: z.literal("emo-v1"),
    ratio: z.enum(["1:1", "3:4"])
  })
  .strict();

const videoAwareModelSettingsSchema = z
  .record(recordKey, modelPrimitiveSetting)
  .superRefine((settings, context) => {
    const looksLikeLingmouVideo = [
      "templateId",
      "audioVariableName",
      "portraitVariableName"
    ].some((key) => key in settings);
    const schema =
      settings.model === "emo-v1"
        ? alibabaEmoVideoSettingsSchema
        : looksLikeLingmouVideo
          ? lingmouBroadcastVideoSettingsSchema
          : null;
    if (!schema) return;

    const result = schema.safeParse(settings);
    if (!result.success) {
      for (const issue of result.error.issues) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: issue.path,
          message: issue.message
        });
      }
    }
  });

export const aiServiceProviderInputSchema = z
  .object({
    displayName: z.string().trim().min(1, "Provider name is required"),
    providerType: z.enum(aiProviderTypes),
    baseUrl: optionalText,
    apiKey: optionalText,
    credentials: z.record(recordKey, z.string().trim().min(1).max(500)).default({}),
    settings: z.record(recordKey, primitiveSetting).default({}),
    enabled: z.boolean().default(true),
    notes: optionalText
  })
  .strict();

export const aiModelConfigInputSchema = z
  .object({
    providerId: z.string().trim().min(1, "Provider is required"),
    displayName: z.string().trim().min(1, "Model display name is required"),
    modelName: z.string().trim().min(1, "Model name is required"),
    capability: z.enum(aiCapabilities),
    temperature: z.number().finite().min(0).max(2).default(0.4),
    maxTokens: z.number().finite().int().positive().max(200000).default(1200),
    timeoutMs: z.number().finite().int().min(1000).max(300000).default(30000),
    settings: videoAwareModelSettingsSchema.default({}),
    costNote: optionalText,
    enabled: z.boolean().default(true),
    isDefault: z.boolean().default(false),
    isSelected: z.boolean().default(false)
  })
  .strict();

export type AiServiceProviderInput = z.infer<typeof aiServiceProviderInputSchema>;
export type AiModelConfigInput = z.infer<typeof aiModelConfigInputSchema>;

export function parseAiServiceProviderInput(input: unknown): AiServiceProviderInput {
  return aiServiceProviderInputSchema.parse(input);
}

export function parseAiModelConfigInput(input: unknown): AiModelConfigInput {
  return aiModelConfigInputSchema.parse(input);
}
