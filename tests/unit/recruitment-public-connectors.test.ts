import { describe, expect, it, vi } from "vitest";
import { encryptRecruitmentSecret } from "@/lib/recruitment/crypto";
import type { ConnectorSearchTemplate, ConnectorSource } from "@/lib/recruitment/connectors/base";
import { createAdzunaConnector } from "@/lib/recruitment/connectors/adzuna";
import { createGreenhouseConnector } from "@/lib/recruitment/connectors/greenhouse";
import { createJoobleConnector } from "@/lib/recruitment/connectors/jooble";
import { createLeverConnector } from "@/lib/recruitment/connectors/lever";
import { createUsaJobsConnector } from "@/lib/recruitment/connectors/usajobs";

const secret = "0123456789abcdef0123456789abcdef";

function source(overrides: Partial<ConnectorSource> = {}): ConnectorSource {
  const envelope = encryptRecruitmentSecret(overrides.decryptedApiKey || "source-api-key-1234567890", secret);

  return {
    id: "source-1",
    provider: "adzuna",
    sourceType: "AGGREGATED_API",
    displayName: "Source",
    enabled: true,
    credentialCiphertext: envelope.ciphertext,
    credentialIv: envelope.iv,
    credentialTag: envelope.tag,
    settingsJson: "{}",
    ...overrides
  };
}

function template(overrides: Partial<ConnectorSearchTemplate> = {}): ConnectorSearchTemplate {
  return {
    id: "template-1",
    keywords: "react engineer",
    city: "Remote",
    country: "us",
    roleType: null,
    experienceRange: null,
    salaryRange: null,
    language: null,
    remoteMode: null,
    ...overrides
  };
}

describe("recruitment public/API connectors", () => {
  it("normalizes an Adzuna search result", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{
        id: "a1",
        title: "Frontend Engineer",
        company: { display_name: "Acme" },
        location: { display_name: "Remote" },
        description: "Build React apps",
        redirect_url: "https://www.adzuna.com/job/a1",
        created: "2026-07-26T00:00:00Z"
      }]
    })));
    const connector = createAdzunaConnector({ fetch, secret });
    const result = await connector.search(source({
      provider: "adzuna",
      settingsJson: JSON.stringify({ appId: "app-1", country: "us", pageSize: 10 })
    }), template({ country: "us" }));

    expect(fetch.mock.calls[0][0]).toContain("https://api.adzuna.com/v1/api/jobs/us/search/1");
    expect(fetch.mock.calls[0][0]).toContain("app_id=app-1");
    expect(result.postings[0]).toMatchObject({
      provider: "adzuna",
      sourceType: "AGGREGATED_API",
      externalJobId: "a1",
      title: "Frontend Engineer",
      company: "Acme"
    });
  });

  it("normalizes a Jooble REST result", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      totalCount: 1,
      jobs: [{
        id: "j1",
        title: "Backend Engineer",
        company: "Northstar",
        location: "Berlin",
        snippet: "Build reliable APIs",
        salary: "60000 - 80000 EUR",
        link: "https://jooble.org/job/j1",
        updated: "2026-07-25T00:00:00Z"
      }]
    })));
    const connector = createJoobleConnector({ fetch, secret });
    const result = await connector.search(source({
      provider: "jooble",
      settingsJson: JSON.stringify({ resultOnPage: 5 })
    }), template({ city: "Berlin", country: "de" }));
    const [url, init] = fetch.mock.calls[0];

    expect(url).toBe("https://jooble.org/api/source-api-key-1234567890");
    expect(JSON.parse(String(init?.body))).toMatchObject({ keywords: "react engineer", location: "Berlin", ResultOnPage: 5 });
    expect(result.postings[0]).toMatchObject({
      provider: "jooble",
      externalJobId: "j1",
      title: "Backend Engineer",
      salary: "60000 - 80000 EUR"
    });
  });

  it("normalizes a Greenhouse public board response", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      jobs: [{
        id: 127817,
        title: "Product Engineer",
        location: { name: "San Francisco, CA" },
        absolute_url: "https://boards.greenhouse.io/acme/jobs/127817",
        updated_at: "2026-07-24T10:00:00Z",
        content: "<p>Build product interviews</p>",
        departments: [{ name: "Engineering" }]
      }]
    })));
    const connector = createGreenhouseConnector({ fetch });
    const result = await connector.search(source({
      provider: "greenhouse",
      sourceType: "PUBLIC_SOURCE",
      credentialCiphertext: null,
      credentialIv: null,
      credentialTag: null,
      settingsJson: JSON.stringify({ boardToken: "acme" })
    }), template({ city: "San Francisco" }));

    expect(fetch.mock.calls[0][0]).toBe("https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true");
    expect(result.postings[0]).toMatchObject({
      provider: "greenhouse",
      sourceType: "PUBLIC_SOURCE",
      externalJobId: "127817",
      title: "Product Engineer",
      description: "Build product interviews"
    });
  });

  it("normalizes a Lever postings API response", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      id: "l1",
      text: "Platform Engineer",
      hostedUrl: "https://jobs.lever.co/acme/l1",
      categories: { team: "Engineering", location: "London", commitment: "Full-time" },
      descriptionPlain: "Operate the platform",
      createdAt: 1785000000000
    }])));
    const connector = createLeverConnector({ fetch });
    const result = await connector.search(source({
      provider: "lever",
      sourceType: "PUBLIC_SOURCE",
      credentialCiphertext: null,
      credentialIv: null,
      credentialTag: null,
      settingsJson: JSON.stringify({ site: "acme" })
    }), template({ city: "London", country: "gb" }));

    expect(fetch.mock.calls[0][0]).toBe("https://api.lever.co/v0/postings/acme?mode=json&limit=100");
    expect(result.postings[0]).toMatchObject({
      provider: "lever",
      externalJobId: "l1",
      title: "Platform Engineer",
      company: "Engineering",
      location: "London"
    });
  });

  it("normalizes a USAJOBS Search API response", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      SearchResult: {
        SearchResultItems: [{
          MatchedObjectId: "u1",
          MatchedObjectDescriptor: {
            PositionID: "DEV-1",
            PositionTitle: "Software Developer",
            OrganizationName: "Department of APIs",
            PositionURI: "https://www.usajobs.gov/job/u1",
            PositionLocationDisplay: "Washington, DC",
            QualificationSummary: "Build public services",
            UserArea: {
              Details: {
                JobSummary: "Develop digital services",
                MajorDuties: ["Write code", "Review systems"],
                SalaryRange: "90000 - 120000"
              }
            },
            PublicationStartDate: "2026-07-23T00:00:00Z"
          }
        }]
      }
    })));
    const connector = createUsaJobsConnector({ fetch, secret });
    const result = await connector.search(source({
      provider: "usajobs",
      settingsJson: JSON.stringify({ userAgent: "admin@example.com", resultsPerPage: 25 })
    }), template({ city: "Washington, DC", country: "us" }));
    const [url, init] = fetch.mock.calls[0];

    expect(url).toContain("https://data.usajobs.gov/api/Search?");
    expect(url).toContain("Keyword=react+engineer");
    expect(init?.headers).toMatchObject({
      Host: "data.usajobs.gov",
      "User-Agent": "admin@example.com",
      "Authorization-Key": "source-api-key-1234567890"
    });
    expect(result.postings[0]).toMatchObject({
      provider: "usajobs",
      externalJobId: "DEV-1",
      title: "Software Developer",
      company: "Department of APIs",
      requirements: ["Write code", "Review systems"]
    });
  });
});
