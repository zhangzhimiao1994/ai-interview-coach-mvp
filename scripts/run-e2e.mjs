import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import process from "node:process";

const baseUrl = "http://127.0.0.1:3000";
const nextBin = path.join("node_modules", "next", "dist", "bin", "next");
const playwrightCli = path.join("node_modules", "@playwright", "test", "cli.js");
const e2eAuth = {
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || "admin",
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "e2e-admin-password"
};

function waitForServer(url, timeoutMs = 60000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }

        setTimeout(check, 500);
      });

      request.setTimeout(3000, () => {
        request.destroy();
      });
    };

    check();
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options
    });

    child.on("exit", (code, signal) => {
      resolve({ code: code ?? 1, signal });
    });
  });
}

const server = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", "3000"], {
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    ...e2eAuth
  }
});

let exitCode = 1;

try {
  await waitForServer(baseUrl);
  const result = await run(process.execPath, [playwrightCli, "test"], {
    env: {
      ...process.env,
      ...e2eAuth,
      PLAYWRIGHT_SKIP_WEB_SERVER: "1"
    }
  });
  exitCode = result.code;
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  server.kill();
}

process.exit(exitCode);
