# Dev Browser

**Commercial Desktop Browser for Software Developers**

Dev Browser is a local-first developer operating environment that unifies web browsing, network inspection, API replay, passive web security auditing, local AI debugging, and microservice dependency graph analysis.

Built specifically for Apple Silicon hardware (optimized for MacBook Air M4 with 16 GB Unified Memory).

---

## Architecture & Technology Stack

* **Desktop Runtime:** Electron 33 (multi-process isolation, native CDP attachment via `webContents.debugger`, macOS Keychain credential storage via `safeStorage`).
* **Frontend Shell:** React 18, TypeScript (strict mode), Vite 5.
* **Local AI Inference Engine:** Ollama local daemon (`http://127.0.0.1:11434`) running quantized coding models (`qwen2.5-coder:7b`).
* **Graph Subsystem:** `IGraphProvider` abstraction supporting an embedded `InMemoryGraphProvider` (MVP) and enterprise `TigerGraphRestProvider` (REST++).
* **Voice Subsystem:** `IVoiceInputProvider` abstraction supporting native **Wispr Flow macOS Desktop** dictation and Wispr Flow Voice Interface API integration.
* **Process Security Model:** `nodeIntegration: false`, `contextIsolation: true`, sandboxing, strict Content Security Policy (CSP), and typed `contextBridge` IPC gateway.

---

## System Requirements & Prerequisites

* **Operating System:** macOS 14+ (Apple Silicon `arm64` recommended: M1/M2/M3/M4).
* **Memory:** 16 GB Unified RAM recommended.
* **Runtime:** Node.js `>= 20.0.0` (Verified on Node `v26.8.2`).
* **Package Manager:** `npm` `>= 10.0.0` (Verified on npm `11.19.1`).
* **Local AI (Optional but recommended):** [Ollama](https://ollama.com) installed with `qwen2.5-coder:7b`:
  ```bash
  ollama run qwen2.5-coder:7b
  ```

---

## Quickstart & Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Run in Development Mode
Launches Vite dev server with Electron hot reload:
```bash
npm run dev
```

### 3. Run Automated Checks
* **Typecheck (Strict TypeScript):**
  ```bash
  npm run typecheck
  ```
* **Linting (ESLint 9):**
  ```bash
  npm run lint
  ```
* **Unit Tests (Vitest):**
  ```bash
  npm run test
  ```

### 4. Build Production Bundle
Bundles the React UI (`dist/`) and Electron main/preload processes (`dist-electron/`):
```bash
npm run build
```

---

## The Browser

Every tab is a live page kept in memory: switching tabs or opening a tool panel never reloads it.

* **Tabs:** titles, icons and loading state from the page; middle-click to close; reopen closed tabs; the session
  (tabs, zoom, profile per tab) is restored on launch. Links that open windows (`target=_blank`, `window.open`)
  open as tabs.
* **Address bar:** URLs, `localhost:3000`, a bare port (`3000`), LAN and `.test` hosts get `http`; anything else is a
  search. It shows whether a page is secure, local or not secure.
* **Page tools:** find in page, zoom, the page's own Chrome DevTools, a context menu (open link in new tab, copy,
  view source, inspect element), and an error page that explains `ERR_CONNECTION_REFUSED` and friends.
* **Developer tools beside the page:** Network, Dependencies, API client, security and AI open in a resizable panel
  next to the live page; maximize any of them.
* **Device mode:** phones and tablets at their real CSS width, with their user agent and touch input. The page lays
  out at the device width (the <webview> is sized to it); it renders at your screen's pixel ratio.
* **Split view and profiles:** Default, Admin and Customer profiles each have their own cookies and storage; split
  view shows the page as two profiles side by side, to compare roles.
* **Shortcuts:** the app menu holds them, so they work while a page has focus. Press `?` for the list.
* **Clear browsing data** signs out of every profile and removes history, credentials and captured traffic.

The design uses neutral greys and three colours only: accent (interactive, healthy), warning (degraded) and danger
(failures). Light and dark themes.

End-to-end tests drive the built app against the sandbox: `npm run build`, `python ../sandbox/run.py up`, then
`cd ../e2e && npx playwright test -c devbrowser.config.ts`.

## SentinelGraph Integration (TigerGraph dependency graph)

The **Dependencies** view can show a live service graph from a SentinelGraph API (the H&H Goa incident graph backend), which keeps it in
TigerGraph. Without a connection it shows the built-in sample graph.

1. Run SentinelGraph (`uvicorn sentinel.api.main:app --port 8100` in its `backend/`, with `TG_HOST` / `TG_SECRET`).
2. In **Settings → Integrations → SentinelGraph**, enter the API URL (`http://localhost:8100`),
   then **Connect & Load Graph**.

What happens then:

* **Real topology:** services, web apps and databases come from the TigerGraph graph, laid out in dependency layers.
* **Browsing feeds the graph:** every API call a page in the `<webview>` makes (captured over CDP) is batched and
  sent to `POST /api/browser-traffic`. The page's origin depends on each API host; after a codebase scan both
  resolve to the scanned services (`localhost:7404` is `checkout`), otherwise the page is a `web:<host>` app.
  Passive capture is topology only: it never changes health or fires alerts. Page assets and 4xx are ignored.
* **Dependencies panel:** the same live graph as the web dashboard: services sized by PageRank, failures in warning
  or danger, the agent's path lit up during an investigation, blast radius on any service, and Approve / Reject.
* **Service context:** selecting a request in the Network panel shows the service behind it, its owner,
  on-call, health, blast radius and recent changes (`GET /api/resolve`).
* **Investigate this failure:** on a 5xx, starts an investigation with that request as evidence, streams the
  agent's steps into the panel and lets you approve or reject the actions it proposes.
* **Reconnects on launch:** the URL and the keychain-encrypted token are saved in the app's user data.
* **Blast radius** runs as a GSQL traversal in TigerGraph (`GET /api/services/{name}/blast-radius`, up to 6 hops),
  not just the direct neighbours.
* **Credentials:** TigerGraph credentials stay on the SentinelGraph server.

Code: `src/main/integrations/sentinel-client.ts` (API client, traffic batching),
`src/shared/domain/sentinel.ts` (mapping and layout), tests in `tests/unit/sentinel-*.test.ts`. The live tests run
against a real API with `SENTINEL_URL=http://localhost:8100 npm test`, and the full
incident loop against the sandbox (`../sandbox/README.md`) with `SENTINEL_SANDBOX=1`.

---

## Project Structure

```
├── docs/
│   ├── PRD.md                       # Comprehensive Product Requirements Document
│   ├── ARCHITECTURE_DECISIONS.md    # Architecture Decision Records (ADRs)
│   ├── ROADMAP.md                   # Phased Engineering Roadmap & Milestone Matrix
│   └── IMPLEMENTATION_PLAN.md       # Implementation Plan & Environmental Assessment
├── src/
│   ├── main/                        # Electron Main Process (Node.js)
│   │   ├── index.ts                 # Window management, lifecycle, shutdown
│   │   ├── session/                 # Container profiles & session.fromPartition()
│   │   ├── security/                # CSP headers & permission boundaries
│   │   └── bridge/                  # IPC handlers (metrics, Ollama, tabs, privacy)
│   ├── preload/                     # Preload ContextBridge (Sanitizer)
│   │   ├── index.ts                 # contextBridge.exposeInMainWorld
│   │   └── api.ts                   # Strongly typed DevBrowserAPI interface
│   ├── renderer/                    # React UI Workspace Shell
│   │   ├── index.html               # Main entrypoint with strict CSP
│   │   ├── main.tsx                 # React DOM mount
│   │   ├── App.tsx                  # Split views, navigation, workspace coordinator
│   │   ├── index.css                # Custom dark developer design system
│   │   └── components/
│   │       ├── Header.tsx           # Titlebar, container profiles, omnibox
│   │       ├── DockPanel.tsx        # Network, API Client, Security, AI, Graph
│   │       └── StatusBar.tsx        # M4 hardware telemetry, Ollama, Nuclear Shred
│   └── shared/                      # Isomorphic Domain Contracts & Schemas
│       ├── env.ts                   # Strict Zod environment configuration
│       ├── ipc-channels.ts          # Typed IPC channel definitions
│       └── domain/                  # Typed domain models & integration interfaces
│           ├── browser.ts           # Tabs, windows, partitions, split layouts
│           ├── network.ts           # Network transactions, timings, WebSocket
│           ├── api-client.ts        # Request models, collections, env vars
│           ├── security.ts          # OWASP passive rules, evidence schemas
│           ├── graph.ts             # IGraphProvider interface, nodes, edges
│           ├── ai.ts                # IAIAssistantProvider, Ollama models, diffs
│           ├── voice.ts             # IVoiceInputProvider interface (Wispr Flow)
│           ├── privacy.ts           # safeStorage vault, Nuclear Shred options
│           └── persistence.ts       # SQLite storage contracts
└── tests/
    └── unit/                        # Automated Vitest test suites
        ├── domain-schemas.test.ts   # Zod validation tests
        ├── graph-provider.test.ts   # IGraphProvider integration contract test
        ├── voice-provider.test.ts   # IVoiceInputProvider interface test
        └── env-validation.test.ts   # Environment validator tests
```

---

## License

Confidential — Commercial Desktop Product. All rights reserved.
