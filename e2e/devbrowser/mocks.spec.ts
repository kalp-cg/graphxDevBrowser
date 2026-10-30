import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

// API mocking in the real app, on the sandbox shop (page :7400, API :7401): a made-up response the page renders, a 500, a delay,
// a dropped connection, and the master switch.
//   cd DevBrowser && npm run build && python sandbox/run.py up && cd ../e2e && npx playwright test -c devbrowser.config.ts mocks
const APP = path.resolve(__dirname, "../../DevBrowser");
const SHOP = "localhost:7400";
const API = "http://localhost:7401/api/products";
const electronPath = createRequire(path.join(APP, "package.json"))("electron") as unknown as string;
const userData = mkdtempSync(path.join(os.tmpdir(), "devbrowser-mock-e2e-"));

let app: ElectronApplication;
let page: Page;
const inPage = <T>(js: string) =>
  page.evaluate(async (code) => {
    const pane = [...document.querySelectorAll<HTMLElement>("[data-tab-id]")].find(p => p.style.display !== "none");
    const view = pane?.querySelector("webview") as unknown as { executeJavaScript(c: string): Promise<unknown> };
    return view.executeJavaScript(code);
  }, js) as Promise<T>;
/** What the page itself gets from the API: status and time, or "failed". */
const probe = () => inPage<{ status: number | "failed"; ms: number; body: string }>(
  `(async () => { const t = performance.now(); try { const r = await fetch('${API}?probe=' + Math.random()); return { status: r.status, ms: performance.now() - t, body: (await r.text()).slice(0, 200) }; } catch { return { status: 'failed', ms: performance.now() - t, body: '' }; } })()`);

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  const args = process.platform === "linux" ? [APP, "--no-sandbox"] : [APP];
  app = await electron.launch({ executablePath: electronPath, args, cwd: APP, env: { ...process.env, DEVBROWSER_USER_DATA: userData, NODE_ENV: "production", OLLAMA_HOST: "http://127.0.0.1:1" } });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await expect(page.getByRole("tablist", { name: "Tabs" })).toBeVisible();
  const address = page.getByRole("textbox", { name: "Address and search bar" });
  await address.fill(SHOP); await address.press("Enter");
  await expect.poll(() => inPage<number>("document.querySelectorAll('.card').length")).toBe(3);
  await page.getByRole("button", { name: "Network", exact: true }).click();
});
test.afterAll(async () => app?.close());

const network = () => page.getByRole("region", { name: "Network panel" });
const rowFor = (needle: string) => network().locator("tr", { hasText: new RegExp(`^GET.*${needle}`) }).first();

test("with no rules nothing changes: requests reach the real server", async () => {
  expect((await probe()).status).toBe(200);
  await expect(page.getByRole("button", { name: /^Mocking is on/ })).toHaveCount(0);
});

test("right-click a request, edit its response, and the page renders the made-up data", async () => {
  await expect(rowFor("/api/products")).toBeVisible();
  await rowFor("/api/products").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Mock this response…" }).click();
  const editor = network().getByRole("form", { name: "Rule editor" });
  await expect(editor.getByLabel("Rule address")).toHaveValue(/localhost:7401\/api\/products/);
  await editor.getByLabel("Rule body").fill('[{"sku":"mock","name":"Mocked mug","price":1}]');
  await editor.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByRole("button", { name: "Mocking is on: 1 rule" })).toBeVisible();   // the status bar says so

  const mocked = await probe();
  expect(mocked.status).toBe(200);
  expect(mocked.body).toContain("Mocked mug");
  await inPage("location.reload()");
  await expect.poll(() => inPage<string>("document.querySelector('.card')?.textContent ?? ''")).toContain("Mocked mug");

  await network().getByRole("button", { name: "Mocks", exact: false }).click();               // back to the request list
  await expect(rowFor("/api/products").getByText("MOCK")).toBeVisible();
});

test("return 500, delay 5 seconds, and drop the connection", async () => {
  await network().getByRole("button", { name: /^Mocks/ }).click();                            // open the rules
  await network().getByLabel("Delete all mock rules").click();
  await network().getByRole("button", { name: /^Mocks/ }).click();                            // and close
  await rowFor("/api/products").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Return 500" }).click();
  await expect.poll(async () => (await probe()).status).toBe(500);

  await network().getByRole("button", { name: /^Mocks/ }).click();
  await network().getByLabel("Delete all mock rules").click();
  await network().getByRole("button", { name: /^Mocks/ }).click();
  await rowFor("/api/products").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delay 5 seconds" }).click();
  await expect.poll(async () => { const p = await probe(); return p.status === 200 && p.ms >= 4500; }, { timeout: 30_000 }).toBe(true);

  await network().getByRole("button", { name: /^Mocks/ }).click();
  await network().getByLabel("Delete all mock rules").click();
  await network().getByRole("button", { name: /^Mocks/ }).click();
  await rowFor("/api/products").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Drop the connection" }).click();
  await expect.poll(async () => (await probe()).status).toBe("failed");
  await expect(rowFor("/api/products").getByText("Failed").first()).toBeVisible();
});

test("the master switch puts the real server back, and turning it on again brings the mock back", async () => {
  await network().getByRole("button", { name: /^Mocks/ }).click();
  await network().getByLabel("Mocking enabled").uncheck();
  await expect.poll(async () => (await probe()).status).toBe(200);
  await expect(page.getByRole("button", { name: /^Mocking is on/ })).toHaveCount(0);
  await network().getByLabel("Mocking enabled").check();
  await expect.poll(async () => (await probe()).status).toBe("failed");
  await network().getByLabel("Delete all mock rules").click();
  await expect.poll(async () => (await probe()).status).toBe(200);
});

test("a bug recording becomes mock rules, so its page can run without the backend", async () => {
  await network().getByRole("button", { name: /^Mocks/ }).click();                            // close the rules pane
  await page.getByRole("button", { name: "Bug Recorder", exact: true }).click();
  const recorder = page.getByRole("region", { name: "Bug Recorder panel" });
  await recorder.getByRole("button", { name: "Start recording" }).click();
  await inPage(`document.querySelector('.card button').click()`);
  await page.waitForTimeout(1200);
  await recorder.getByRole("button", { name: "Stop recording" }).click();
  await expect(recorder.getByRole("button", { name: /^Recording / })).toBeVisible();

  await page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: "Network", exact: true }).click();
  await network().getByRole("button", { name: /^Mocks/ }).click();
  await network().getByLabel("Mock from a recording").selectOption({ index: 1 });
  const rules = network().getByRole("list", { name: "Rules" });
  await expect(rules.getByRole("listitem").first()).toContainText(/localhost:7401\/api\/(cart|products)/);
  await expect(page.getByRole("button", { name: /^Mocking is on/ })).toBeVisible();
  await network().getByLabel("Delete all mock rules").click();
});
