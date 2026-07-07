import { mockAiProvider } from "./mockProvider";
import { createAiOrchestrator } from "./orchestrator";
import { createDbConfiguredAiProvider } from "./dbConfiguredProvider";
import type { AiProvider } from "./types";

const supportedProviders = ["database", "mock"] as const;

export type AiProviderName = (typeof supportedProviders)[number];

function readProviderName(env: Record<string, string | undefined>): AiProviderName {
  const configuredProvider = env.AI_PROVIDER?.trim().toLowerCase() || "database";

  if (configuredProvider === "db") {
    return "database";
  }

  if (configuredProvider === "database" || configuredProvider === "mock") {
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
    case "database":
      return createAiOrchestrator({ provider: createDbConfiguredAiProvider() });
    case "mock":
      return createAiOrchestrator({ provider: mockAiProvider });
  }
}
