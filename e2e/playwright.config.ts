import { defineConfig } from "@playwright/test";

// The suite hard-resets the graph (including learned memory), so it must never touch a shared or
// production stack by accident. Anything that is not localhost needs an explicit opt-in.
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
for (const [name, fallback] of [["E2E_BASE_URL", "http://localhost:3001"], ["E2E_API_URL", "http://localhost:8100"]]) {
  const url = process.env[name] ?? fallback;
  if (!LOCAL.has(new URL(url).hostname) && process.env.ALLOW_PROD_E2E !== "1") {
    throw new Error(
      `Refusing to run e2e: ${name}=${url} is not localhost and this suite wipes the graph. ` +
        `Set ALLOW_PROD_E2E=1 if you really mean to run it there.`,
    );
  }
}

// Runs against a real stack (UI + API + TigerGraph). Start it first; see README "End-to-end tests".
export default defineConfig({
  testDir: "./tests",
  workers: 1, // the tests share one graph, so they run one at a time
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {},
  },
});
