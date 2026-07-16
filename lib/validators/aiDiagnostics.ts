import { z } from "zod";
import { aiCapabilities } from "@/lib/domain/aiServiceConstants";

export const aiDiagnosticRequestSchema = z
  .object({
    capability: z.enum(aiCapabilities),
    liveCheck: z.boolean()
  })
  .strict();

export function parseAiDiagnosticRequest(input: unknown) {
  return aiDiagnosticRequestSchema.parse(input);
}
