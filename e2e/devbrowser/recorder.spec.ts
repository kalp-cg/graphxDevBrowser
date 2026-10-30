import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

// The bug recorder in the real app, on the sandbox shop: record a checkout that fails, export it, open it back, and replay it
// against a healthy shop (not reproduced) and a broken one (reproduced).
//   cd DevBrowser && npm run build && python sandbox/run.py up && cd ../e2e && npx playwright test -c devbrowser.config.ts recorder
const APP = path.resolve(__dirname, "../../DevBrowser");
const SHOP = "localhost:7400";
const CONTROL = "http://localhost:7499/__control";
const electronPath = createRequire(path.join(APP, "package.json"))("electron") as unknown as string;
const userData = mkdtempSync(path.join(os.tmpdir(), "devbrowser-rec-e2e-"));

let app: ElectronApplication;
let page: Page;
const control = (body: object) => fetch(CONTROL, { method: "POST", body: JSON.stringify(body) });
const inPage = <T>(js: string) =>
  page.evaluate(async (code) => {
    const pane = [...document.querySelectorAll<HTMLElement>("[data-tab-id]")].find(p => p.style.display !== "none");
    const view = pane?.querySelector("webview") as unknown as { executeJavaScript(c: string): Promise<unknown> };
    return view.executeJavaScript(code);
  }, js) as Promise<T>;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await control({ action: "reset" });
  const args = process.platform === "linux" ? [APP, "--no-sandbox"] : [APP];
  app = await electron.launch({ executablePath: electronPath, args, cwd: APP, env: { ...process.env, DEVBROWSER_USER_DATA: userData, NODE_ENV: "production", OLLAMA_HOST: "http://127.0.0.1:1" } });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await expect(page.getByRole("tablist", { name: "Tabs" })).toBeVisible();
});
test.afterAll(async () => { await control({ action: "reset" }); await app?.close(); });

const clickCheckout = () => inPage(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Checkout').click()`);

test("record a failing checkout, then export it as a file with no secrets in it", async () => {
  const address = page.getByRole("textbox", { name: "Address and search bar" });
  await address.fill(SHOP); await address.press("Enter");
  await expect.poll(() => inPage<number>("document.querySelectorAll('.card').length")).toBe(3);
  await control({ action: "fault", service: "inventory", rate: 1.0 });

  await page.getByRole("button", { name: "Bug Recorder", exact: true }).click();
  const panel = page.getByRole("region", { name: "Bug Recorder panel" });
  await panel.getByRole("button", { name: "Start recording" }).click();
  await expect(panel.getByRole("status", { name: "Recording progress" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recording: click to stop" })).toBeVisible();

  await inPage(`document.querySelector('.card button').click()`);                     // add to cart
  await clickCheckout();                                                              // the one that fails
  await expect(panel.getByRole("status", { name: "Recording progress" })).toContainText(/[2-9] actions/, { timeout: 10_000 });
  await page.waitForTimeout(800);
  await panel.getByRole("button", { name: "Stop recording" }).click();

  const row = panel.getByRole("button", { name: /^Recording / }).first();
  await expect(row).toBeVisible();
  const note = panel.getByRole("note", { name: "What went wrong" });
  await expect(note).toContainText(/checkout.*(502|50\d)|→ 50/i);
  await expect(note).toContainText(/Right after: Clicked/);
  await panel.getByRole("button", { name: "Problems", exact: true }).click();
  await expect(panel.getByRole("list", { name: "Timeline" }).getByRole("listitem").first()).toContainText(/→ 50\d/);

  const target = path.join(userData, "bug.devrec.json");
  rmSync(target, { force: true });
  await app.evaluate(({ session }, f) => { session.defaultSession.once("will-download", (_e, item) => item.setSavePath(f)); }, target);
  await panel.getByRole("button", { name: "Export recording" }).click();
  await expect.poll(() => { try { return readFileSync(target, "utf8").length; } catch { return 0; } }, { timeout: 15_000 }).toBeGreaterThan(500);
  const file = JSON.parse(readFileSync(target, "utf8"));
  expect(file.format).toBe("devbrowser-recording");
  expect(file.steps.some((s: { kind: string }) => s.kind === "click")).toBe(true);
  expect(file.steps.some((s: { kind: string; status?: number }) => s.kind === "request" && (s.status ?? 0) >= 500)).toBe(true);
  expect(file.steps.some((s: { kind: string }) => s.kind === "snapshot")).toBe(true);
  expect(JSON.stringify(file)).not.toMatch(/Bearer |set-cookie.*sid=/i);
});

test("open the file back and replay it: not reproduced on a healthy shop, reproduced on a broken one", async () => {
  test.setTimeout(120_000);
  const panel = page.getByRole("region", { name: "Bug Recorder panel" });
  // A second copy opened from the exported file (what a teammate does).
  await panel.locator('input[type=file][aria-label="Recording file"]').setInputFiles(path.join(userData, "bug.devrec.json"));
  await expect(panel.getByRole("button", { name: /^Recording / })).toHaveCount(1);        // same id: replaced, not duplicated, and shown open

  const tabsBefore = await page.getByRole("tab").count();
  await control({ action: "reset" });                                                      // the bug is fixed on this machine
  await panel.getByRole("button", { name: "Replay recording" }).click();
  await expect(page.getByRole("tab")).toHaveCount(tabsBefore + 1);
  await expect(panel.getByRole("status", { name: "Replay result" })).toContainText(/Not reproduced/, { timeout: 60_000 });

  await control({ action: "fault", service: "inventory", rate: 1.0 });                    // and broken again
  await panel.getByRole("button", { name: "Replay recording" }).click();
  await expect(panel.getByRole("status", { name: "Replay result" })).toContainText(/Reproduced/, { timeout: 60_000 });
});

test("a file that is not a recording is refused with a reason", async () => {
  const bad = path.join(userData, "not-a-recording.json");
  require("node:fs").writeFileSync(bad, JSON.stringify({ log: { version: "1.2" } }));
  const panel = page.getByRole("region", { name: "Bug Recorder panel" });
  await panel.locator('input[type=file][aria-label="Recording file"]').setInputFiles(bad);
  await expect(page.getByText("This is not a DevBrowser recording.").first()).toBeVisible();
});
