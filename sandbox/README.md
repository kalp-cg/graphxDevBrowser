# Sandbox: the whole product on a live system, no cloud account

A small but real microservice shop (`shop/`) runs on your machine, sends OpenTelemetry traces to SentinelGraph,
and can be broken and fixed on command. SentinelGraph runs on its embedded graph engine (`GRAPH_BACKEND=local`),
so nothing needs TigerGraph Cloud, an LLM key or Docker.

```bash
cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..
backend/.venv/bin/python sandbox/run.py up          # add --ui for the web dashboard on :3002
```

| What | Where |
| :--- | :--- |
| Storefront (browse it in DevBrowser) | http://localhost:7400 |
| SentinelGraph API | http://localhost:8200 |
| Shop control (faults, rollback) | http://localhost:7499/__control |
| Dashboard (`up --ui`) | http://localhost:3002 |

The ports are separate from the dev stack (8100/3001), so both can run at once. Port 7000 is avoided on purpose:
macOS AirPlay Receiver holds it.

## What `up` does

1. **Adapts to the codebase.** `python -m sentinel.ingest codebase sandbox/shop` reads `docker-compose.yml`,
   `CODEOWNERS` and git: 7 services, 2 datastores, 11 dependencies, 4 owning teams, tiers and revenue from
   compose labels, and 23 addresses (`localhost:7404` is `checkout`). No traffic has flowed yet.
2. Starts the API on the embedded graph, with the `sandbox` action adapter in live mode: approving a rollback
   really rolls back the running shop.
3. Starts the shop with steady customer traffic. Every hop is a span with W3C `traceparent` propagation,
   exported every 2 s as OTLP/JSON to `/v1/traces`, which is what an OpenTelemetry Collector sends.

## Try it

```bash
python sandbox/run.py break inventory     # a bad deploy (v2.4.1 "Reduce orders-db pool size") + 60% failures
python sandbox/run.py status              # traces have turned it into alerts on checkout, gateway, inventory
python sandbox/run.py investigate         # the agent walks the graph: root cause inventory, that deploy
python sandbox/run.py approve rollback    # the shop really rolls back; the next trace windows are healthy
python sandbox/run.py demo payments       # the whole loop for another service, checking every step
```

`break` takes `--no-deploy` (a failure with no change to blame: the agent opens breakers / scales instead of
rolling back) and `--rate`. Breaking the same service twice shows incident memory: the second investigation is
recognised as a repeat.

## With DevBrowser

1. `cd DevBrowser && npm run dev`
2. Settings → Integrations → SentinelGraph: `http://localhost:8200`. The connection is
   saved and restored on the next launch.
3. Browse http://localhost:7400. Captured calls land on the scanned services (`web` → `gateway`), not on
   anonymous hosts. Passive browsing only shapes the graph; it never changes health or fires alerts.
4. `python sandbox/run.py break inventory`, then click **Checkout** in the storefront.
5. In the Network panel, select the failed `POST /api/checkout`: the SentinelGraph card shows the service
   (`gateway`, critical, team platform), its blast radius and recent changes. Click **Investigate this failure**.
6. The investigation streams into the panel. It looks past the gateway the browser saw and names `inventory`
   and the deploy that broke it. **Approve** the rollback; the storefront works again.

## Automated checks

```bash
python sandbox/run.py demo inventory     # 8 checks: baseline, alerts, root cause, rollback proposed, executed,
                                         # shop healthy, stays healthy, incident remembered
cd DevBrowser && SENTINEL_SANDBOX=1 SENTINEL_URL=http://localhost:8200 \
  npx vitest run tests/unit/sandbox-live.test.ts tests/unit/sentinel-live.test.ts
```

CI runs both on every pull request (`.github/workflows/tests.yml`, job `sandbox`).

## The shop

`shop/shoplib.py` is a ~250-line standard-library service framework (routes, trace propagation, OTLP export,
faults). Each service is a short `services/<name>/app.py`; `run_shop.py` runs them all in one process, and
`docker-compose.yml` declares the architecture the codebase scan reads (it has no Dockerfiles; it is not for
`docker compose up`). Faults originate in a service's own database
call (or its handler, if it has no database) and travel up as 5xx, so the error spans are attributed the way
they would be in production.

## Connect your own codebase (or an open-source one)

In DevBrowser: Settings → connect to the API (`http://localhost:8200`), then **Connect codebase…**
(also in the SentinelGraph panel) and pick a repository folder. Services, databases, owners and dependencies appear in
the graph. The API must run on the same machine as the folder; for a remote API use
`python -m sentinel.ingest codebase PATH --push URL`.

What it reads: `docker-compose.yml` (`depends_on`, `links`, service URLs in `environment`), CODEOWNERS, `sentinel.*`
labels and `git log`. Good open-source repos to try, as they ship a compose file with many services:
`open-telemetry/opentelemetry-demo`, `GoogleCloudPlatform/microservices-demo` (Kubernetes manifests only: no compose, so
services come from directories), and `microservices-patterns/ftgo-application`. Real runtime calls come from traces
(`POST /v1/traces`) and from browsing the running app in DevBrowser.

## Demo flow from DevBrowser (healthy, then broken)

SentinelGraph panel → type a service in **Find a service** (or click it) → under **Simulate a failure** choose
**Ship a bad deploy**, **Crash it** or **Degrade it**. On the sandbox this breaks the running shop for real, and the
API waits until the failing traces have become alerts, so **Investigate** finds the incident straight away. Then
approve the proposed fix (the shop really heals) or press **Restore healthy**. Investigating a healthy system
answers "All clear". On a repo scanned without a running system the failure is simulated in the graph only.
