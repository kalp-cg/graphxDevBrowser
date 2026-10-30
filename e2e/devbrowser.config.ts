import { defineConfig } from "@playwright/test";

// DevBrowser itself (the built Electron app), driven end to end against the running sandbox:
//   cd DevBrowser && npm run build
//   python sandbox/run.py up
//   cd e2e && npx playwright test -c devbrowser.config.ts
export default defineConfig({
  testDir: "./devbrowser",
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
});
