import { buildSearchUrl, ensureJsonResponse, numberSetting, parseConnectorSettings, textSetting, type ConnectorSearchTemplate, type ConnectorSource, type RecruitmentConnector, type RecruitmentFetch } from "@/lib/recruitment/connectors/base";
import { decryptSourceApiKey } from "@/lib/recruitment/connectors/credentials";
import { parseDate } from "@/lib/recruitment/connectors/text";

type AdzunaConnectorOptions = {
  fetch?: RecruitmentFetch;
  secret?: string;
};

type AdzunaJob = {
  id?: string | number;
  title?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  description?: string;
  redirect_url?: string;
  created?: string;
};

function asAdzunaJobs(payload: unknown) {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { results?: unknown }).results)) {
    throw Object.assign(new Error("adzuna parser changed: missing results array"), { status: 200 });
  }

  return (payload as { results: AdzunaJob[] }).results;
}

export function createAdzunaConnector(options: AdzunaConnectorOptions = {}): RecruitmentConnector {
  const fetcher = options.fetch || fetch;

  return {
    provider: "adzuna",
    sourceType: "AGGREGATED_API",
    async verify(source) {
      await this.search(source, { id: "verify", keywords: "software", country: "us" });
      return { ok: true, status: "VERIFIED" };
    },
    async search(source: ConnectorSource, template: ConnectorSearchTemplate) {
      const settings = parseConnectorSettings(source);
      const appId = textSetting(settings, "appId");
      if (!appId) throw Object.assign(new Error("ADZUNA_APP_ID_REQUIRED"), { status: 401 });

      const appKey = decryptSourceApiKey(source, options.secret);
      const country = (textSetting(settings, "country") || template.country || "us").toLowerCase();
      const page = numberSetting(settings, "page", 1);
      const pageSize = numberSetting(settings, "pageSize", 50);
      const url = buildSearchUrl(`https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/${page}`, {
        app_id: appId,
        app_key: appKey,
        what: template.keywords,
        where: template.city || undefined,
        results_per_page: pageSize,
        content_type: "application/json"
      });
      const payload = await ensureJsonResponse(await fetcher(url, { headers: { Accept: "application/json" } }), "adzuna");
      const jobs = asAdzunaJobs(payload);

      return {
        postings: jobs.map((job) => ({
          provider: "adzuna",
          sourceType: "AGGREGATED_API" as const,
          title: job.title || "",
          company: job.company?.display_name || null,
          location: job.location?.display_name || null,
          salary: null,
          description: job.description || "",
          requirements: [],
          sourceUrl: job.redirect_url || null,
          externalJobId: job.id === undefined ? null : String(job.id),
          publishedAt: parseDate(job.created),
          rawJson: job
        })).filter((job) => job.title && job.description)
      };
    }
  };
}
