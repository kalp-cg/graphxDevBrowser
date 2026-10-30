# What to do next, and how to show it to the judges

Read this top to bottom. Part 1 is the order of work. Part 2 is the demo. Part 3 is what to say when the judges push back.

## Where we honestly are

| Question | Answer |
|---|---|
| Is it a real, working product? | Yes for a developer on one machine: a browser, an API client, a network and security view, and a live service map that finds root causes. It is not yet something a company's whole team can adopt. |
| Is the root-cause logic proven? | On real public benchmark data: **86%** right on a small system (Online Boutique, 90 cases), **73%** on a 69-service system (Train Ticket, 60 cases). Random guessing gets 8% and 1.5%. Not yet proven on a company's own incidents. |
| Does it work on any codebase? | It maps any codebase (Swift, Kotlin, Go, Rust, JS, Python, ...). For a single app it maps the modules inside it. For microservices it maps services and their calls. |
| Honest score | **Demo / hackathon: 8 of 10.** Real production product: **5 to 6 of 10.** The gap is proof on real systems and team features, not polish. |

## Part 1. The order of work

Do these in order. Each one makes the next one more valuable.

### Done in this round
1. Faults that raise no errors (slow, starved services) are now detected from latency and metrics. Before, the product found 0 of 90 real faults.
2. Any codebase can be opened (BitChat, a Swift app, was refused before).
3. Browser: tabs now scroll and keep the active tab in view, can be pinned, dragged to reorder, right-clicked (reload, duplicate, pin, close others, close to the right, reopen), and a tab shows a red warning when its dev server dies.
4. **Dev server watch.** When a local server stops answering, the tab says so, you get a notification, and SentinelGraph gets an alert on that service. When it comes back the tab reloads and the alert clears. Tested end to end by killing a real server under a tab.
5. Resolved alerts now clear the service (a recovered server stayed "degraded" before).
6. **Run panel**: start your project from DevBrowser; the page opens by itself; a crash is explained in plain words (taken port and who holds
   it, missing module, missing env var, database down, compile error); SentinelGraph is told. This was Step 1 below.
7. **Console panel** and **"Running on your machine"** on the start page.

### Next, in this order

**Step 1 (done: the Run panel). Catch build crashes, not only server crashes.**
Today we notice a server that stops answering. We do not yet notice `npm run dev` exiting with an error, or a build failing. Add a small "Run" panel in DevBrowser: you start your dev command in it, we keep the process, and when it exits non-zero or prints a stack trace we raise the same alert on the service that owns that folder. This is the feature that makes DevBrowser "the one place a developer works". Effort: about two days. Do this first: it is what judges will remember.

**Step 2. Fix the big-system ranking.**
On Train Ticket, memory faults (50% in the top 3) and packet loss (56%) are often missed, and the graph adds little over a plain anomaly ranking. Use the traces to see which service's calls fail first, and use logs (we do not read them yet). Re-run `backend/benchmark/rcaeval.py` on all 90 Train Ticket cases and publish the number, good or bad.

**Step 3. Feed it real data without a script.**
Add a Prometheus puller (today metrics arrive as JSON you send) and a one-command OpenTelemetry Collector setup. Then try it on the OpenTelemetry Demo with its built-in fault flags and report the result.

**Step 4. One real user.**
Give it to one real developer or team for a week on a real project. Write down every confusion. This is worth more than any other step for the score.

**Step 5. Team and company features.**
Accounts, a shared service map, ownership, an audit log of approved actions. Only worth building after Steps 1 to 4 show people want it.

**Step 6. Ship it properly.**
Code-signed installers, auto-update, crash reporting.

## Part 2. The demo (8 minutes)

Before you start: run `scripts/start-demo.sh`, open the app, check the status bar says "SentinelGraph connected". Have `npm run dev` of any small app ready on a port, and have the BitChat folder ready. Do the whole demo once beforehand.

| Time | Show | Say |
|---|---|---|
| 0:00 | The problem in one slide | "In a company with 100 services, one failure triggers 50 alerts. Finding the cause takes an hour." |
| 0:45 | **Open BitChat** (a repo it has never seen) with Connect codebase | "Any language. No config. This is a Swift app, and it mapped 25 modules and their dependencies in under a second." |
| 1:45 | Browse normally: tabs, pin, drag, right-click, split view, device mode | "It is a real browser. A developer does not leave it." |
| 2:45 | **Run your project from the Run panel**, then kill it | "The tab turns red, the developer is told, and the service map already shows it. Restart the server and it recovers by itself." |
| 4:00 | Sandbox test: load the 38-service company, press **Break** on a database | "Fifty services, one broken database. The graph walks from the symptoms to the cause." Press Investigate. |
| 5:15 | Sandbox exam: 12 cases, built-in agent and a local model | "It finds what we broke in 12 of 12 cases, with a local model too. We then tested it on real data." |
| 6:15 | **The real-data slide** (see Part 3): 86% and 73% | "This is a public benchmark of real injected faults, not our own data. Random is 8%. It started at 0% and we fixed it." |
| 7:15 | The limits slide | "What we have not proven yet, and what is next." |
| 7:45 | Close | "One environment for the developer, and the map that tells them what broke." |

Rules for the demo:
- Show the real-data result and the exam together. The exam is ours; the benchmark is not.
- Say the 0% story out loud. Judges trust a team that tested on real data, found it failing, and fixed it.
- Do not run anything for the first time live. Rehearse each step.
- Have screenshots of each step ready in case the app misbehaves (`DEVBROWSER_SHOTS=/tmp/shots` produces them from the test suite).

## Part 3. Questions the judges will ask, and the honest answers

**"How is this different from Datadog or Grafana?"** Those show you dashboards and fire alerts. This starts from the alerts and walks the dependency graph to name the cause, and it lives in the tool the developer already has open while building, before anything is in production.

**"Is 86% good?"** On the benchmark's small system a random guess gets 8% and a plain "biggest anomaly" ranking gets 22%, so it is a large improvement. On the 69-service system it is 73% and the simple baseline is close, so we say plainly that big systems are not solved. That is Step 2.

**"Did you test on your own data?"** We tested on both, and we label which is which. The 12-case exam is ours. The 86% and 73% are from a public benchmark we did not make, scored against its labels.

**"Does it work in a real company?"** Not proven. Every number is from recorded test systems. Step 4 is to change that.

**"What about security and privacy?"** Everything runs locally. The map and alerts stay on your machine or your own TigerGraph. Fixes are never run without a human approving them, and they are dry-run by default.

**"Why a browser?"** The developer already has a browser open while building. It sees every request the app makes and knows the moment a local server dies, which a dashboard cannot.

## What not to claim
- Do not say it works on production systems.
- Do not quote the earlier 93%. The honest number is 86%.
- Do not say it reads logs. It does not yet.
- It catches crashes of anything you start from the Run panel (servers, builds, tests) and dev servers that stop. It does not see a build you ran in a separate terminal.
- The installers are not code-signed, so the first launch needs "Open anyway" in macOS settings.
