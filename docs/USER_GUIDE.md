# User guide

`⌘` means **Ctrl** on Windows and Linux.

## The window

| Part | What it does |
| :--- | :--- |
| **Tab strip** (top) | One tab per page. Each tab belongs to a *profile* (Default, Admin or Customer) with its own cookies and storage, shown on the tab. |
| **Address bar** | Type an address, a search, or just a port: `3000` opens `localhost:3000`. Searches go to Google. |
| **Toolbar buttons** (right of the address bar) | Device mode, split view, the tool panel toggle. |
| **Tool rail** (left) | Network, API Client, Security, AI Assistant; below the divider, SentinelGraph. Settings at the bottom. |
| **Status bar** (bottom) | Requests captured for the open site, SentinelGraph connection, local AI, memory in use, theme. |

## Browsing

| | |
| :--- | :--- |
| New tab / reopen closed tab | `⌘T` / `⌘⇧T` |
| Address bar | `⌘L` |
| Back / forward | `⌘[` / `⌘]` |
| Reload / hard reload | `⌘R` / `⌘⇧R` |
| Find in page | `⌘F` |
| Zoom in / out / reset | `⌘=` / `⌘-` / `⌘0` |
| Go to tab 1 to 8 / last tab | `⌘1`…`⌘8` / `⌘9` |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Device mode (phone emulation) | `⌘⇧M` |
| Split view (the page as two profiles side by side) | `⌘⇧S` |
| Show / hide the tool panel | `⌘\` |
| Command palette | `⌘K` |
| All shortcuts | `?` |

**Profiles.** Open the same site as an admin in one tab and as a customer in another without logging out of either.
Split view shows two profiles of the same page side by side.

**Device mode** emulates a phone: viewport, pixel density, user agent and touch.

**An unreachable dev server** shows a plain error page with a *Try again* button, not a blank tab.

## Tool panels

Panels dock beside the page, like DevTools docked right. Drag their edge to resize. On a narrow window a panel takes
the whole area.

### Network

Every request the page makes: method, status, URL, type, size, time, with headers, payload, response and timing for
the one you select. Search, filter by status or XHR, copy as you need. **Clear** empties the log.

### Security

A passive audit of what the page's own traffic reveals: missing security headers, permissive policies, version
disclosure and similar. It sends nothing of its own, so it is safe to run against any site. Each finding shows the
evidence, a recommended fix and the CWE and OWASP reference; **Export audit report** writes a SARIF file that GitHub
Code Scanning and CI tools can read.

### API client

Build, send and replay HTTP requests; a request from the Network panel opens here ready to edit.

### AI assistant

An on-device assistant that runs through Ollama. Ask about an error; if you have selected a request in Network, its
URL, status and response body are included. Nothing leaves your machine. It needs Ollama running locally; the
status bar shows whether it is.

### This site, and History

Network and Security show **the website you are on, and only that**. Moving to another site changes what you see;
the badges and the status-bar count follow. Press **History** to see everything captured earlier, each item labelled
with the page it came from, so you can audit a site you left. A site is the address plus port: `localhost:7400` and
`localhost:7401` are different sites.

## SentinelGraph panel

Needs the SentinelGraph server (see [Getting started](GETTING_STARTED.md)). It opens as a full page, because a map
needs the room.

| Control | What it does |
| :--- | :--- |
| **Connect codebase** | Pick a repository folder; its services, databases, outside APIs and connections appear. A different project replaces the map; the same project refreshes it. |
| **Find a service** | Type a name to select it (clicking a node does the same). |
| **Context** | Also show deploys, commits, people and incidents. |
| **Fit** / **Refresh** | Frame the whole map / reload it now. The panel also refreshes itself every few seconds. |
| **Investigate** | Start the agent. It lists every step it takes, lights up its path on the map, and ends with the root cause and proposed fixes. |
| **Restore healthy** | Appears when something is unhealthy; returns every service to healthy. What the agent has learned is kept. |

**Reading the map.** A circle is a service, a rounded square a database. Size is importance (the more other services
depend on it, the bigger). Grey is healthy, amber degraded, red down, blue the agent's path. A dashed ring marks a
chokepoint: a service many paths run through.

**The selected service** shows its owner, tier, change history and importance, with:

- **Show blast radius**: everything that breaks if it fails, in red.
- **Investigate this service**: the agent starts from it.
- **Simulate a failure**: **Ship a bad deploy**, **Crash it**, **Degrade it**. Use these to see how a failure looks and what the agent does with it. The failure is simulated in the graph; nothing real is touched.

**When you press Investigate** the agent works through the graph, never guessing: which alerts are firing, what they
share, whether it has seen this before, what changed recently, who owns the culprit, how far it spreads, and what to
do. It can *propose* a rollback, a circuit breaker, a scale-up or a page to the on-call person. You press **Approve**
or **Reject**. With nothing alerting it says so: *All clear.*

**Investigate this failure** (Network panel, on a failed request) starts an investigation with that request as
evidence.

## Settings

| Section | |
| :--- | :--- |
| Privacy | What the app collects (nothing) and how saved credentials are protected: they are encrypted with your system's secure storage. |
| AI | The local model (Ollama) and its status. |
| Integrations | The SentinelGraph address. |
| Browsing data | What the app keeps on this machine, and **Clear browsing data**: cookies, storage and cache of every profile, saved credentials, history and captured traffic. |

## Troubleshooting

| Symptom | Fix |
| :--- | :--- |
| "SentinelGraph not connected" | The server is not running or the address is wrong. Start `./scripts/sentinelgraph.sh` and use `http://127.0.0.1:8100`. |
| **Connect codebase** says the folder is "not a directory on the machine running the SentinelGraph API" | The server cannot see that folder. With Docker, set `PROJECTS_DIR` to a folder that contains it. |
| The map shows one service for a monolith | The project is built from the repository root with no usable source folders. Check the folder you picked is the repository root. |
| A page does not load | The error page names the address that failed. For a dev server, check it is running on that port. |
| Network or Security is empty | You are on a new tab, or a different site from the one you expect. Use **History**. |
| macOS: "DevBrowser can't be opened" | First launch of an unsigned build: right-click, **Open**. See [Getting started](GETTING_STARTED.md#first-launch). |
| Something else | Open the log (`…/DevBrowser/logs/devbrowser.log`, paths in [Getting started](GETTING_STARTED.md#where-things-are-stored)) and attach it to an issue. |
