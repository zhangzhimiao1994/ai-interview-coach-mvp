import { describe, expect, it } from "vitest";
import { buildRecruitmentDedupeKey, canonicalizeJobUrl, hashRecruitmentContent, normalizeRecruitmentText } from "@/lib/recruitment/normalization";

describe("recruitment normalization", () => {
  it("normalizes text and canonicalizes job urls", () => {
    expect(normalizeRecruitmentText(" Senior  Engineer \r\n\r\n React ")).toBe("Senior Engineer\n\nReact");
    expect(canonicalizeJobUrl("https://boards.greenhouse.io/acme/jobs/123?gh_src=x#app")).toBe("https://boards.greenhouse.io/acme/jobs/123");
  });

  it("builds stable dedupe keys from external id, url, then content hash", () => {
    expect(buildRecruitmentDedupeKey({ provider: "greenhouse", externalJobId: "123" })).toBe("provider:greenhouse:123");
    expect(buildRecruitmentDedupeKey({ provider: "manual", sourceUrl: "https://jobs.example.com/a?utm_source=x" })).toBe("url:https://jobs.example.com/a");
    expect(buildRecruitmentDedupeKey({ provider: "manual", title: "Backend", company: "Acme", description: "Build APIs" })).toBe(`hash:${hashRecruitmentContent("Backend\nAcme\nBuild APIs")}`);
  });
});
