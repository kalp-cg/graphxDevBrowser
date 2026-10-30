import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { createServer } from "node:http";
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
  // The suite must not depend on whether a model happens to be running on this machine.
  const env = { ...process.env, DEVBROWSER_USER_DATA: userData, NODE_ENV: "production", OLLAMA_HOST: "http://127.0.0.1:1" };
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

/** The address as shown. While the field still has focus (it can, on a machine whose window is not frontmost) it shows the full URL. */
const shownAs = (url: string) => new RegExp(`^(http://)?${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

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
  await expect(address()).toHaveValue(shownAs(`${SHOP}/?page=2`));
  const back = page.getByRole("button", { name: "Back", exact: true });
  await expect(back).toBeEnabled();
  await back.click();
  await expect(address()).toHaveValue(SHOP);
  await expect(page.getByRole("button", { name: "Forward", exact: true })).toBeEnabled();
  await menu("forward");
  await expect(address()).toHaveValue(shownAs(`${SHOP}/?page=2`));
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
  await expect.poll(() => inPage<number>("document.querySelectorAll('.grid > .card').length")).toBe(3);   // the reload for the new user agent
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
  await expect(address()).toHaveValue(shownAs(`${SHOP}/?popup=1`));
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

test("bookmark a page, find it on a new tab, remove it", async () => {
  await go(SHOP);
  await expect.poll(() => inPage<string>("document.querySelectorAll('.card').length")).toBe(3);
  await page.getByRole("button", { name: "Bookmark this page" }).click();
  await expect(page.getByRole("button", { name: "Remove bookmark", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "New tab", exact: true }).click();                  // a new tab lists it
  const bookmarks = page.getByRole("region", { name: "Bookmarks" });
  await expect(bookmarks.getByText("Sandbox Shop")).toBeVisible();
  await bookmarks.getByRole("button", { name: /Sandbox Shop/ }).first().click();
  await expect(address()).toHaveValue(SHOP, { timeout: 15_000 });
  await page.getByRole("button", { name: "Remove bookmark", exact: true }).click();         // and it can be removed again
  await expect(page.getByRole("button", { name: "Bookmark this page" })).toHaveAttribute("aria-pressed", "false");
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

test("the API client really sends requests, with variables and checks, and explains a failure", async () => {
  await page.getByRole("button", { name: "API Client", exact: true }).click();
  const panel = page.getByRole("region", { name: "API Client panel" });
  const address = panel.getByRole("textbox", { name: "Request address" });

  // A real request to the sample shop's API: its real status, size and body, not a canned answer.
  await address.fill("localhost:7401/api/products");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await expect(panel.getByText(/^200 OK$/)).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByLabel("Response body")).toContainText("Graph mug");
  await expect(panel.getByText(/\d+ ms/).first()).toBeVisible();
  await shot("14-api-client");

  // Variables: {{baseUrl}} comes from the Variables tab.
  await address.fill("{{baseUrl}}/api/products");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Undefined variable").first()).toBeHidden().catch(() => undefined);
  await panel.getByRole("tab", { name: /^variables/i }).click();
  await panel.getByRole("textbox", { name: "Value 1" }).fill("http://localhost:7401");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await expect(panel.getByText(/^200 OK$/)).toBeVisible();

  // Checks run on the response.
  await panel.getByRole("tab", { name: /^checks/i }).click();
  await panel.getByRole("button", { name: "Add check" }).click();
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await expect(panel.getByLabel("Check results").getByText("Passed: status 2xx: got 200")).toBeVisible();
  await panel.getByRole("textbox", { name: "Expected value" }).fill("404");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await expect(panel.getByLabel("Check results").getByText(/^Failed: status 404: got 200/)).toBeVisible();

  // A server that is not there is explained, not shown as a made-up response.
  await address.fill("localhost:59999/nothing");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Connection refused");
  await panel.getByRole("button", { name: "Load…" }).isVisible().catch(() => undefined);
  await page.getByRole("button", { name: "Close panel" }).click();
});

test("the AI assistant says so when no model is running, instead of inventing an answer", async () => {
  await page.getByRole("button", { name: "AI Assistant", exact: true }).click();
  const panel = page.getByRole("region", { name: "AI Assistant panel" });
  await panel.getByPlaceholder(/Ask local AI/).fill("Is my app secure?");
  await panel.getByPlaceholder(/Ask local AI/).press("Enter");
  await expect(panel.getByText(/Local AI Error/)).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText(/ollama serve/)).toBeVisible();
  await expect(panel.getByText(/verified safe/)).toHaveCount(0);
  await page.getByRole("button", { name: "Close panel" }).click();
});

test("the API client imports a cURL command and sends it", async () => {
  await page.getByRole("button", { name: "API Client", exact: true }).click();
  const panel = page.getByRole("region", { name: "API Client panel" });
  await panel.getByRole("button", { name: "Import cURL" }).click();
  await panel.getByRole("textbox", { name: "curl command" }).fill(
    "curl 'http://localhost:7401/api/products?limit=2' \\\n  -H 'accept: application/json' \\\n  --compressed");
  await panel.getByRole("button", { name: "Import", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "Request address" })).toHaveValue("http://localhost:7401/api/products?limit=2");
  await expect(panel.getByRole("combobox", { name: "Method" })).toHaveValue("GET");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await expect(panel.getByText(/^200 OK$/)).toBeVisible({ timeout: 15_000 });
  // Something that is not a curl command is refused, not turned into a request.
  await panel.getByRole("button", { name: "Import cURL" }).click();
  await panel.getByRole("textbox", { name: "curl command" }).fill("wget http://example.com");
  await panel.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Not a curl command").first()).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
});

test("network throttling cuts a page off, and a HAR export drops credentials", async () => {
  await go(SHOP);
  await expect.poll(() => inPage<string>("document.querySelectorAll('.card').length")).toBe(3);
  await page.getByRole("button", { name: "Network", exact: true }).click();
  const network = page.getByRole("region", { name: "Network panel" });

  // Offline: the page cannot load; back online it can.
  await network.getByRole("combobox", { name: "Network throttling" }).selectOption("offline");
  await go(SHOP + "/?offline=1");
  await expect(page.getByRole("heading", { name: /Can't reach/ })).toBeVisible({ timeout: 15_000 });
  await network.getByRole("combobox", { name: "Network throttling" }).selectOption("none");
  await go(SHOP);
  await expect.poll(() => inPage<string>("document.querySelectorAll('.card').length")).toBe(3);

  // HAR: a real file, with the request's credentials and tokens removed. (The save dialog is answered for the test.)
  const target = path.join(userData, "export.har");
  rmSync(target, { force: true });
  await app.evaluate(({ session }, file) => {
    session.defaultSession.once("will-download", (_e, item) => item.setSavePath(file));
  }, target);
  await network.getByRole("button", { name: "HAR", exact: true }).click();
  await expect.poll(() => existsSync(target), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => readFileSync(target, "utf8").length).toBeGreaterThan(100);
  const har = JSON.parse(readFileSync(target, "utf8"));
  expect(har.log.version).toBe("1.2");
  expect(har.log.entries.length).toBeGreaterThan(0);
  expect(har.log.entries.some((e: { request: { url: string } }) => e.request.url.includes("localhost:7401/api/products"))).toBe(true);
  expect(JSON.stringify(har)).not.toMatch(/Bearer |set-cookie.*sid=/i);
  await page.getByRole("button", { name: "Close panel" }).click();
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

test("a service shows the traffic you browsed to it, can be opened, and live-data setup is one click", async () => {
  const panel = page.getByRole("region", { name: "SentinelGraph panel" });
  await expect(panel).toBeVisible();
  await expect.poll(async () => (await (await fetch(`${API}/api/workspace`)).json()).aliases["localhost:7401"]).toBe("gateway");
  await panel.getByRole("combobox", { name: "Find a service" }).fill("gateway");
  const traffic = panel.getByLabel("Traffic to this service");
  await expect(traffic).toBeVisible({ timeout: 20_000 });          // the page at :7400 called the gateway on :7401
  await expect(traffic).toContainText("/api/products");
  await expect(panel.getByRole("button", { name: "Open localhost:7401" })).toBeVisible();
  const tabsBefore = await tabs().count();
  await panel.getByRole("button", { name: "Open localhost:7401" }).click();
  await expect(tabs()).toHaveCount(tabsBefore + 1);
  await page.getByRole("button", { name: /^Close Sandbox Shop|^Close localhost/ }).last().click();   // close the tab it opened

  await page.getByRole("button", { name: "Dependencies (SentinelGraph)" }).isVisible();
  await panel.getByRole("button", { name: "Live data", exact: true }).click();
  const live = panel.getByLabel("Live data setup");
  await expect(live.getByLabel("Configuration")).toContainText(`${API}/v1/traces`);
  await live.getByRole("button", { name: "Alertmanager alerts" }).click();
  await expect(live.getByLabel("Configuration")).toContainText(`${API}/api/alerts/alertmanager`);
  await live.getByRole("button", { name: "Close" }).click();
});

test("check my changes: uncommitted work shows which services it affects", async () => {
  const panel = page.getByRole("region", { name: "SentinelGraph panel" });
  const marker = path.resolve(__dirname, "../../sandbox/shop/services/inventory/.e2e-impact-marker");
  writeFileSync(marker, "an uncommitted change\n");
  try {
    await panel.getByRole("button", { name: "Check my changes" }).click();
    const card = panel.getByLabel("Impact of your changes");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText(/HIGH RISK/)).toBeVisible();          // inventory sits under checkout, gateway and web
    await expect(card.getByRole("button", { name: "inventory", exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "checkout", exact: true })).toBeVisible();
    await expect(card.getByText(/heuristic/)).toBeVisible();
    await shot("15-impact");
    await card.getByRole("button", { name: "Clear" }).click();
    await expect(card).toBeHidden();
  } finally {
    rmSync(marker, { force: true });
  }
  // Nothing changed: it says so rather than showing an empty card.
  await panel.getByRole("button", { name: "Check my changes" }).click();
  await expect(page.getByText("Nothing to check").first()).toBeVisible();
});

test("a database can fail and be named the root cause; separate failures are reported as separate, with confidence", async () => {
  const panel = page.getByRole("region", { name: "SentinelGraph panel" });
  const reset = await fetch(`${API}/api/reset?keep_memory=true`, { method: "POST" });
  expect(reset.ok).toBe(true);
  await expect(panel.getByText("all healthy")).toBeVisible({ timeout: 20_000 });

  // A database is a node of its own: pick it, break it, and the agent names it.
  await panel.getByRole("combobox", { name: "Find a service" }).fill("orders-db");
  await expect(panel.getByText("Simulate a failure")).toBeVisible();
  await panel.getByRole("button", { name: "Crash it" }).click();
  await expect(panel.getByText(/\d+ unhealthy/)).toBeVisible({ timeout: 20_000 });
  await panel.getByRole("button", { name: "Investigate", exact: true }).click();
  await expect(panel.getByText("Root cause:")).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator("strong", { hasText: /^orders-db$/ })).toBeVisible();
  await expect(panel.getByLabel("Confidence")).toContainText(/Confidence: (high|medium)/);

  // Two things break at once: two failures, said as two, and never "high" confidence.
  await panel.getByRole("button", { name: "Restore healthy" }).click();
  await expect(panel.getByText("all healthy")).toBeVisible({ timeout: 20_000 });
  await panel.getByRole("combobox", { name: "Find a service" }).fill("catalog");
  await panel.getByRole("button", { name: "Crash it" }).click();
  await expect(panel.getByText(/\d+ unhealthy/)).toBeVisible({ timeout: 20_000 });
  await panel.getByRole("combobox", { name: "Find a service" }).fill("cart");
  await panel.getByRole("button", { name: "Crash it" }).click();   // added to the failure already there
  await expect.poll(async () => {
    const g = await (await fetch(`${API}/api/graph`)).json();
    return g.nodes.filter((n: { name?: string; status?: string }) => ["catalog", "cart"].includes(n.name ?? "") && n.status === "down").length;
  }, { timeout: 30_000 }).toBe(2);
  await panel.getByRole("button", { name: "Investigate", exact: true }).click();
  await expect(panel.getByText(/2 separate failures/)).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator("strong", { hasText: /^catalog$/ }).first()).toBeVisible();
  await expect(panel.locator("strong", { hasText: /^cart$/ }).first()).toBeVisible();
  await expect(panel.getByLabel("Confidence")).toContainText("Confidence: medium");
  await shot("16-separate-failures");
  await panel.getByRole("button", { name: "Restore healthy" }).click();
  await expect(panel.getByText("all healthy")).toBeVisible({ timeout: 20_000 });
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

test("tabs behave like a browser: switch, pin, reorder, right-click menu, and each tab keeps its own address", async () => {
  const strip = page.getByRole("tablist", { name: "Tabs" });
  const labels = () => strip.getByRole("tab").evaluateAll(els => els.map(e => e.getAttribute("aria-label") ?? ""));
  const before = (await labels()).length;
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await go("localhost:7400/?page=3");
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await go("localhost:7400/?page=4");
  await expect(strip.getByRole("tab")).toHaveCount(before + 2);
  await expect(address()).toHaveValue(shownAs("localhost:7400/?page=4"));
  // Switching shows that tab's page and address at once.
  await strip.getByRole("tab").nth(before).click();
  await expect(address()).toHaveValue(shownAs("localhost:7400/?page=3"));
  await strip.getByRole("tab").nth(before + 1).click();
  await expect(address()).toHaveValue(shownAs("localhost:7400/?page=4"));
  // Right-click menu: pin moves the tab to the front and takes away its close button.
  await strip.getByRole("tab").nth(before + 1).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Tab menu" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Pin tab" }).click();
  await expect(menu).toBeHidden();
  await expect(strip.getByRole("tab").first()).toHaveAttribute("aria-label", /\(pinned\)/);
  // Duplicate puts a copy next to the original; closing the others leaves the pinned tab and the chosen one.
  await strip.getByRole("tab").nth(before + 1).click({ button: "right" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(menu).toBeHidden();
  await expect(strip.getByRole("tab")).toHaveCount(before + 3);
  await strip.getByRole("tab").last().click({ button: "right" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Close other tabs" }).click();
  await expect(menu).toBeHidden();
  await expect(strip.getByRole("tab")).toHaveCount(2);                    // the pinned one and this one
  await strip.getByRole("tab").first().click({ button: "right" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Unpin tab" }).click();
  await shot("17-tabs");
});

test("a dev server that dies under a tab is noticed at once, shown on the tab, and the tab recovers by itself", async () => {
  test.setTimeout(90_000);
  const html = "<title>Dev App</title><h1>my app</h1>";
  const start = () => new Promise<import("node:http").Server>(resolve => {
    const srv = createServer((_req, res) => { res.setHeader("content-type", "text/html"); res.end(html); });
    srv.listen(7788, "127.0.0.1", () => resolve(srv));
  });
  let server = await start();
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await go("localhost:7788");
  await expect(page.getByRole("tab", { name: /Dev App/ })).toBeVisible();
  await expect(page.getByRole("alert", { name: "Dev server stopped" })).toHaveCount(0);
  await expect.poll(() => page.getByRole("tab", { name: /Dev App/ }).getAttribute("aria-label")).not.toContain("server stopped");

  server.closeAllConnections();
  await new Promise<void>(r => server.close(() => r()));                // the crash
  const banner = page.getByRole("alert", { name: "Dev server stopped" });
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText("localhost:7788 stopped responding");
  await expect(page.getByRole("tab", { name: /Dev App.*server stopped/ })).toBeVisible();
  await expect(page.getByText("localhost:7788 stopped responding").first()).toBeVisible();   // and a notification
  await shot("18-dev-server-down");

  server = await start();                                                // the developer restarts it
  await expect(banner).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText("localhost:7788 is back").first()).toBeVisible();
  await expect(page.getByRole("tab", { name: /Dev App/ })).not.toHaveAttribute("aria-label", /server stopped/);
  await page.getByRole("button", { name: /^Close Dev App/ }).click();
  await new Promise<void>(r => server.close(() => r()));
});

/** The folder dialog is native, so a test answers it from the main process. */
const chooseFolder = (dir: string) =>
  app.evaluate(({ dialog }, d) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [d] })) as typeof dialog.showOpenDialog; }, dir);

test("run panel: start a project, its page opens by itself, a crash is explained, a taken port is freed", async () => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(path.join(os.tmpdir(), "devbrowser-run-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { dev: "node server.js" } }));
  writeFileSync(path.join(dir, "server.js"),
    "require('http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<title>Run Test App</title><h1>hi</h1>')})" +
    ".listen(7801,()=>console.log('  ➜  Local:   http://localhost:7801/'));");
  const tool = page.getByRole("navigation", { name: "Tools" });
  await tool.getByRole("button", { name: "Run", exact: true }).click();
  const run = page.getByRole("region", { name: "Run panel" });
  await chooseFolder(dir);
  await run.getByRole("button", { name: /Choose folder/ }).click();
  await expect(run.getByRole("button", { name: "npm run dev" })).toBeVisible();          // suggested from package.json
  await expect(run.getByRole("textbox", { name: "Command" })).toHaveValue("npm run dev");
  await run.getByRole("textbox", { name: "Command" }).fill("node server.js");
  await run.getByRole("button", { name: "Run", exact: true }).click();
  await expect(run.getByLabel("Run status", { exact: true })).toHaveText("Running");
  await expect(run.getByRole("log", { name: "Output" })).toContainText("http://localhost:7801/", { timeout: 15_000 });
  await expect(run.getByLabel("Addresses it serves").getByRole("button", { name: /localhost:7801/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Run Test App/ })).toBeVisible({ timeout: 15_000 });   // opened without being asked
  await shot("19-run-panel");
  await run.getByRole("button", { name: "Stop" }).click();
  await expect(run.getByLabel("Run status", { exact: true })).toHaveText("Stopped");
  await expect.poll(() => fetch("http://127.0.0.1:7801/").then(() => true, () => false)).toBe(false);   // really gone

  // A crash is explained in plain words.
  await run.getByRole("textbox", { name: "Command" }).fill(`node -e "console.log('starting'); process.stderr.write(\\"Error: Cannot find module 'express'\\\\n\\"); process.exit(1)"`);
  await run.getByRole("button", { name: "Run", exact: true }).click();
  const why = run.getByRole("alert", { name: "Why it stopped" });
  await expect(why).toContainText('Missing module "express"', { timeout: 15_000 });
  await expect(why).toContainText("Install dependencies");
  await expect(run.getByLabel("Run status", { exact: true })).toContainText("Crashed (exit 1)");
  await shot("20-run-crash");

  // A port that is taken: who holds it, and a button that frees it and tries again.
  const hasLsof = await new Promise<boolean>(r => spawn("lsof", ["-v"]).on("error", () => r(false)).on("close", () => r(true)));
  if (hasLsof && process.platform !== "win32") {
    let holder: ReturnType<typeof spawn> | undefined;
    try {
    holder = spawn(process.execPath, ["-e", "require('http').createServer().listen(7802);setInterval(()=>{},1000)"], { stdio: "ignore" });
    await expect.poll(() => new Promise<boolean>(r => { const c = connect({ port: 7802, host: "127.0.0.1" }); c.on("connect", () => { c.destroy(); r(true); }); c.on("error", () => r(false)); })).toBe(true);
    await run.getByRole("textbox", { name: "Command" }).fill(`node -e "require('http').createServer().listen(7802,()=>{console.log('Local: http://localhost:7802');setInterval(()=>{},1000)})"`);
    await run.getByRole("button", { name: "Run", exact: true }).click();
    await expect(why).toContainText("Port 7802 is already taken", { timeout: 15_000 });
    await expect(why).toContainText(/Held by .*node/);
    await why.getByRole("button", { name: "Stop it and run again" }).click();
    await expect(run.getByLabel("Run status", { exact: true })).toHaveText("Running", { timeout: 20_000 });
    await expect.poll(() => holder!.exitCode !== null || holder!.signalCode !== null).toBe(true);        // the old holder was stopped
    await run.getByRole("button", { name: "Stop" }).click();
    } finally {
      holder?.kill();          // whatever happened above, nothing is left holding the port for the next run
    }
  }
  // Leave nothing open that other tests do not expect.
  await tool.getByRole("button", { name: "Run", exact: true }).click();
  const mine = page.getByRole("tab", { name: /Run Test App|localhost:7802/ });
  while (await mine.count()) {
    await mine.first().click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Close\s?(Cmd|Ctrl)/ }).click();
  }
  rmSync(dir, { recursive: true, force: true });
});

test("console: errors and warnings from a page appear with a badge, even with the panel closed", async () => {
  const srv = await new Promise<import("node:http").Server>(resolve => {
    const s = createServer((_q, r) => {
      r.setHeader("content-type", "text/html");
      r.end("<title>Console Test</title><script>console.log('hello');console.warn('careful now');console.error('page exploded');console.error('page exploded');</script>");
    });
    s.listen(7803, "127.0.0.1", () => resolve(s));
  });
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await go("localhost:7803");
  await expect(page.getByRole("tab", { name: /Console Test/ })).toBeVisible();
  const tool = page.getByRole("navigation", { name: "Tools" });
  await expect(tool.getByRole("button", { name: "Console" })).toContainText("2");       // two errors, with the panel closed
  await tool.getByRole("button", { name: "Console" }).click();
  const con = page.getByRole("region", { name: "Console panel" });
  await expect(con.getByText("page exploded")).toHaveCount(1);                           // the repeat is folded...
  await expect(con.getByLabel("2 times")).toBeVisible();                                 // ...into a counter
  await expect(con.getByText("careful now")).toBeVisible();
  await con.getByRole("button", { name: /^Errors/ }).click();
  await expect(con.getByText("careful now")).toHaveCount(0);
  await con.getByLabel("Filter console").fill("nothing like this");
  await expect(con.getByText("Nothing matches the filter.")).toBeVisible();
  await con.getByLabel("Filter console").fill("");
  await con.getByRole("button", { name: "Clear console" }).click();
  await expect(tool.getByRole("button", { name: "Console" })).not.toContainText("2");
  await tool.getByRole("button", { name: "Console" }).click();
  await page.getByRole("tab", { name: /Console Test/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Close\s?(Cmd|Ctrl)/ }).click();
  await new Promise<void>(r => { srv.closeAllConnections(); srv.close(() => r()); });
});

test("a new tab lists the local servers that are up, and opens one with a click", async () => {
  const srv = await new Promise<import("node:http").Server>(resolve => {
    const s = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end("<title>Ports Test</title>ok"); });
    s.listen(5555, "127.0.0.1", () => resolve(s));
  });
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  const list = page.getByRole("region", { name: "Running on your machine" });
  await expect(list.getByRole("button", { name: "Open localhost:5555" })).toContainText("Ports Test", { timeout: 15_000 });
  await expect(list.getByRole("button", { name: "Open localhost:7400" })).toContainText("Sandbox Shop");   // the sandbox shop is up
  await list.getByRole("button", { name: "Open localhost:5555" }).click();
  await expect(page.getByRole("tab", { name: /Ports Test/ })).toBeVisible();
  await page.getByRole("tab", { name: /Ports Test/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Close\s?(Cmd|Ctrl)/ }).click();
  await new Promise<void>(r => { srv.closeAllConnections(); srv.close(() => r()); });
});

test("sandbox test: load the 38-service company and see the agent scored on what was broken", async () => {
  test.setTimeout(240_000);
  const panel = page.getByRole("region", { name: "SentinelGraph panel" });
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Dependencies (SentinelGraph)" }).click();
  await panel.getByRole("button", { name: "Sandbox test", exact: true }).click();
  const box = panel.getByLabel("Sandbox test", { exact: true }).last();
  await box.getByRole("button", { name: /Load sandbox|Reload sandbox/ }).click();
  await expect(box.getByLabel("Sandbox company")).toContainText(/38 services, 8 databases, 8 teams, 18 engineers/, { timeout: 60_000 });
  await box.getByRole("button", { name: "Run test" }).click();
  await expect(box.getByLabel("Test result")).toContainText("12 of 12 correct", { timeout: 200_000 });
  await expect(box.getByText("FOUND").first()).toBeVisible();
  await expect(box.getByText(/synthetic/)).toBeVisible();
  await shot("16-sandbox");
  // The sandbox replaced the shop's map; put it back for whatever runs next.
  const back = await fetch(`${API}/api/workspace/scan`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: path.resolve(__dirname, "../../sandbox/shop") }),
  });
  expect(back.ok).toBe(true);
});
