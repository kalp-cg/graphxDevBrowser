# Changelog

All notable changes. Versions follow [semantic versioning](https://semver.org/).

## Unreleased

### Mocks: answer requests yourself, from the Network panel
- **Right-click any request** in the Network list: *Mock this response…* (opens an editor filled with the captured response), *Return 500*,
  *Return 404*, *Delay 5 seconds*, *Drop the connection*. The page gets the made-up answer, a slow one, or a dead connection, without
  touching the backend. Mocked rows are tagged MOCK; dropped ones are listed as Failed.
- **Mocks pane** (a button in the Network toolbar): a master switch, every rule with its own switch and hit count, an editor (method,
  address with `*` wildcards, status, headers, body, delay), and what rules did recently. The first matching rule wins; new ones go first.
- **No backend needed:** make rules from a **HAR file** (export "HAR + bodies") or from a **bug recording**, and the page runs on the
  recorded responses.
- Safe by construction: nothing is intercepted until a rule is on (no rule, no paused request); only requests matching a rule's address
  are ever paused and every one is resolved, whatever goes wrong; cross-origin calls get the CORS answers they need; mocking is switched
  off at every launch (rules are kept) and the status bar shows ◆ MOCKS while it is on. A made-up response is not audited by Security and
  is not reported to SentinelGraph as real traffic.
- Added: a small main-process module and one IPC call; the existing capture, throttling and device emulation are untouched.

### Bug Recorder: record a bug, send one file, replay it
- **Record this tab.** The Bug Recorder panel (and the command palette, and the red REC marker in the status bar) records one tab: clicks,
  typing, Enter/Escape, scrolling, page navigations, every request and response, console errors and warnings, uncaught errors and
  unhandled promise rejections, and the page itself (a screenshot and a self-contained DOM snapshot at the start, at each error, and at the end).
- **One shareable file** (`.devrec.json`). Credentials never go in: password-like fields are never captured, `Authorization`/cookie headers,
  token-like query values, JWTs, bearer values, well-known key formats and secret-named JSON fields are removed, and the file says how many.
- **Replay.** A teammate opens the file and replays it in a new tab against their own copy of the app (the address is editable, for a
  different port). DevBrowser re-does the clicks and typing with a highlight on each element, then says **reproduced**, **partly**, or **not
  reproduced** by comparing the errors and failing requests it saw with the recording's.
- "What went wrong" on every recording: the first error or failing request and the action right before it.
- Additive: the main process and the preload bridge are untouched; the existing panels behave as before. 21 unit tests and a real-app end-to-end test.

### Run, Console, and what is running on your machine
- **Run panel.** Choose your project folder; DevBrowser suggests what to run from what is in it (npm/pnpm/yarn/bun scripts, Django, Go,
  Rust, Gradle, Maven, Docker Compose, .NET, Swift, Python, Make). It shows the output, opens the page in a tab the moment the server
  announces its address, and stops everything the command started. When a run dies it says why in plain words: a port already taken
  (and who holds it, with a button to stop that process and run again), a missing module or command, a missing environment variable,
  a database that is not up, a compile error, a crash, out of memory. SentinelGraph is told when the server crashes and when it is back.
- **Console panel.** Every tab's console errors, warnings and failed loads in one list, repeats folded into a counter, filterable,
  copyable, with a badge on the sidebar even when the panel is closed.
- **Running on your machine.** A new tab lists the local servers that are up, with the title of the page each serves; one click opens it.
- Fixed: the sandbox exam crashed at the end (`soft_reset` was not imported) and left the company broken.

### Browser: tabs, and a dev server that dies
- Tabs scroll and keep the active tab in view; they can be pinned, dragged to reorder, and right-clicked (reload, duplicate, pin, close
  others, close to the right, reopen closed tab); double-click the empty strip for a new tab; the close button shows on hover.
- **Dev server watch.** Every tab showing a local page is checked every 3 seconds. When its server stops answering (two failed checks in
  a row, so a restart on a file change is not a crash) the tab turns red with a banner, a notification appears, and SentinelGraph gets an
  alert on the service that owns that address. When the server returns the tab reloads itself and the alert clears.
- Fixed: an Alertmanager alert that resolved left its service "degraded" forever.

### Scans any codebase (found by opening BitChat, a Swift app)
- Opening a repository with no compose file and no JavaScript or Python manifests (BitChat, a Swift app) failed with "no services found".
  The scanner now recognises Swift, Kotlin, Java, Go, Rust, C#, C/C++, Dart, Ruby, PHP, Scala, Elixir and more, and a repository with no
  services layout is mapped as one application broken into its modules (folders).
- Dependencies between modules in these languages are found from the types each module uses that only another module declares.
- Folders that only wrap the code, build output, vendored code and test folders are not modules. Pre-merge impact works for them too.
- The only refusal left is a folder with no files in it.

### Finds faults that raise no errors (found by testing on real data)
- Tested on RCAEval, a public benchmark of real injected faults (Online Boutique, 90 cases): the product named the right root cause in
  **0 of 90** cases. It only treated a service as unhealthy when its spans carried errors, and CPU, memory, disk and network faults
  mostly make services slow or starved instead.
- **Latency against a learned normal.** The trace ingest now remembers each service's normal p90 latency (from healthy batches only, so
  a fault is never learned as normal) and marks a service unhealthy, with an alert, when it is far above its own normal.
- **`POST /api/metrics`.** Time series per service (e.g. a Prometheus `query_range`); a service whose recent window is far outside its
  own history is marked unhealthy. A service that is always busy is not.
- Result, product only, traces and metrics together (RCAEval, final numbers; an earlier 93% leaned on an arbitrary alphabetical
  tiebreak and was optimistic): Online Boutique, 90 cases: right cause first in **86%**, in the top three in 93%. Train Ticket (69
  services), 60 cases: first in **73%**, top three 82%. Random guessing: 8% and 1.5%. See `docs/TESTING.md` to reproduce.
- Weak spots, stated plainly: on Train Ticket memory faults (50% in top 3) and packet loss (56%) are often missed, and the strongest-
  anomaly baseline with no graph ranks about as well at the top (68% first, 90% top three), so at 69 services the graph adds little
  over a good anomaly detector. Ranking among many flagged services is the open problem.

### Sandbox test
- **Sandbox test** button on the service graph: loads a 38-service company (8 databases, 8 teams, 18 engineers, 101 deployments,
  3 past incidents) and runs a 12-case exam. We break things on purpose (nothing wrong, the four named incidents, a database, a busy
  platform service, a deploy, a slow service, two and three failures at once), the agent investigates, and the answer is scored
  against what we broke. Pick the built-in agent or a language model; a case a model cannot answer is shown as handed to the built-in
  agent and is not counted in the model's score.
- Models that write their tool calls as text (`{"name": ..., "arguments": ...}`) instead of the structured field are now understood.
  Before, such a model made no tool calls at all and scored 1 of 12.
- Ollama: the installed model closest to the configured one is used when the configured one is missing.

## 1.1.0 (2026-10-31)

### Accuracy
- **Databases are first-class.** A database can now be unhealthy, be alerted on, be simulated as failed, and be named the root cause.
  Before, when a database and the service using it both alerted, the agent said "no shared dependency" and escalated.
- **Separate failures are reported as separate.** Two things broken at once give two root causes, a fix and a page for each. Before,
  the agent either escalated or explained everything with one cause and silently ignored the other.
- **Every answer says how sure it is**, and why: `high`, `medium` or `low`, from how many independent pieces of evidence agree
  (an unhealthy service with nothing unhealthy beneath it, several alerting services depending on it, a deployment just before the alerts, a past
  match). Several failures are never `high`. It is a count of evidence, not a probability.
- A ground-truth **benchmark** of eight repository layouts plus the sample shop, scored for precision and recall; `scripts/benchmark.py`
  scores a repository against a truth file you write. (It found three real connections missing from our own hand-written truth.)
- Fixed: a container folder such as `svc/` was mistaken for a service and hid the real services inside it.

### New in the app
- **Check my changes.** Which services do your uncommitted changes (or the branch since `main`) touch, and what depends on them, with a risk
  level (a stated heuristic), highlighted on the map. Also `python -m sentinel.ingest impact PATH` and a ready pull-request workflow
  (`docs/ci/sentinelgraph-impact.yml`) that comments on each PR and can fail a risky one.
- **A service knows its traffic.** Select a service to see the requests you browsed to it, open it in a tab, or jump to them in Network.
- **Live data in one click.** The exact OpenTelemetry Collector and Alertmanager configuration for your server, ready to paste.
- **API client:** import a `curl` command (paste it into the address bar, or use Import cURL).
- **Network:** throttling (Fast 3G, Slow 3G, Offline) and **HAR export** with credentials removed (bodies only on request).
- **Bookmarks** (⌘D, the star in the address bar, listed on the new-tab page).
- Simulated failures add to each other when something is already broken, so you can try several at once.
- Errors from the server now say what went wrong in plain words.

## 1.0.0 (2026-10-30)

First release.

### DevBrowser (desktop app)
- A browser for developers: tabs, split view, separate profiles, device emulation, find, zoom, session restore, and
  one-click local dev servers.
- Network and Security panels that show **the website you are on**, with a History view for earlier sites. The Network panel
  shows the browser's real timing for each request as a waterfall.
- An **API client that really sends requests** from the app (no CORS), with variables, checks, saved requests and
  session history. (An earlier build showed placeholder data here; it was found in review and replaced.)
- Passive security audit with SARIF export.
- A SentinelGraph panel: the live service map, blast radius, investigation trail, approve and reject, and simulated
  failures for trying it out.
- A new-tab page that walks through the three first steps.
- Installers for macOS (Apple silicon and Intel), Windows (installer and portable) and Linux (AppImage and deb).
- Production plumbing: log file, automatic recovery from interface crashes, window size and position remembered, an
  About panel, a single running instance, and an app window that can never navigate away.
- Captured traffic is sent to the SentinelGraph server without query strings or fragments.

### Fixed before release
- A page that calls its own backend (one origin: Next.js, Django, Rails) had its failed requests dropped, so
  *Investigate this failure* answered "All clear". They now count as evidence about that service, and on a monolith an
  `/api/<name>` route is attributed to its own module.
- Removed invented data: fixed timings in the Network panel, a fixed "38 ms" and a canned response in the API client, canned
  AI answers when no model is running, and an unused TigerGraph pass-through.

### SentinelGraph (server)
- Reads a repository into a graph: Docker Compose (with `.env` variables) and Kubernetes manifests, services,
  databases, languages, owners (`CODEOWNERS`) and recent changes (git).
- Maps **monoliths** from source imports (TypeScript, JavaScript, Python): modules, the database, and the outside APIs
  each module calls.
- Leaves monitoring, load generators and feature-flag servers out of the map so they do not distort blast radius.
- An agent that finds the shared dependency behind a set of alerts, names the change and the owner, and proposes
  actions that wait for approval. Investigating a healthy system says so.
- One-command start (`scripts/sentinelgraph.sh`) and a Docker setup that listens on `127.0.0.1` only, keeps its graph
  in a volume and mounts your projects read-only.

### Known limits
- The server has no authentication: run it on your own machine only.
- Installers are not code-signed; expect one warning on first launch.
- Windows and Linux builds have not been run on real hardware.
See [docs/TESTING.md](docs/TESTING.md#10-known-limits).
