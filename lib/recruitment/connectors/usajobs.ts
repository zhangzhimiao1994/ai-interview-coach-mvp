import { buildSearchUrl, ensureJsonResponse, numberSetting, parseConnectorSettings, textSetting, type ConnectorSearchTemplate, type ConnectorSource, type RecruitmentConnector, type RecruitmentFetch } from "@/lib/recruitment/connectors/base";
import { decryptSourceApiKey } from "@/lib/recruitment/connectors/credentials";
import { parseDate } from "@/lib/recruitment/connectors/text";

type UsaJobsConnectorOptions = {
  fetch?: RecruitmentFetch;
  secret?: string;
};

type UsaJobsItem = {
  MatchedObjectId?: string | number;
  MatchedObjectDescriptor?: {
    PositionID?: string;
    PositionTitle?: string;
    OrganizationName?: string;
    PositionURI?: string;
    PositionLocationDisplay?: string;
    QualificationSummary?: string;
    PublicationStartDate?: string;
    UserArea?: {
      Details?: {
        JobSummary?: string;
        MajorDuties?: string[];
        SalaryRange?: string;
      };
    };
  };
};

function asUsaJobsItems(payload: unknown) {
  const items = (payload as { SearchResult?: { SearchResultItems?: unknown } } | null)?.SearchResult?.SearchResultItems;

  if (!Array.isArray(items)) {
    throw Object.assign(new Error("usajobs parser changed: missing SearchResultItems array"), { status: 200 });
  }

  return items as UsaJobsItem[];
}

export function createUsaJobsConnector(options: UsaJobsConnectorOptions = {}): RecruitmentConnector {
  const fetcher = options.fetch || fetch;

  return {
    provider: "usajobs",
    sourceType: "AGGREGATED_API",
    async verify(source) {
      await this.search(source, { id: "verify", keywords: "software", country: "us" });
      return { ok: true, status: "VERIFIED" };
    },
    async search(source: ConnectorSource, template: ConnectorSearchTemplate) {
      const settings = parseConnectorSettings(source);
      const authKey = decryptSourceApiKey(source, options.secret);
      const userAgent = textSetting(settings, "userAgent");
      if (!userAgent) throw Object.assign(new Error("USAJOBS_USER_AGENT_REQUIRED"), { status: 401 });

      const resultsPerPage = numberSetting(settings, "resultsPerPage", 50);
      const url = buildSearchUrl("https://data.usajobs.gov/api/Search", {
        Keyword: template.keywords,
        LocationName: template.city || undefined,
        ResultsPerPage: resultsPerPage,
        Page: 1
      });
      const response = await fetcher(url, {
        headers: {
          Accept: "application/json",
          Host: "data.usajobs.gov",
          "User-Agent": userAgent,
          "Authorization-Key": authKey
        }
      });
      const items = asUsaJobsItems(await ensureJsonResponse(response, "usajobs"));

      return {
        postings: items.map((item) => {
          const descriptor = item.MatchedObjectDescriptor || {};
          const details = descriptor.UserArea?.Details || {};
          const description = [details.JobSummary, descriptor.QualificationSummary].filter(Boolean).join("\n\n");
          return {
            provider: "usajobs",
            sourceType: "AGGREGATED_API" as const,
            title: descriptor.PositionTitle || "",
            company: descriptor.OrganizationName || null,
            location: descriptor.PositionLocationDisplay || null,
            salary: details.SalaryRange || null,
            description,
            requirements: Array.isArray(details.MajorDuties) ? details.MajorDuties.filter(Boolean) : [],
            sourceUrl: descriptor.PositionURI || null,
            externalJobId: descriptor.PositionID || (item.MatchedObjectId === undefined ? null : String(item.MatchedObjectId)),
            publishedAt: parseDate(descriptor.PublicationStartDate),
            rawJson: item
          };
        }).filter((posting) => posting.title && posting.description)
      };
    }
  };
}
