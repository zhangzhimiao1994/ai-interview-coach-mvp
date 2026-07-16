import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { postErrorResponse } from "@/lib/api/errors";
import { AiProviderError } from "@/lib/ai/errors";

function knownRequestError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(
    "database detail that must not be returned",
    {
      code,
      clientVersion: Prisma.prismaVersion.client,
      meta: { target: ["capability"] }
    }
  );
}

describe("API error responses", () => {
  it("maps unique default conflicts to a safe 409 response", async () => {
    const response = postErrorResponse(knownRequestError("P2002"));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      error: "Conflict",
      message: "A conflicting record already exists."
    });
    expect(JSON.stringify(payload)).not.toContain("database detail");
  });

  it("keeps foreign-key reference failures as 400", async () => {
    const response = postErrorResponse(knownRequestError("P2003"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid reference",
      message: "One or more referenced records do not exist."
    });
  });

  it("maps missing-record failures to 404", async () => {
    const response = postErrorResponse(knownRequestError("P2025"));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({
      error: "Not found",
      message: "The requested record does not exist."
    });
    expect(JSON.stringify(payload)).not.toContain("database detail");
  });

  it("maps upstream AI failures to a safe 502 response", async () => {
    const response = postErrorResponse(
      new AiProviderError("private upstream response detail")
    );
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({
      error: "AI service unavailable",
      message: "当前 AI 模型未返回有效结果，请检查模型配置或稍后重试。"
    });
    expect(JSON.stringify(payload)).not.toContain("private upstream response detail");
  });
});
