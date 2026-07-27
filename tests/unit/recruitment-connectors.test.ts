import { describe, expect, it } from "vitest";
import {
  buildSearchUrl,
  classifyRecruitmentFailure,
  createRecruitmentConnectorRegistry,
  redactRecruitmentLog
} from "@/lib/recruitment/connectors/base";

describe("recruitment connector framework", () => {
  it("maps connector failures to platform statuses", () => {
    expect(classifyRecruitmentFailure({ status: 401, message: "unauthorized" })).toBe("AUTH_REQUIRED");
    expect(classifyRecruitmentFailure({ status: 403, message: "forbidden" })).toBe("AUTH_REQUIRED");
    expect(classifyRecruitmentFailure({ status: 429, message: "rate limited" })).toBe("RATE_LIMITED");
    expect(classifyRecruitmentFailure({ status: 503, message: "unavailable" })).toBe("SOURCE_UNAVAILABLE");
    expect(classifyRecruitmentFailure({ status: 200, message: "shape changed" })).toBe("PARSER_CHANGED");
    expect(classifyRecruitmentFailure({ message: "network timeout" })).toBe("SOURCE_UNAVAILABLE");
  });

  it("registers supported non-browser connectors", () => {
    const registry = createRecruitmentConnectorRegistry();

    expect(registry.listProviders()).toEqual(expect.arrayContaining(["adzuna", "jooble", "greenhouse", "lever", "usajobs"]));
    expect(registry.get("adzuna").provider).toBe("adzuna");
  });

  it("redacts sensitive values and builds encoded search urls", () => {
    const url = buildSearchUrl("https://api.example.com/search", {
      Keyword: "React Engineer",
      LocationName: "Shanghai",
      empty: null,
      page: 1
    });

    expect(url).toBe("https://api.example.com/search?Keyword=React+Engineer&LocationName=Shanghai&page=1");
    expect(redactRecruitmentLog({
      url: "https://api.example.com/search?app_key=secret-key-123456",
      headers: {
        Authorization: "Bearer secret-token",
        "Authorization-Key": "usajobs-key",
        Host: "data.usajobs.gov"
      }
    })).toEqual({
      url: "https://api.example.com/search?app_key=%5BREDACTED%5D",
      headers: {
        Authorization: "[REDACTED]",
        "Authorization-Key": "[REDACTED]",
        Host: "data.usajobs.gov"
      }
    });
  });
});
