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
  if (!validApplicationOrigin(env.APP_ORIGIN)) {
    errors.push(
      "APP_ORIGIN must be an absolute http/https origin without credentials, path, query, or fragment"
    );
  }
  if (isMissingOrPlaceholder(env.ADMIN_PASSWORD)) {
    errors.push("ADMIN_PASSWORD must be set to a non-placeholder value");
  }
  if (isMissingOrPlaceholder(env.AI_CONFIG_SECRET)) {
    errors.push("AI_CONFIG_SECRET must be set to a non-placeholder value");
  }
  if (isMissingOrPlaceholder(env.RECRUITMENT_SESSION_SECRET) || env.RECRUITMENT_SESSION_SECRET.trim().length < 32) {
    errors.push(
      "RECRUITMENT_SESSION_SECRET must be set to a non-placeholder value of at least 32 characters; it encrypts recruitment API credentials and browser session state"
    );
  }

  if (errors.length > 0) {
    throw new Error(`Invalid production configuration: ${errors.join("; ")}`);
  }
}

function validApplicationOrigin(value) {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value.trim());
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
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
