import type { NormalizedRecruitmentPostingInput, RecruitmentRunStatus, RecruitmentSourceType } from "@/lib/recruitment/types";
import { createAdzunaConnector } from "@/lib/recruitment/connectors/adzuna";
import { createGreenhouseConnector } from "@/lib/recruitment/connectors/greenhouse";
import { createJoobleConnector } from "@/lib/recruitment/connectors/jooble";
import { createLeverConnector } from "@/lib/recruitment/connectors/lever";
import { createUsaJobsConnector } from "@/lib/recruitment/connectors/usajobs";

export type RecruitmentFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type ConnectorSource = {
  id: string;
  provider: string;
  sourceType: Exclude<RecruitmentSourceType, "MANUAL"> | RecruitmentSourceType;
  displayName: string;
  enabled: boolean;
  credentialCiphertext?: string | null;
  credentialIv?: string | null;
  credentialTag?: string | null;
  sessionCiphertext?: string | null;
  sessionIv?: string | null;
  sessionTag?: string | null;
  settingsJson: string;
};

export type ConnectorSearchTemplate = {
  id: string;
  keywords: string;
  roleType?: string | null;
  city?: string | null;
  country?: string | null;
  experienceRange?: string | null;
  salaryRange?: string | null;
  language?: string | null;
  remoteMode?: string | null;
};

export type ConnectorVerification = {
  ok: boolean;
  status: RecruitmentRunStatus | "VERIFIED";
  message?: string;
};

export type ConnectorSearchResult = {
  postings: NormalizedRecruitmentPostingInput[];
  total?: number;
  logs?: unknown[];
};

export type RecruitmentConnector = {
  provider: string;
  sourceType: Exclude<RecruitmentSourceType, "MANUAL">;
  verify(source: ConnectorSource): Promise<ConnectorVerification>;
  search(source: ConnectorSource, template: ConnectorSearchTemplate): Promise<ConnectorSearchResult>;
};

export type ConnectorFailure = {
  status?: number;
  message?: string;
};

export function parseConnectorSettings(source: Pick<ConnectorSource, "settingsJson">) {
  try {
    const parsed = JSON.parse(source.settingsJson || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function textSetting(settings: Record<string, unknown>, key: string) {
  const value = settings[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function numberSetting(settings: Record<string, unknown>, key: string, fallback: number) {
  const value = settings[key];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

export function buildSearchUrl(baseUrl: string, params: Record<string, string | number | boolean | null | undefined>) {
  const url = new URL(baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

export function classifyRecruitmentFailure(error: ConnectorFailure): RecruitmentRunStatus {
  if (error.status === 401 || error.status === 403) return "AUTH_REQUIRED";
  if (error.status === 429) return "RATE_LIMITED";
  if (error.status === 200) return "PARSER_CHANGED";
  if (error.status && error.status >= 500) return "SOURCE_UNAVAILABLE";

  const message = (error.message || "").toLowerCase();
  if (message.includes("unauthorized") || message.includes("forbidden") || message.includes("auth")) return "AUTH_REQUIRED";
  if (message.includes("rate")) return "RATE_LIMITED";
  if (message.includes("shape") || message.includes("parse")) return "PARSER_CHANGED";
  if (message.includes("timeout") || message.includes("network") || message.includes("unavailable")) return "SOURCE_UNAVAILABLE";

  return "FAILED";
}

function redactValue(key: string, value: unknown): unknown {
  if (/authorization|api[_-]?key|app[_-]?key|token|secret|cookie|session|password/i.test(key)) {
    return "[REDACTED]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactRecruitmentLog(item));
  }

  if (value && typeof value === "object") {
    return redactRecruitmentLog(value);
  }

  return value;
}

function redactUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/api[_-]?key|app[_-]?key|token|secret|authorization|key/i.test(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    return url.toString();
  } catch {
    return value.replace(/(api[_-]?key|app[_-]?key|token|secret|authorization|key)=([^&\s]+)/gi, "$1=[REDACTED]");
  }
}

export function redactRecruitmentLog<T>(input: T): T {
  if (typeof input === "string") {
    return redactUrl(input) as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactRecruitmentLog(item)) as T;
  }

  if (input && typeof input === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      result[key] = key.toLowerCase() === "url" && typeof value === "string" ? redactUrl(value) : redactValue(key, value);
    }
    return result as T;
  }

  return input;
}

export async function ensureJsonResponse(response: Response, provider: string) {
  if (!response.ok) {
    throw Object.assign(new Error(`${provider} connector request failed with status ${response.status}`), { status: response.status });
  }

  try {
    return await response.json() as unknown;
  } catch (error) {
    throw Object.assign(new Error(`${provider} parser changed: invalid JSON response`), {
      status: 200,
      cause: error
    });
  }
}

export function createRecruitmentConnectorRegistry(connectors: RecruitmentConnector[] = []) {
  const registry = new Map(connectors.map((connector) => [connector.provider, connector]));

  if (registry.size === 0) {
    for (const connector of [
      createAdzunaConnector(),
      createJoobleConnector(),
      createGreenhouseConnector(),
      createLeverConnector(),
      createUsaJobsConnector()
    ]) {
      registry.set(connector.provider, connector);
    }
  }

  return {
    get(provider: string) {
      const connector = registry.get(provider);
      if (!connector) {
        throw new Error(`RECRUITMENT_CONNECTOR_NOT_SUPPORTED:${provider}`);
      }
      return connector;
    },
    listProviders() {
      return [...registry.keys()].sort();
    }
  };
}
