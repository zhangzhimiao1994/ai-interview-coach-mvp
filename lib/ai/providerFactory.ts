import { mockAiProvider } from "./mockProvider";
import { createAiOrchestrator } from "./orchestrator";
import type { AiProvider } from "./types";

const supportedProviders = ["mock"] as const;

export type AiProviderName = (typeof supportedProviders)[number];

function readProviderName(env: Record<string, string | undefined>): AiProviderName {
  const configuredProvider = env.AI_PROVIDER?.trim().toLowerCase() || "mock";

  if (configuredProvider === "mock") {
    return configuredProvider;
  }

  throw new Error(
    `Unsupported AI_PROVIDER "${env.AI_PROVIDER}". Supported values: ${supportedProviders.join(", ")}.`
  );
}

export function createConfiguredAiOrchestrator(
  env: Record<string, string | undefined> = process.env
): AiProvider {
  const providerName = readProviderName(env);

  switch (providerName) {
    case "mock":
      return createAiOrchestrator({ provider: mockAiProvider });
  }
}
