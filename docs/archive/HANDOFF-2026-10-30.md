# SentinelGraph + DevBrowser: product brief and next steps

Handoff for the next agent (Antigravity) and the team (H&H Goa). Read all of it before changing code.

---

## 1. The product (what we pitch)

**One line:** *SentinelGraph finds the root cause of a production incident in under a minute, by walking a live
TigerGraph map of your services, deploys and people, and fixes it with a human's approval.*

**Problem.** When production breaks, on-call engineers face dozens of alerts from many services at once. Most are
symptoms. Finding the one broken dependency and the change that broke it means jumping between dashboards, logs,
deploy history and Slack. That takes 30–90 minutes (MTTR) while the company loses money every minute. Existing tools
(Datadog, PagerDuty, Grafana) show *metrics per service*; they don't reason over *how services connect*.

**Insight.** "Checkout, cart and orders are slow" is a **graph** question: what do all three depend on, which of those
is itself broken with nothing broken below it, and what changed there recently? That is a multi-hop traversal, which
is exactly what TigerGraph is built for.

**Solution, three parts:**
1. **Graph builder:** builds the dependency graph automatically from OpenTelemetry traces, deploy events, git history
   (also inside monoliths) and real browser traffic (DevBrowser). No hand-drawn architecture diagrams.
2. **Incident agent:** an AI agent whose only tools are GSQL queries. It finds the root cause, the deploy, the author,
   the blast radius and similar past incidents, and shows every query as evidence.
3. **Human-approved fixes + memory:** it can only *propose* (rollback, circuit breaker, scale up, page on-call). A human
   approves. Each incident is saved in the graph, so the next similar one is solved faster.

**DevBrowser's role:** the developer-facing entry point. While a developer browses their own app, DevBrowser captures
the API calls and maps them into the same graph. "See what your frontend really depends on, and what breaks if it
fails." This is the free/bottom-up wedge into companies; SentinelGraph is the paid team product.

**Who buys:** engineering teams with 20+ services (SaaS, fintech, e-commerce) that run on-call. Buyer: VP Engineering
or SRE lead. Value: MTTR down, fewer people woken up, change risk visible before deploy.

**Business model (proposal):** DevBrowser free for individual developers → SentinelGraph per-service/month for teams
→ enterprise (SSO, self-hosted TigerGraph, audit).

**What makes it fundable:** a measurable outcome (MTTR), a real data moat (incident memory grows with use), and
TigerGraph doing real work (multi-hop root cause, PageRank and betweenness for criticality) that a SQL or vector
database can't do in one query.

---

## 2. What exists today (verified, 2026-10-30)

| Part | State |
| :--- | :--- |
| `backend/` (Python, FastAPI, MCP) | All on TigerGraph. 12 GSQL agent tools, seeded demo company, scenarios, chaos mode, human approval, incident memory. 81 backend tests pass against TigerGraph Cloud (run in batches; do one full run after committing). |
| `backend/sentinel/ingest/` | OpenTelemetry trace ingest (`POST /v1/traces`), deploy markers (`POST /api/changes`), monolith analysis (Python imports + git), sandbox shaped like the OpenTelemetry Demo, DevBrowser traffic (`POST /api/browser-traffic`). |
| `frontend/` (Next.js) | Live graph, agent trail with GSQL, approve/reject, cost-of-downtime ticker. 11 Playwright e2e tests pass. |
| `DevBrowser/` (Electron, teammate's repo, branch `sentinelgraph-integration`) | Connects to SentinelGraph: live graph in the Dependencies view, GSQL blast radius, real `<webview>`, captured traffic sent to the graph. 33 unit tests + 1 live test pass. **Not committed yet.** |

**Gaps a company or investor will find (fix these first):**
- **Actions don't touch real infrastructure.** "Rollback" only updates the graph; nothing is actually rolled back.
- **The agent runs in "autopilot" (no LLM)** unless `GEMINI_API_KEY` or an OpenAI-compatible key is set in `.env`.
- **The demo company is simulated.** No recording yet of a real system (e.g. the OpenTelemetry Demo) going through it.
- **No authentication at all** (the admin token was removed): anyone who can reach the API can write to the graph, run the agent and approve actions. Add real auth before exposing it beyond localhost.
- **Interpreted GSQL** costs ~1–2 s per query, so an investigation takes ~20–30 s.
- **Mock panels in DevBrowser:** the AI assistant, security findings, hardware stats and API client still show sample
  data in places. The old "TigerGraph & TGCloud" settings card sends the secret as a Bearer token (wrong; remove it
  or point it at SentinelGraph).

---

## 3. Rules for the agent (do not skip)

1. **TigerGraph instance is shared.** Only touch the graphs `Sentinel`, `Sentinel_test`, `Sentinel_e2e`, `Sandbox`,
   `Monolith`. **Never** read or write `Glasshouse` or `Transaction_Fraud`. Never run `CLEAR GRAPH STORE`, `DROP ALL`
   or any global GSQL command. Don't run schema-change jobs while tests run (they lock the instance).
2. **Secrets:** credentials live only in `.env` (gitignored). Never commit them, never print them. The current
   `TG_SECRET` was pasted in a chat: **rotate it in TigerGraph first** and update `.env`.
3. **Commit first:** the TigerGraph migration in this repo and the DevBrowser branch are uncommitted. Commit both
   before starting new work (`git add -A && git commit` in each repo).
4. **Every task ends with tests passing:**
   - Backend: `cd backend && set -a && . ../.env && set +a && .venv/bin/python -m pytest -q` (~15 min; uses `Sentinel_test`)
   - Frontend: `cd frontend && npm run lint && npm run build`
   - E2E: start API with `TG_GRAPH=Sentinel_e2e` + UI, then `cd e2e && npx playwright test`
   - DevBrowser: `cd DevBrowser && npm run typecheck && npm run lint && npm test && npm run build`
   - Live link: API running, then `SENTINEL_URL=http://localhost:8100 npm test` in DevBrowser
5. **Machine:** 16 GB RAM. Don't run TigerGraph or the full OpenTelemetry Demo locally; use TigerGraph Cloud and a
   cloud VM for the demo stack. Ask before starting Docker.
6. **Honesty in the UI and pitch:** never show fake numbers as real. Label sample or demo data clearly.

---

## 4. Plan, in order

### Phase 0: a demo a company would fund (1–2 weeks)

Goal: a 3-minute video on a *real* system, with a real model and a real rollback.

| # | Task | Done when |
| :- | :--- | :--- |
| 0.1 | Commit everything (see rule 3); rotate `TG_SECRET`. | Both repos clean; old secret revoked. |
| 0.2 | **Real LLM:** set `LLM_PROVIDER=gemini` + key (or OpenAI-compatible). Run all 4 scenarios and 6 chaos cases with it; record steps, time and correctness in a table in the README. | ≥ 9/10 correct root causes with the real model; table in README. |
| 0.3 | **Real system:** on a cloud VM (8 GB+), run the [OpenTelemetry Demo](https://github.com/open-telemetry/opentelemetry-demo) with its collector exporting to `/v1/traces` (config in README, "Real systems"). Turn on flags `paymentFailure`, `cartFailure` and `productCatalogFailure`; have flagd changes posted to `/api/changes`. | The agent names the right service for each flag, from real traces. |
| 0.4 | **Real fix (biggest credibility gap):** add an action executor interface in `backend/sentinel/tools/actions.py` with adapters: `kubernetes` (`kubectl rollout undo deployment/<svc>`, for the OTel Demo on k3s) and `github` (re-run the previous release workflow). Keep the human approval. Default to dry-run; the real call only with `ACTIONS_MODE=live`. Log every executed action to the graph (it already records `Action.outcome`). | Approving a rollback in the UI really rolls back the OTel Demo pod, and the error rate drops in the next trace window. |
| 0.5 | **Real alerts:** `POST /api/alerts/alertmanager` (Prometheus Alertmanager webhook) → `Alert` vertices on the matching `Service`. **Real paging:** `PAGER_WEBHOOK_URL` already supports Slack/Discord; add PagerDuty Events v2. | An Alertmanager alert starts an investigation; a page reaches Slack. |
| 0.6 | **Speed:** install the GSQL queries instead of interpreting them (`CREATE QUERY ... INSTALL QUERY`, then `runInstalledQuery`), with interpreted mode kept as fallback. | Each tool < 400 ms on TigerGraph Cloud; full investigation < 10 s. |
| 0.7 | **DevBrowser polish:** auto-connect from saved URL; remove or relabel the remaining mock panels; remove the broken TigerGraph secret card; add a "Investigate this failure" button in DevBrowser that starts a SentinelGraph run (`POST /api/runs`) and shows the report. Get the teammate to review and merge the `sentinelgraph-integration` branch. | A developer goes from a failing page in DevBrowser to a root cause in one click. |
| 0.8 | **Pitch kit:** 10-slide deck (problem, insight, demo, why TigerGraph, market, model, team, ask) + 3-minute demo video on the real OTel Demo. | Deck + video ready. |

### Phase 1: production-grade (what the funding pays for, 1–3 months)

| # | Task |
| :- | :--- |
| 1.1 | **Accounts and tenants:** organizations, users, SSO (OIDC), roles (viewer / responder / approver). One TigerGraph graph per tenant (or a tenant id on every vertex). Replace the single `ADMIN_TOKEN`; keep an API key per ingest source. |
| 1.2 | **Audit log:** who approved what, when, with which evidence; exportable. |
| 1.3 | **Ingest at scale:** queue in front of `/v1/traces` (Kafka or Redis streams), rolling time windows, latency SLOs (p99) in addition to error rate, dedupe, back-pressure. |
| 1.4 | **Integrations:** GitHub (deploys, commits, CODEOWNERS → team ownership), PagerDuty or Opsgenie schedules (real on-call instead of seeded), Slack bot (incident channel, approve from Slack). |
| 1.5 | **Deployment:** Helm chart; hosted SaaS + self-hosted option (customer's own TigerGraph); secrets in a vault; health and metrics of SentinelGraph itself; rate limits. |
| 1.6 | **Data:** retention policies, PII scrubbing in trace attributes, backups of the incident memory. |
| 1.7 | **Monoliths beyond Python:** Java (jdeps), JS/TS (madge) import graphs; runtime `code.namespace` already works for any language. |

### Phase 2: features that grow revenue

- **Change risk before deploy:** a GitHub check on every pull request: "this change touches `payments`; blast radius 14
  services incl. checkout; 2 past incidents started here." This prevents incidents instead of only fixing them, and is
  the strongest selling feature.
- **Auto postmortems:** write the incident report (timeline, root cause, fix, evidence queries) from the graph.
- **Criticality map:** PageRank/betweenness dashboard of single points of failure, for architecture reviews.
- **Similarity across customers (opt-in, anonymized):** "this failure pattern has been seen 40 times".

---

## 5. Numbers to show investors

Measure these on the real OpenTelemetry Demo, and keep the scripts in the repo:

- **Root-cause accuracy** across every fault flag and chaos case (target ≥ 90%).
- **Time to root cause** (target < 60 s) vs a manual baseline (have someone time it by hand).
- **Repeat incident speed-up** from memory (fewer steps and seconds the second time).
- **Time to value:** minutes from "point your OTel collector here" to a useful graph (target < 15 min).

---

## 6. Quick reference

```bash
# backend API (main graph 'Sentinel')
cd backend && set -a && . ../.env && set +a && .venv/bin/uvicorn sentinel.api.main:app --port 8100
# dashboard (dev)
cd frontend && npm run dev -- -p 3001
# DevBrowser
cd DevBrowser && npm run dev        # Settings → Integrations → SentinelGraph: http://localhost:8100 + token
# reseed / scenario / sandbox
cd backend && .venv/bin/python -m sentinel.seed --reset
.venv/bin/python -m sentinel.seed --scenario db-pool-exhaustion
.venv/bin/python -m sentinel.ingest --graph Sandbox sandbox --fault paymentFailure
```

Key files: `backend/sentinel/schema.py` (graph schema), `backend/sentinel/db.py` (TigerGraph connection),
`backend/sentinel/tools/` (GSQL agent tools), `backend/sentinel/ingest/` (graph builders),
`backend/sentinel/api/main.py` (REST API), `DevBrowser/src/main/integrations/sentinel-client.ts` and
`DevBrowser/src/shared/domain/sentinel.ts` (the DevBrowser ↔ SentinelGraph link).
