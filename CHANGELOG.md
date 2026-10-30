# Changelog

All notable changes. Versions follow [semantic versioning](https://semver.org/).

## Unreleased

### Finds faults that raise no errors (found by testing on real data)
- Tested on RCAEval, a public benchmark of real injected faults (Online Boutique, 90 cases): the product named the right root cause in
  **0 of 90** cases. It only treated a service as unhealthy when its spans carried errors, and CPU, memory, disk and network faults
  mostly make services slow or starved instead.
- **Latency against a learned normal.** The trace ingest now remembers each service's normal p90 latency (from healthy batches only, so
  a fault is never learned as normal) and marks a service unhealthy, with an alert, when it is far above its own normal.
- **`POST /api/metrics`.** Time series per service (e.g. a Prometheus `query_range`); a service whose recent window is far outside its
  own history is marked unhealthy. A service that is always busy is not.
- Result, product only, traces and metrics together: right root cause first in 93% of 90 cases (93% on the 60 held-out), in the top
  three in 94%. See `docs/TESTING.md` for how to reproduce it and what it does not show.

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
