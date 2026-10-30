# Testing DevBrowser in the real world

A test plan you can run today, in about two hours, on machines and code that are not ours. Each part says what to
do, what you should see, and what counts as a pass. Report anything that is not a pass (see the end).

Contents: [1 Install](#1-install-10-minutes) · [2 Smoke test](#2-smoke-test-15-minutes) ·
[3 Real repositories](#3-real-repositories-30-minutes) · [4 Your own project](#4-your-own-project-20-minutes) ·
[5 Failure drill](#5-failure-drill-15-minutes) · [6 Privacy](#6-privacy-and-scoping-10-minutes) ·
[7 Robustness](#7-robustness-15-minutes) · [8 Pilot with real engineers](#8-pilot-with-real-engineers) ·
[9 Automated tests](#9-automated-tests) · [10 Known limits](#10-known-limits) · [11 Reporting](#11-reporting-a-problem)

Test on at least: one Mac, one Windows PC, and (if you can) one Linux machine. The Windows and Linux installers are
built by the same pipeline as the Mac one but were **not run on real hardware before this release**, so those two
are where bugs are most likely.

## 1. Install (10 minutes)

| Step | Pass if |
| :--- | :--- |
| Download the installer for your system from the release page and check it against `SHA256SUMS.txt` | The checksums match. |
| Install it (steps in [Getting started](GETTING_STARTED.md#1-install-devbrowser)) | It installs; the app has the DevBrowser icon and name in the dock, taskbar and menu. |
| First launch (expect one unsigned-app warning on macOS and Windows) | Opens to the DevBrowser page with three numbered steps. |
| Quit and relaunch | Opens in about a second or less after the first launch (we measured 0.6 to 0.8 s on an M-series Mac; the very first launch took 3.4 s). |
| Resize the window down to about 700 px wide | Nothing is cut off; tool panels fill the window. |
| Uninstall | Removes the app. |

## 2. Smoke test (15 minutes)

Start any local web app (even `python3 -m http.server 3000`).

| Do | Pass if |
| :--- | :--- |
| Type `3000` in the address bar | The page loads; the tab takes the page's title. |
| Open the Network panel and reload | Requests appear with status, size, time; selecting one shows headers and the response. |
| Open Security | Findings for *this site* appear, each with evidence and a fix. |
| Open a second site in a new tab | Network and Security now show only the second site. **History** still shows the first, labelled with its page. |
| `⌘⇧M` | Phone emulation: narrow viewport, mobile user agent. |
| `⌘⇧S` | The page shows twice, as two profiles. |
| Close a tab, `⌘⇧T` | It comes back. |
| Quit and relaunch | Your tabs are restored. |
| Open an address nothing listens on | A plain error page with *Try again*, not a blank tab. |

## 3. Real repositories (30 minutes)

Goal: check the map against open-source systems whose structure you can verify yourself.

```bash
mkdir -p ~/devbrowser-test && cd ~/devbrowser-test
git clone --depth 50 https://github.com/open-telemetry/opentelemetry-demo.git
git clone --depth 50 https://github.com/GoogleCloudPlatform/microservices-demo.git
git clone --depth 50 https://github.com/spring-petclinic/spring-petclinic-microservices.git
git clone --depth 50 https://github.com/microservices-patterns/ftgo-application.git
git clone --depth 50 https://github.com/dockersamples/example-voting-app.git
```

Start SentinelGraph, connect DevBrowser, then for each repository press **Connect codebase…** and pick its folder.

**What we got** (scanner 1.0 at the commits below; repositories move, so expect the same *shape*, not always the same
digits; clones are `--depth 50`, so the change counts depend on recent activity):

| Repository | Commit | Read from | Services | Databases | Connections | Recent changes | Scan time |
| :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| OpenTelemetry Demo | `33bd823107` | docker-compose | 14 | 2 | 20 | 43 | 0.6 s |
| GCP Online Boutique | `c7cb6d5bfd` | Kubernetes | 11 | 1 | 16 | 0 | 1.0 s |
| Spring PetClinic (microservices) | `e8b747ab52` | docker-compose | 8 | 0 | 13 | 7 | 0.5 s |
| FTGO | `558dfc53b1` | docker-compose | 9 | 4 | 34 | 0 | 0.4 s |
| Example voting app | `63e9150ca1` | docker-compose | 4 | 2 | 5 | 0 | 0.4 s |
| Sock Shop | `9dff06fae4` | docker-compose | 9 | 5 | 1 | 0 | 0.4 s |
| ContractAI (a Next.js monolith) | `9840757100` | compose + code imports | 19 | 1 | 52 | 43 | 0.4 s |

Times are wall-clock for the scan on an Apple M-series laptop, including starting Python.

**Pass if, for each repository:**

- The service names match the project's own documentation or compose file; nothing is missing and nothing is invented.
- Pick three connections at random and confirm each in the code (a `depends_on`, a URL in an environment variable, or an import).
- The entry point (the service with a published port that nothing else calls) is at the top.
- Languages are right for the services where the folder is in the repository.
- Monitoring, load generators and feature-flag servers are **not** in the map (they would make every failure look like it
  affects everything). For OpenTelemetry Demo, `otel-collector`, `flagd` and `load-generator` are deliberately left out.
- Connecting the next repository **replaces** the map.

**Known weak spots, so you can tell a bug from a limit:**

- **Sock Shop shows one connection.** Its compose file declares almost none; the real calls only appear with traces
  or by browsing the running app.
- Repositories with no `CODEOWNERS` show "no owner".
- Services whose code is not in the repository (images pulled from a registry) show no language.

## 4. Your own project (20 minutes)

This is the test that matters most.

1. Connect your project's repository folder.
2. **Without looking at the result first**, write down the services and connections you expect.
3. Compare. Count: services missing, services invented, connections missing, connections invented.
4. For a monolith, check the modules read like the real structure of the code, and that the database and outside APIs
   your code calls are there (and that ones you only *mention* in `.env.example` are not).
5. Browse your running app in DevBrowser with the Network panel open; reconnect the codebase and check the
   calls your pages make attach to the right services.

**Pass if** at least 90% of the services and connections you expected are present, and at most one in ten of what is
shown is wrong. Send us the numbers either way; a project where it scores badly is the most valuable report.

## 5. Failure drill (15 minutes)

| Do | Pass if |
| :--- | :--- |
| With everything healthy, press **Investigate** | It says nothing is alerting. It does not invent a problem. |
| Choose a service in the middle of the map (something others depend on), **Crash it** | It and the services that call it turn red or amber; the toolbar counts them. |
| Press **Investigate** | The steps list names the alerting services, finds the **one shared dependency** and says it is down, lists who owns it, and counts the blast radius. The **root cause is the service you crashed.** |
| Open the *blast radius* of that service | It matches what you know depends on it. |
| **Ship a bad deploy** on another service and investigate | The root cause is the service, and the proposal cites the deploy and its author. |
| **Degrade it** on a leaf service | Fewer services affected; root cause still correct. |
| **Approve** a proposed action | By default (dry-run) nothing outside the graph changes: the action shows as executed with a "[dry-run: …]" note, and the system recovers in the graph. |
| **Restore healthy** | Everything returns to grey; the investigation clears. |

Our result so far: the root cause was correct in every single-fault run we made (the sandbox shop, OpenTelemetry Demo,
ContractAI). **We have not tested two simultaneous independent failures**, and the agent is built for one common cause;
please try it and tell us what it says.

With the bundled sandbox shop the failure is real, not simulated: `python sandbox/run.py up`, connect to
`http://localhost:8200`, and approving a rollback really heals the running shop.

## 6. Privacy and scoping (10 minutes)

| Do | Pass if |
| :--- | :--- |
| Open a site with a login or token in the URL (`?token=abc`) and watch the SentinelGraph server's log or `GET /api/graph` | The query string never appears; only host and path. |
| Check outgoing connections of the app (Little Snitch, `lsof -i`, Wireshark) while browsing | Only the sites you visit, the SentinelGraph address you set, and Ollama if you use it. Nothing else. |
| Settings, **Clear browsing data** | You are signed out everywhere; history and captured traffic are gone. |
| Look in `…/DevBrowser/logs/devbrowser.log` | Start-up, errors and crashes; no page content or credentials. |

## 7. Robustness (15 minutes)

| Do | Pass if |
| :--- | :--- |
| Stop the SentinelGraph server while connected | The panel shows a clear message; browsing is unaffected; reconnecting works. |
| Connect a folder that is not a project | A clear message ("no services found"), not a crash or an empty map that looks like success. |
| Connect a folder with a broken `docker-compose.yml` | A message naming the file and the YAML error. |
| Connect a very large monorepo | It finishes (the scan reads at most 4,000 source files) and the app stays responsive. |
| Open 30 tabs of real sites | The app stays responsive and the memory figure in the status bar stays sensible for a browser. |
| Force-quit the app, relaunch | Your tabs come back. |
| Move the window to another monitor, quit, unplug the monitor, relaunch | The window opens on a visible screen. |

## 8. Pilot with real engineers

The numbers in the [product overview](PRODUCT.md) that matter most are the ones we have **not** measured yet: how
much faster a real engineer finds a root cause with the map than without it. This is how to measure it.

**Who:** 8 to 12 engineers who have been on call for a distributed system, none of whom have seen the product.

**Setup.** Two systems of similar size they do not know (for example OpenTelemetry Demo and Online Boutique, or two
of your own services). For each person: system A with their usual tools (logs, dashboards, a terminal), system B with
DevBrowser. Randomise the order and which system gets which, so neither is always the "easy" one.

**Task.** Break one service with a known fault (a bad deploy, or the sandbox shop's fault switch). Ask the engineer:
*"Something is wrong. Which service is the root cause, what changed, and who owns it?"* Start a stopwatch.

**Record, for each person and system:**

| Metric | How |
| :--- | :--- |
| Time to a correct answer | Seconds from the question to the right service. Stop at 20 minutes. |
| Correct? | Root cause, and the change, and the owner. |
| Confidence (1 to 5) | Asked right after. |
| Usability | The 10-question System Usability Scale after the session. |
| Where they got stuck | Free text, plus anything they said aloud. |

**Report** the median time with and without, the spread, the number of people, and the SUS score. With ten people one
result is a signal, not a proof: say so. **Success for 1.0:** the median time with DevBrowser is lower on the same
class of fault, no one is slower by more than a minute, and the SUS score is at least 68 (the commonly cited average).

## 9. Automated tests

For developers. All pass on the release build.

```bash
cd DevBrowser && npm run typecheck && npm run lint && npm test      # unit tests
cd backend && pytest -q                                              # backend (embedded graph, no cloud account)
python sandbox/run.py up                                             # then, in another terminal:
cd e2e && npx playwright test -c devbrowser.config.ts                # drives the real built app
DEVBROWSER_PACKAGED=/path/to/DevBrowser npx playwright test -c devbrowser.config.ts   # ... or an installed build
```

**Results on the release build (30 October 2026):**

| Suite | Result |
| :--- | :--- |
| App unit tests (`npm test`) | 62 passed, 2 skipped (they need a live server) |
| Server tests (`pytest`, embedded graph) | 111 passed |
| End-to-end, from source | 17 passed |
| End-to-end, against the app installed from the `.dmg` | 17 passed |
| Type check and lint (app, dashboard) | clean |

The end-to-end suite starts the real app and drives it: it browses, opens every panel, connects a project, breaks a service,
investigates it, restores it, and relaunches to check the session comes back.

## 10. Known limits

- The server has no authentication: run it on your own machine only ([Security](SECURITY.md)).
- Unsigned installers; an OS warning on first launch.
- Windows and Linux builds are untested on real hardware at the time of this release.
- Monolith mapping reads TypeScript, JavaScript and Python imports; other languages show as one box.
- One common cause per investigation; two independent simultaneous faults are untested.
- Ownership needs a `CODEOWNERS` file; without it services show no owner.
- The scan reads files the server can read, on the server's own machine. A server in Docker needs the projects folder mounted.

## 11. Reporting a problem

Open an issue with: your operating system and version, the DevBrowser version (shown on the new-tab page), what you did,
what you expected, what happened, and the last lines of the log file (`…/DevBrowser/logs/devbrowser.log`, paths in
[Getting started](GETTING_STARTED.md#where-things-are-stored)). For a wrong map, also say which repository and commit,
and which services or connections were wrong. A screenshot helps. Please do not attach logs from machines with data you
cannot share.
