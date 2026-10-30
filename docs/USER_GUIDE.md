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
| Bookmark this page | `⌘D` (or the star in the address bar) |
| Command palette | `⌘K` |
| All shortcuts | `?` |

**Profiles.** Open the same site as an admin in one tab and as a customer in another without logging out of either.
Split view shows two profiles of the same page side by side.

**Device mode** emulates a phone: viewport, pixel density, user agent and touch.

**Bookmarks** are listed on the new-tab page; click the star again to remove one.

**An unreachable dev server** shows a plain error page with a *Try again* button, not a blank tab.

## Tool panels

Panels dock beside the page, like DevTools docked right. Drag their edge to resize. On a narrow window a panel takes
the whole area.

### Network

Every request the page makes: method, status, URL, type, size and time, with headers, payload, response and a **timing
waterfall** for the one you select (DNS, connecting, TLS, sending, waiting for the server, downloading, as the browser
measured them; a cached request has none). Search, filter by status or XHR. **Clear** empties the log. A request can be
opened in the API client to edit and replay it.

- **Throttling** (Fast 3G, Slow 3G, Offline) slows or cuts the page you are on, like DevTools. Reload the page to see the effect; it applies to that tab until you change it.
- **HAR** saves the listed requests in the standard HAR format (every developer tool reads it). Credentials are removed: authorization and cookie headers, and token-like query values. **HAR + bodies** also includes request and response bodies, which can hold secrets nothing can find for you, so it asks first.

#### Mocks: fake a slow, broken or empty backend

Right-click a request in the list:

- **Mock this response…** opens an editor with the captured response; change the body or status and save.
- **Return 500** / **Return 404** answer with that error. **Delay 5 seconds** lets the real server answer, late. **Drop the connection** makes the call fail.

Reload the page to see it. Rules live in the **Mocks** pane (the button in the toolbar): turn individual rules or all mocking on and off,
edit them, see how often each answered. Addresses can use `*`; a rule for `/api/products` also answers `/api/products?limit=2`. The first
matching rule wins. You can also make rules **From HAR** (a "HAR + bodies" export) or **From a bug recording**, and run the page with no
backend at all. Mocking is off after every launch; while it is on, the status bar shows ◆ MOCKS.

### Security

A passive audit of what the page's own traffic reveals: missing security headers, permissive policies, version
disclosure and similar. It sends nothing of its own, so it is safe to run against any site. Each finding shows the
evidence, a recommended fix and the CWE and OWASP reference; **Export audit report** writes a SARIF file that GitHub
Code Scanning and CI tools can read.

### API client

Send a real request and see the real response: status, time, size, headers and body (JSON is formatted). It sends from the
app, not from a page, so **CORS never gets in the way** of testing your own API. Cookies from your browsing are *not*
sent; add a `Cookie` header if a request needs one.

| | |
| :--- | :--- |
| **Address** | `localhost:3000/health` is taken as `http://`. Enter sends. |
| **Headers, Params, Body** | Rows you can switch off. A JSON body gets `Content-Type: application/json` unless you set one. GET and HEAD are sent without a body. |
| **Variables** | `{{name}}` in the address, headers or body. A request that uses a name you have not defined is not sent, and says which. Values of names that look like credentials (token, secret, key, password, authorization) are kept in memory and are gone when you quit. |
| **Checks** | Status is (`200`, `2xx`, `<400`), time under N ms, body contains text, a JSON value at a path (`data.items.0.id`). They run on every response and show passed or failed beside it. |
| **Import cURL** | Paste a `curl` command (from API docs, or Copy as cURL in any DevTools) into the address bar, or use **Import cURL**: the method, address, headers, body, basic auth and cookies become a request. |
| **Save / Load** | Save a request (credentials typed into headers are *not* saved: use a variable). **Load…** lists your saved requests and what you sent this session. |
| **cURL** | Copies the request, variables filled in. Check it for secrets before you share it. |

A server that is not there is explained (*connection refused*, *no response within 30 s*, *could not resolve the host*),
never shown as a made-up response. What it does not do (yet): collections and folders, request chaining or scripting,
OAuth helpers, file uploads, importing from Postman or OpenAPI.

### Bug Recorder

Turn "it breaks when I click Pay" into a file a teammate can replay.

1. Load the page where the bug happens and open **Bug Recorder** in the tool rail (or the command palette: *Record This Tab*).
2. Press **Record this tab**, do what triggers the bug, press **Stop**. A red **REC** marks the status bar meanwhile.
3. The recording opens with **What went wrong** (the first error or failing request, and what you did right before it), and a
   timeline: your actions, every request with its response, console errors, and snapshots of the page you can look at as it was.
4. **Export file** saves one `.devrec.json`. Passwords, tokens, cookies and keys are removed before anything is written; the panel says how many.
5. A teammate presses **Open file**, picks it, and presses **Replay**. A new tab opens on their copy of the app (change **Replay against**
   if it runs on another port) and repeats your actions. The result says **Reproduced**, **Partly reproduced** or **Not reproduced**,
   and lists which problems did or did not happen.

Replay needs the app to be running; it does not mock the network. Hidden fields (passwords) are never recorded, so replay skips them.

### AI assistant

An on-device assistant that runs through Ollama. Ask about an error; if you have selected a request in Network, its
URL, status and response body are included (with tokens and passwords masked). Nothing leaves your machine. It needs
Ollama running locally with a model installed; if it is not, the assistant says so and how to start it, and does not
guess. It is a general coding assistant: it does not inspect your page or run your code.

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
| **Check my changes** | Which services do your uncommitted changes touch, and what depends on them? Shown as a card with a risk level and highlighted on the map. The level is a heuristic: a critical service in the blast radius, or a large share of the system, is high. Needs a connected project on the machine running the server. |
| **Live data** | The OpenTelemetry Collector and Alertmanager configuration for your server, ready to paste. This is how real traffic and alerts reach the map. |
| **Restore healthy** | Appears when something is unhealthy; returns every service to healthy. What the agent has learned is kept. |

**Reading the map.** A circle is a service, a rounded square a database (a database can fail, be alerted on and be a root cause like any service). Size is importance (the more other services
depend on it, the bigger). Grey is healthy, amber degraded, red down, blue the agent's path. A dashed ring marks a
chokepoint: a service many paths run through.

**The selected service** shows its owner, tier, change history and importance, with:

- **Seen in your browsing**: the requests you made to this service while browsing (most recent five, how many failed), with **Open in Network**; and **Open localhost:PORT** opens it in a tab.
- **Show blast radius**: everything that breaks if it fails, in red.
- **Investigate this service**: the agent starts from it.
- **Simulate a failure**: **Ship a bad deploy**, **Crash it**, **Degrade it**. Use these to see how a failure looks and what the agent does with it. The failure is simulated in the graph; nothing real is touched.

**When you press Investigate** the agent works through the graph, never guessing: which alerts are firing, what they
share, whether it has seen this before, what changed recently, who owns the culprit, how far it spreads, and what to
do. It can *propose* a rollback, a circuit breaker, a scale-up or a page to the on-call person. You press **Approve**
or **Reject**. With nothing alerting it says so: *All clear.*

It ends with a **confidence** (`high`, `medium`, `low`) and the reasons: how many independent pieces of evidence agree. It is a count, not a probability, and
several failures are never `high`. When two or more things are broken at once, it says **"2 separate failures"** and proposes a fix and a page for each
(simulated failures add to each other, so you can try it).

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
