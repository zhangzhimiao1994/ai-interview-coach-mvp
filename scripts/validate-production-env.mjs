import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const placeholder = "change-this-before-production";

export function validateProductionEnvironment(env) {
  if (env.NODE_ENV !== "production") {
    return;
  }

  const errors = [];
  const isMissingOrPlaceholder = (value) => !value?.trim() || value.trim() === placeholder;

  if (!env.DATABASE_URL?.trim()) {
    errors.push("DATABASE_URL must be set");
  }
  if (isMissingOrPlaceholder(env.ADMIN_PASSWORD)) {
    errors.push("ADMIN_PASSWORD must be set to a non-placeholder value");
  }
  if (isMissingOrPlaceholder(env.AI_CONFIG_SECRET)) {
    errors.push("AI_CONFIG_SECRET must be set to a non-placeholder value");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid production configuration: ${errors.join("; ")}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    validateProductionEnvironment(process.env);
    console.log("Production environment validation passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
