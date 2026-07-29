import { validateDigitalHumanVideoRuntimeSettings } from "@/lib/validators/digitalHumanVideo";
import type { DigitalHumanVideoRuntimeSettings } from "./types";

export function parseDigitalHumanVideoRuntimeSettings(
  value: string | null | undefined
): DigitalHumanVideoRuntimeSettings {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value ?? "");
  } catch {
    throw new Error("DIGITAL_HUMAN_VIDEO_RUNTIME_SETTINGS_INVALID_JSON");
  }

  return validateDigitalHumanVideoRuntimeSettings(parsed);
}
