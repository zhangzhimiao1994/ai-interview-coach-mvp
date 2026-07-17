import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routeEntries = [
  "app/api/digital-human/sessions/route.ts",
  "app/api/digital-human/sessions/[sessionId]/route.ts",
  "app/api/digital-human/sessions/[sessionId]/heartbeat/route.ts",
  "app/api/digital-human/sessions/[sessionId]/speech/route.ts"
] as const;

const allowedRouteExports = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "config",
  "generateStaticParams",
  "revalidate",
  "dynamic",
  "dynamicParams",
  "fetchCache",
  "preferredRegion",
  "runtime",
  "maxDuration"
]);

function routeExports(source: string) {
  const declarations = [...source.matchAll(
    /^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm
  )].map((match) => match[1]);
  const lists = [...source.matchAll(/^export\s*\{([^}]+)\}/gm)].flatMap(
    (match) =>
      match[1].split(",").map((entry) => {
        const names = entry.trim().split(/\s+as\s+/);
        return names[names.length - 1].trim();
      })
  );
  const defaults = /^export\s+default\b/m.test(source) ? ["default"] : [];
  return [...declarations, ...lists, ...defaults];
}

describe("Task 4 digital-human route entry contract", () => {
  it("exports only names accepted by Next route modules", () => {
    const invalidExports = routeEntries.flatMap((route) => {
      const source = readFileSync(join(process.cwd(), route), "utf8");
      return routeExports(source)
        .filter((name) => !allowedRouteExports.has(name))
        .map((name) => `${route}:${name}`);
    });

    expect(invalidExports).toEqual([]);
  });
});
