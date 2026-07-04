import { defineConfig, devices } from "@playwright/test";

const shouldManageWebServer = process.env.PLAYWRIGHT_SKIP_WEB_SERVER !== "1";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  webServer: shouldManageWebServer
    ? {
        command: "node ./node_modules/next/dist/bin/next start",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: true,
        timeout: 120000
      }
    : undefined,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
