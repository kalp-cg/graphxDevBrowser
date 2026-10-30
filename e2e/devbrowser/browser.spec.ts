import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

// The real DevBrowser app on real pages: the sandbox shop (localhost:7400) and its SentinelGraph API (:8200).
const APP = path.resolve(__dirname, "../../DevBrowser");
const SHOP = "localhost:7400";
const API = process.env.SENTINEL_SANDBOX_API ?? "http://localhost:8200";
const CONTROL = "http://localhost:7499/__control";
const SHOTS = process.env.DEVBROWSER_SHOTS;
const PACKAGED = process.env.DEVBROWSER_PACKAGED;
const electronPath = createRequire(path.join(APP, "package.json"))("electron") as unknown as string;
const userData = mkdtempSync(path.join(os.tmpdir(), "devbrowser-e2e-"));

let app: ElectronApplication;
let page: Page;

async function launch() {
  // Linux CI containers have no SUID sandbox helper for Electron.
  const args = process.platform === "linux" ? [APP, "--no-sandbox"] : [APP];
  const env = { ...process.env, DEVBROWSER_USER_DATA: userData, NODE_ENV: "production" };
  // DEVBROWSER_PACKAGED=/path/to/DevBrowser(.app/Contents/MacOS/DevBrowser|.exe) runs the suite against an installed build.
  app = PACKAGED ? await electron.launch({ executablePath: PACKAGED, args: [], env })
    : await electron.launch({ executablePath: electronPath, args, cwd: APP, env });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await expect(page.getByRole("tablist", { name: "Tabs" })).toBeVisible();
}

/** Click a real application-menu item, exactly what its keyboard shortcut does. */
const menu = (id: string) =>
  app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()!.getMenuItemById(itemId)!.click(), id);

/** Run JavaScript in the visible page (the active tab's <webview>). */
const inPage = <T>(js: string) =>
  page.evaluate(async (code) => {
    const pane = [...document.querySelectorAll<HTMLElement>("[data-tab-id]")].find(p => p.style.display !== "none");
    const view = pane?.querySelector("webview") as unknown as { executeJavaScript(c: string): Promise<unknown> };
    return view.executeJavaScript(code);
  }, js) as Promise<T>;

const tabs = () => page.getByRole("tab");
const address = () => page.getByRole("textbox", { name: "Address and search bar" });

async function go(text: string) {
  await address().click();
  await address().fill(text);
  await address().press("Enter");
}

/** The window as Electron composites it. (Playwright's own screenshot can show a stale frame for a resized <webview>.) */
async function shot(name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(1500);
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString("base64"));
  writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(png, "base64"));
}

test.describe.configure({ mode: "serial" });
test.beforeAll(launch);
test.afterAll(async () => app?.close());

test("opens on a new tab page", async () => {
  await expect(page.getByRole("heading", { name: "DevBrowser" })).toBeVisible();
  await expect(tabs()).toHaveCount(1);
  await shot("01-new-tab");
});

test("the address bar loads a dev server; the tab takes the page's title", async () => {
  await go(SHOP);
  await expect(page.getByRole("tab", { name: /Sandbox Shop/ })).toBeVisible();
  await expect(address()).toHaveValue(SHOP);
  await expect.poll(() => inPage<string>("document.querySelectorAll('.card').length")).toBe(3);
  await shot("02-page");
});

test("back and forward follow the page's history", async () => {
  await go(`${SHOP}/?page=2`);
  await expect(address()).toHaveValue(`${SHOP}/?page=2`);
  const back = page.getByRole("button", { name: "Back", exact: true });
  await expect(back).toBeEnabled();
  await back.click();
  await expect(address()).toHaveValue(SHOP);
  await expect(page.getByRole("button", { name: "Forward", exact: true })).toBeEnabled();
  await menu("forward");
  await expect(address()).toHaveValue(`${SHOP}/?page=2`);
});

test("a page keeps its state across tab switches and tool panels (no reload)", async () => {
  await inPage("window.__marker = 42");
  await menu("new-tab");
  await expect(tabs()).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "DevBrowser" })).toBeVisible();
  await menu("select-tab-1");
  await page.getByRole("button", { name: "Network", exact: true }).click();
  await expect(page.getByRole("region", { name: "Network panel" })).toBeVisible();
  expect(await inPage<number>("window.__marker")).toBe(42);
  await expect(page.getByText(/api\/products/).first()).toBeVisible(); // the page's own API calls, captured
  await shot("03-network-panel");
  await page.getByRole("button", { name: "Close panel" }).click();
});

test("find in page", async () => {
  await menu("find");
  const find = page.getByRole("textbox", { name: "Find in page" });
  await find.fill("Graph mug");
  await expect(page.getByText("1/1")).toBeVisible();
  await find.press("Escape");
  await expect(find).toBeHidden();
});

test("zoom in, out and back to 100%", async () => {
  await menu("zoom-in");
  await expect(page.getByRole("button", { name: "110%" })).toBeVisible();
  expect(await inPage<number>("Math.round(window.devicePixelRatio * 100)")).toBeGreaterThan(
    await page.evaluate(() => Math.round(window.devicePixelRatio * 100)));
  await menu("zoom-reset");
  await expect(page.getByRole("button", { name: "110%" })).toBeHidden();
});

test("device mode emulates a phone: viewport, user agent, touch", async () => {
  await menu("toggle-device");
  await expect(page.getByRole("combobox", { name: "Device" })).toHaveValue("iphone-15");
  await expect.poll(() => inPage<number>("window.innerWidth")).toBe(393);
  expect(await inPage<boolean>("navigator.userAgent.includes('iPhone')")).toBe(true);
  expect(await inPage<number>("navigator.maxTouchPoints")).toBeGreaterThan(0);
  await shot("04-device-mode");
  expect(await inPage<number>("document.querySelectorAll('.grid > .card').length")).toBe(3);
  expect(await inPage<string>("getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length + ''"))
    .toBe("1"); // the page really lays out as a phone: one column
  await page.getByRole("button", { name: "Exit device mode" }).click();
  await expect.poll(() => inPage<number>("window.innerWidth")).toBeGreaterThan(393);
  expect(await inPage<boolean>("navigator.userAgent.includes('iPhone')")).toBe(false);
});

test("window.open opens a tab, not a bare window", async () => {
  const before = await tabs().count();
  await inPage(`window.open('http://${SHOP}/?popup=1')`);
  await expect(tabs()).toHaveCount(before + 1);
  await expect(address()).toHaveValue(`${SHOP}/?popup=1`);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

test("an unreachable dev server gets a useful error page", async () => {
  await go("localhost:59999");
  await expect(page.getByRole("heading", { name: "Can't reach localhost:59999" })).toBeVisible();
  await expect(page.getByText("Is the dev server running?")).toBeVisible();
  await shot("05-error-page");
  await go("localhost:9"); // a port Chromium refuses to use at all
  await expect(page.getByText("Chromium blocks this port")).toBeVisible();
});

test("split view shows the page as two profiles side by side", async () => {
  await go(SHOP);
  await menu("toggle-split");
  const panes = page.locator("[data-tab-id]").filter({ visible: true });
  await expect(panes).toHaveCount(2);
  await expect(panes.nth(0).getByText("Default", { exact: true })).toBeVisible();
  await expect(panes.nth(1).getByText("Admin", { exact: true })).toBeVisible();
  await shot("06-split-view");
  await menu("toggle-split");
  await expect(page.locator("[data-tab-id]").filter({ visible: true })).toHaveCount(1);
});

test("close a tab and reopen it", async () => {
  const before = await tabs().count();
  await menu("close-tab");
  await expect(tabs()).toHaveCount(before - 1);
  await menu("reopen-tab");
  await expect(tabs()).toHaveCount(before);
});

test("Security and Network show only the open website; History keeps the earlier ones", async () => {
  await go(SHOP);
  await expect.poll(() => inPage<string>("document.querySelectorAll('.card').length")).toBe(3);
  await page.getByRole("button", { name: "Security", exact: true }).click();
  const panel = page.getByRole("region", { name: "Security panel" });
  const shopFinding = panel.getByText("http://localhost:7400/", { exact: true });
  await expect(shopFinding.first()).toBeVisible();
  await expect(panel.getByText(/found on /)).toHaveCount(0); // "This site" does not label where findings came from

  // A different website: the shop's findings are not shown against it.
  await go("http://localhost:8200/");
  await expect(panel.getByText("http://localhost:8200/", { exact: true }).first()).toBeVisible();
  await expect(shopFinding).toHaveCount(0);
  await shot("10-security-this-site");

  // History keeps everything, labelled with the page each finding came from.
  await panel.getByRole("button", { name: /^History/ }).click();
  await expect(panel.getByText("found on localhost:7400").first()).toBeVisible();
  await expect(panel.getByText("found on localhost:8200").first()).toBeVisible();
  await expect(shopFinding.first()).toBeVisible();
  await shot("11-security-history");

  // Network follows the same rule.
  await page.getByRole("button", { name: "Network", exact: true }).click();
  const network = page.getByRole("region", { name: "Network panel" });
  await expect(network.getByRole("button", { name: /^History/ })).toHaveAttribute("aria-pressed", "false");
  await expect(network.getByText(/localhost:7400\/api\/products/)).toHaveCount(0);
  await network.getByRole("button", { name: /^History/ }).click();
  await expect(network.getByText(/localhost:7400/).first()).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await go(SHOP);
});

test("Dependencies shows the live SentinelGraph; an investigation and a fix from inside the browser", async () => {
  // A clean incident state: the shop healthy, earlier proposals expired (learned memory is kept).
  await fetch(CONTROL, { method: "POST", body: JSON.stringify({ action: "reset" }) });
  const reset = await fetch(`${API}/api/reset?keep_memory=true`, { method: "POST" });
  expect(reset.ok).toBe(true);
  await page.getByRole("button", { name: /^Settings/ }).click();
  await page.getByRole("button", { name: "Integrations" }).click();
  await page.getByPlaceholder("http://localhost:8100").fill(API);
  await page.getByRole("button", { name: "Connect & Load Graph" }).click();
  await expect(page.getByRole("contentinfo").getByText("SentinelGraph connected")).toBeVisible();

  await page.getByRole("button", { name: "Dependencies (SentinelGraph)" }).click();
  await expect(page.getByText("7 services", { exact: true })).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  await shot("07-dependencies");

  await fetch(CONTROL, { method: "POST", body: JSON.stringify({ action: "fault", service: "inventory", rate: 0.7,
    deploy: { version: "v2.4.1", message: "Reduce orders-db pool size to 2", author: "Priya Shah" } }) });
  await expect(page.getByText(/\d+ unhealthy/)).toBeVisible({ timeout: 30_000 });
  const panel = page.getByRole("region", { name: "SentinelGraph panel" });
  await panel.getByRole("button", { name: "Investigate", exact: true }).click();
  await expect(panel.getByText("Root cause:")).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator("strong", { hasText: /^inventory$/ })).toBeVisible();
  await shot("08-investigation");
  await panel.getByRole("group", { name: "rollback on inventory" }).getByRole("button", { name: "Approve" }).click();
  await expect(panel.getByText(/rolled back v2\.4\.1 on inventory/)).toBeVisible();
  await expect.poll(async () => (await (await fetch(CONTROL)).json()).faults).toEqual({});
});

test("Connect codebase maps a repository into the graph from the SentinelGraph panel", async () => {
  // The native folder dialog cannot be driven; answer it with a repository.
  const repo = process.env.DEVBROWSER_REPO ?? path.resolve(__dirname, "../../sandbox/shop");
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as unknown as typeof dialog.showOpenDialog;
  }, repo);
  const panel = page.getByRole("region", { name: "SentinelGraph panel" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Connect codebase" }).click();
  await expect(page.getByText(/^Mapped /)).toBeVisible();
  await expect(page.getByText(/\d+ services, \d+ databases, \d+ dependencies/)).toBeVisible();
});

test("a narrow window gives the panel the whole area and keeps the toolbar usable", async () => {
  await page.setViewportSize({ width: 700, height: 800 });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(900);
  const panel = page.getByRole("region", { name: "SentinelGraph panel" });
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())!.width).toBeGreaterThan(560);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot("09-narrow");
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("demo: break a service from the graph, investigate it, restore the healthy system", async () => {
  const reset = await fetch(`${API}/api/reset?keep_memory=true`, { method: "POST" });
  expect(reset.ok).toBe(true);
  const panel = page.getByRole("region", { name: "SentinelGraph panel" });
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Dependencies (SentinelGraph)" }).click();
  await expect(panel.getByText("all healthy")).toBeVisible({ timeout: 20_000 });

  // Healthy system: Investigate says there is nothing to investigate (not a cut-off line).
  await panel.getByRole("button", { name: "Investigate", exact: true }).click();
  await expect(panel.getByText(/nothing to investigate/)).toBeVisible({ timeout: 30_000 });

  // Find a service, break it with the same three choices as the dashboard.
  await panel.getByRole("combobox", { name: "Find a service" }).fill("inventory");
  await expect(panel.getByText("Simulate a failure")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Ship a bad deploy" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Degrade it" })).toBeVisible();
  await panel.getByRole("button", { name: "Crash it" }).click();
  await expect(panel.getByText(/\d+ unhealthy/)).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByRole("button", { name: "Restore healthy" })).toBeVisible();

  // The same workflow as before: investigate, root cause, proposed fix awaiting approval.
  await panel.getByRole("button", { name: "Investigate", exact: true }).click();
  await expect(panel.getByText("Root cause:")).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator("strong", { hasText: /^inventory$/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Approve" }).first()).toBeVisible();
  await shot("12-demo-broken");

  await panel.getByRole("button", { name: "Restore healthy" }).click();
  await expect(panel.getByText("all healthy")).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText("Root cause:")).toHaveCount(0); // the finished investigation is cleared
  await shot("13-demo-restored");
});

test("relaunching restores the tabs and the SentinelGraph connection", async () => {
  const titles = await tabs().allTextContents();
  await app.close();
  await launch();
  await expect(tabs()).toHaveCount(titles.length);
  await expect(page.getByRole("tab", { name: /Sandbox Shop/ }).first()).toBeVisible();
  await expect(page.getByRole("contentinfo").getByText("SentinelGraph connected")).toBeVisible();
});
