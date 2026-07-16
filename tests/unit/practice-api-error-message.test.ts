import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("practice API error messages", () => {
  it("shows the safe API detail before the generic error code", () => {
    const entry = readFileSync(
      resolve(process.cwd(), "components/practice/PracticeEntry.tsx"),
      "utf8"
    );
    const room = readFileSync(
      resolve(process.cwd(), "components/practice/InterviewRoom.tsx"),
      "utf8"
    );

    expect(entry).toContain("payload?.message || payload?.error");
    expect(room.match(/payload\?\.message \|\| payload\?\.error/g)).toHaveLength(2);
  });
});
