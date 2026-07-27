import { ensureJsonResponse, numberSetting, parseConnectorSettings, type ConnectorSearchTemplate, type ConnectorSource, type RecruitmentConnector, type RecruitmentFetch } from "@/lib/recruitment/connectors/base";
import { decryptSourceApiKey } from "@/lib/recruitment/connectors/credentials";
import { parseDate } from "@/lib/recruitment/connectors/text";

type JoobleConnectorOptions = {
  fetch?: RecruitmentFetch;
  secret?: string;
};

type JoobleJob = {
  id?: string | number;
  title?: string;
  company?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  link?: string;
  updated?: string;
};

function asJoobleJobs(payload: unknown) {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { jobs?: unknown }).jobs)) {
    throw Object.assign(new Error("jooble parser changed: missing jobs array"), { status: 200 });
  }

  return {
    total: typeof (payload as { totalCount?: unknown }).totalCount === "number" ? (payload as { totalCount: number }).totalCount : undefined,
    jobs: (payload as { jobs: JoobleJob[] }).jobs
  };
}

export function createJoobleConnector(options: JoobleConnectorOptions = {}): RecruitmentConnector {
  const fetcher = options.fetch || fetch;

  return {
    provider: "jooble",
    sourceType: "AGGREGATED_API",
    async verify(source) {
      await this.search(source, { id: "verify", keywords: "software" });
      return { ok: true, status: "VERIFIED" };
    },
    async search(source: ConnectorSource, template: ConnectorSearchTemplate) {
      const settings = parseConnectorSettings(source);
      const apiKey = decryptSourceApiKey(source, options.secret);
      const resultOnPage = numberSetting(settings, "resultOnPage", 50);
      const response = await fetcher(`https://jooble.org/api/${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          keywords: template.keywords,
          location: template.city || template.country || "",
          page: 1,
          ResultOnPage: resultOnPage,
          companysearch: "false"
        })
      });
      const { jobs, total } = asJoobleJobs(await ensureJsonResponse(response, "jooble"));

      return {
        total,
        postings: jobs.map((job) => ({
          provider: "jooble",
          sourceType: "AGGREGATED_API" as const,
          title: job.title || "",
          company: job.company || null,
          location: job.location || null,
          salary: job.salary || null,
          description: job.snippet || "",
          requirements: [],
          sourceUrl: job.link || null,
          externalJobId: job.id === undefined ? null : String(job.id),
          publishedAt: parseDate(job.updated),
          rawJson: job
        })).filter((job) => job.title && job.description)
      };
    }
  };
}
