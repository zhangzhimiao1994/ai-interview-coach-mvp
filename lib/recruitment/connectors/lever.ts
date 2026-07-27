import { buildSearchUrl, ensureJsonResponse, numberSetting, parseConnectorSettings, textSetting, type ConnectorSearchTemplate, type ConnectorSource, type RecruitmentConnector, type RecruitmentFetch } from "@/lib/recruitment/connectors/base";
import { hasKeywordMatch, parseDate, stripHtml } from "@/lib/recruitment/connectors/text";

type LeverConnectorOptions = {
  fetch?: RecruitmentFetch;
};

type LeverPosting = {
  id?: string;
  text?: string;
  hostedUrl?: string;
  categories?: {
    team?: string;
    location?: string;
    commitment?: string;
  };
  descriptionPlain?: string;
  description?: string;
  lists?: Array<{ text?: string; content?: string }>;
  createdAt?: number;
};

function asLeverPostings(payload: unknown) {
  if (!Array.isArray(payload)) {
    throw Object.assign(new Error("lever parser changed: expected postings array"), { status: 200 });
  }

  return payload as LeverPosting[];
}

function leverDescription(posting: LeverPosting) {
  const listText = (posting.lists || [])
    .map((list) => [list.text, stripHtml(list.content)].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n");

  return [posting.descriptionPlain, stripHtml(posting.description), listText].filter(Boolean).join("\n\n");
}

export function createLeverConnector(options: LeverConnectorOptions = {}): RecruitmentConnector {
  const fetcher = options.fetch || fetch;

  return {
    provider: "lever",
    sourceType: "PUBLIC_SOURCE",
    async verify(source) {
      await this.search(source, { id: "verify", keywords: "" });
      return { ok: true, status: "VERIFIED" };
    },
    async search(source: ConnectorSource, template: ConnectorSearchTemplate) {
      const settings = parseConnectorSettings(source);
      const site = textSetting(settings, "site");
      if (!site) throw Object.assign(new Error("LEVER_SITE_REQUIRED"), { status: 401 });

      const limit = numberSetting(settings, "limit", 100);
      const url = buildSearchUrl(`https://api.lever.co/v0/postings/${encodeURIComponent(site)}`, {
        mode: "json",
        limit
      });
      const postings = asLeverPostings(await ensureJsonResponse(await fetcher(url, { headers: { Accept: "application/json" } }), "lever"));

      return {
        postings: postings
          .map((posting) => {
            const description = leverDescription(posting);
            return {
              provider: "lever",
              sourceType: "PUBLIC_SOURCE" as const,
              title: posting.text || "",
              company: posting.categories?.team || null,
              location: posting.categories?.location || null,
              salary: null,
              description,
              requirements: [],
              sourceUrl: posting.hostedUrl || null,
              externalJobId: posting.id || null,
              publishedAt: parseDate(posting.createdAt),
              rawJson: posting
            };
          })
          .filter((posting) => posting.title && posting.description && hasKeywordMatch(`${posting.title} ${posting.description}`, template.keywords))
      };
    }
  };
}
