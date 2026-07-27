import { ensureJsonResponse, parseConnectorSettings, textSetting, type ConnectorSearchTemplate, type ConnectorSource, type RecruitmentConnector, type RecruitmentFetch } from "@/lib/recruitment/connectors/base";
import { hasKeywordMatch, parseDate, stripHtml } from "@/lib/recruitment/connectors/text";

type GreenhouseConnectorOptions = {
  fetch?: RecruitmentFetch;
};

type GreenhouseJob = {
  id?: string | number;
  title?: string;
  location?: { name?: string };
  absolute_url?: string;
  updated_at?: string;
  content?: string;
  departments?: Array<{ name?: string }>;
};

function asGreenhouseJobs(payload: unknown) {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { jobs?: unknown }).jobs)) {
    throw Object.assign(new Error("greenhouse parser changed: missing jobs array"), { status: 200 });
  }

  return (payload as { jobs: GreenhouseJob[] }).jobs;
}

export function createGreenhouseConnector(options: GreenhouseConnectorOptions = {}): RecruitmentConnector {
  const fetcher = options.fetch || fetch;

  return {
    provider: "greenhouse",
    sourceType: "PUBLIC_SOURCE",
    async verify(source) {
      await this.search(source, { id: "verify", keywords: "" });
      return { ok: true, status: "VERIFIED" };
    },
    async search(source: ConnectorSource, template: ConnectorSearchTemplate) {
      const settings = parseConnectorSettings(source);
      const boardToken = textSetting(settings, "boardToken");
      if (!boardToken) throw Object.assign(new Error("GREENHOUSE_BOARD_TOKEN_REQUIRED"), { status: 401 });

      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;
      const jobs = asGreenhouseJobs(await ensureJsonResponse(await fetcher(url, { headers: { Accept: "application/json" } }), "greenhouse"));

      return {
        postings: jobs
          .map((job) => {
            const description = stripHtml(job.content);
            return {
              provider: "greenhouse",
              sourceType: "PUBLIC_SOURCE" as const,
              title: job.title || "",
              company: job.departments?.[0]?.name || null,
              location: job.location?.name || null,
              salary: null,
              description,
              requirements: [],
              sourceUrl: job.absolute_url || null,
              externalJobId: job.id === undefined ? null : String(job.id),
              publishedAt: parseDate(job.updated_at),
              rawJson: job
            };
          })
          .filter((job) => job.title && job.description && hasKeywordMatch(`${job.title} ${job.description}`, template.keywords))
      };
    }
  };
}
