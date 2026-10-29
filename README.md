# 🛡️ graphxDevBrowser

> **Autonomous Graph-Native Incident Remediation & Developer Telemetry Platform powered by TigerGraph**

**graphxDevBrowser** bridges client-side developer runtime inspection (**DevBrowser**) with deep, graph-native distributed systems observability and autonomous incident remediation (**SentinelGraph** on TigerGraph).

When production breaks, graphxDevBrowser walks live dependency paths in **TigerGraph GSQL**, isolates the exact root cause in seconds, proposes safe remediation, executes real rollbacks (Kubernetes or GitHub Actions) with human approval, and permanently saves incident memory.

---

## ⚡ The 30-Second Tour

```mermaid
flowchart TD
  subgraph ClientSide["Client-Side Runtime (DevBrowser)"]
    D1[Developer browses web app] --> D2[CDP captures HTTP/API traffic]
    D2 --> D3["POST /api/browser-traffic"]
    D4["1-Click: 'Investigate this failure'"] --> D5["POST /api/runs"]
  end

  subgraph GraphEngine["Graph Ingestion & Topology (TigerGraph)"]
    D3 --> TG[(TigerGraph: graph 'Sentinel')]
    OTEL[OpenTelemetry Traces /v1/traces] --> TG
    ALERTS[Alertmanager Webhook /api/alerts/alertmanager] --> TG
    MONO[Monolith AST Imports + Git Churn] --> TG
  end

  subgraph AutonomousAgent["Autonomous Investigation (MCP + GSQL)"]
    D5 --> AGENT[SentinelGraph AI Agent]
    AGENT -->|Multi-source BFS| GSQL1[find_common_cause]
    AGENT -->|Reverse BFS| GSQL2[deepest_failure]
    AGENT -->|Commit & author walk| GSQL3[recent_changes]
    AGENT -->|Brandes Betweenness| GSQL4[blast_radius]
    GSQL1 & GSQL2 & GSQL3 & GSQL4 <--> TG
  end

  subgraph HumanInTheLoop["Safe Remediation & Memory"]
    AGENT -->|propose_action| PROP[Pending Action in UI]
    PROP -->|Human clicks APPROVE| EXEC[Action Executor Engine]
    EXEC -->|ACTIONS_MODE=live| K8S[kubectl rollout undo deployment]
    EXEC -->|ACTIONS_MODE=live| GH[GitHub Actions Re-Run Workflow]
    EXEC -->|PagerDuty v2| PD[PagerDuty / Slack on-call page]
    EXEC -->|Resolve & learn| MEM[Save Incident & Fix to TigerGraph]
  end
```

1. **Traffic & Dependency Capture**: DevBrowser intercepts all browser network requests over Chrome DevTools Protocol (CDP) and batches them to TigerGraph. Every frontend endpoint automatically maps to its backend services, databases, and third-party dependencies.
2. **Alert Fires**: When a bad deploy lands (or simulated chaos strikes), alerts fire on upstream services (`checkout-api`, `cart-service`, `orders-service`).
3. **Autonomous Agent Traversal**: The SentinelGraph agent executes GSQL tools over TigerGraph via MCP. In under a minute, it traverses multi-hop paths to locate the single shared broken dependency, identifies the recent commit and its author, and computes blast radius.
4. **Human-in-the-Loop Safe Execution**: The agent cannot mutate infrastructure directly. It proposes an action (`rollback`, `open_breaker`, `scale_up`, `page_oncall`). A human approves with one click.
5. **Real Infrastructure Remediation**: The backend action adapter executes the fix via `KubernetesExecutor` (`kubectl rollout undo`) or `GitHubExecutor` (workflow dispatch), notifies on-call responders via PagerDuty v2, and marks the incident resolved.
6. **Incident Memory**: The incident, its root cause, and the fix are committed back to the TigerGraph graph. On future similar incidents, graph traversal recalls the fix immediately.

---

## 💡 Why a Graph?

Traditional APM dashboards (Datadog, Grafana, PagerDuty) view metrics per service. When 5 services alert simultaneously, finding which one is the culprit requires jumping across dashboards, traces, git logs, and Slack channels—taking 30 to 90 minutes.

"Checkout, cart, and orders are all failing" is not a text search problem; it is a **graph path traversal problem**:

| The On-Call Engineer's Question | How graphxDevBrowser Answers It in TigerGraph (GSQL) |
| :--- | :--- |
| **What do all alerting services depend on?** | Multi-source BFS down `DEPENDS_ON` (≤ 5 hops) from every alerting service, tracking hop counts in a `MapAccum`. Candidates are nodes reached by all sources. |
| **Which shared dependency caused the failure?** | Reverse BFS up `reverse_DEPENDS_ON` from all unhealthy services: ranks unhealthy candidates that have **nothing unhealthy beneath them** (the deepest failure). |
| **What changed there, and who authored it?** | Multi-hop pattern: `Service <-DEPLOYED_TO- Deployment -CONTAINS-> Commit -AUTHORED_BY-> Person -MEMBER_OF-> Team`. |
| **Who is on-call right now?** | Multi-hop traversal: `Service <-OWNS- Team <-ON_CALL {from_ms, to_ms}- Person`. |
| **What is the blast radius and impact?** | Reverse BFS reachability + GSQL PageRank + Brandes Betweenness Centrality. |
| **Have we seen this failure pattern before?** | Traversal of past `Incident` vertices within 2 hops downstream of affected services, weighted by proximity. |

---

## 🏛️ System Architecture

```mermaid
flowchart LR
  subgraph DevClient["DevBrowser (Electron + React + CDP)"]
    WV[Embedded Webview]
    CDP[CDP Traffic Interceptor]
    DEP[Live Dependency Graph]
    INV["'Investigate Failure' Button"]
    VAULT[Encrypted Token Vault]
    WV --> CDP --> DEP
    INV -->|Trigger Run| API
  end

  subgraph NextUI["Web Dashboard (Next.js 16)"]
    CANVAS[3D Topology Canvas]
    TRAIL[Agent Trail + GSQL Inspector]
    ACTIONS[Approve / Reject Action Panel]
    TICKER[Cost-of-Downtime Ticker]
  end

  subgraph BackendAPI["Control Plane (FastAPI + Python 3.12)"]
    REST[REST Endpoints]
    WS[WebSocket Hub]
    AUTH[Admin Token / Bearer Auth]
    INGEST[Ingest Pipeline: OTel, Alerts, Traffic]
    ACTION_ENG[Action Execution Engine]
  end

  subgraph MCPServer["MCP Tool Server (stdio)"]
    TOOLS[12 GSQL Graph Tools<br/>Installed & Interpreted]
  end

  subgraph Storage["TigerGraph Enterprise / Cloud"]
    GRAPH[(Graph: Sentinel<br/>Services, Teams, Commits, Alerts, Incidents)]
  end

  subgraph Remediation["Real-World Execution Adapters"]
    K8S_ADAPTER[Kubernetes: kubectl rollout undo]
    GH_ADAPTER[GitHub Actions: workflow dispatch]
    PD_ADAPTER[PagerDuty Events API v2]
  end

  CDP -->|POST /api/browser-traffic| INGEST
  NextUI <-->|REST + WebSocket| BackendAPI
  BackendAPI <-->|list_tools / call_tool| MCPServer
  MCPServer <-->|GSQL REST++ / Installed| GRAPH
  ACTION_ENG --> K8S_ADAPTER
  ACTION_ENG --> GH_ADAPTER
  ACTION_ENG --> PD_ADAPTER
```

---

## 🧩 Graph Data Model

The schema is defined in [`backend/sentinel/schema.py`](backend/sentinel/schema.py) and operates within its own dedicated TigerGraph graph (`Sentinel`, `Sentinel_test`, `Sandbox`, etc.).

```mermaid
graph LR
  Team -- OWNS --> Service
  Team -- OWNS --> Database
  Person -- MEMBER_OF --> Team
  Person -- "ON_CALL {from_ms,to_ms}" --> Team
  Service -- "DEPENDS_ON {breaker}" --> Service
  Service -- READS_FROM / WRITES_TO --> Database
  Deployment -- DEPLOYED_TO --> Service
  Deployment -- CONTAINS --> Commit
  Commit -- AUTHORED_BY --> Person
  Alert -- FIRED_ON --> Service
  Incident -- TRIGGERED_BY --> Alert
  Incident -- AFFECTED --> Service
  Incident -- ROOT_CAUSE --> Deployment
  Incident -- RESOLVED_BY --> Action
  Incident -- SIMILAR_TO --> Incident
  Incident -- FOLLOWED --> Runbook
  Incident -- PAGED --> Page
  Runbook -- APPLIES_TO --> Service
  Action -- TARGETS --> Service
  Page -- NOTIFIED --> Person
```

### Vertex Types
- **`Service`**: `name`, `kind` (`service` \| `module`), `tier` (`critical` \| `high` \| `medium` \| `low`), `status` (`healthy` \| `degraded` \| `down`), `layer`
- **`Deployment` & `Commit`**: `version`, `at`, `status` (`live` \| `rolled_back`), `sha`, `message`, `files`
- **`Team` & `Person`**: `name`, `slack_channel`, `role`, `handle`, `on_call` time windows
- **`Alert`**: `metric`, `value`, `threshold`, `status` (`firing` \| `resolved`)
- **`Incident`**: `title`, `status` (`investigating` \| `mitigating` \| `resolved`), `summary`, `steps_taken`, `learned`
- **`Action`**: `kind` (`rollback` \| `open_breaker` \| `scale_up` \| `page_oncall`), `status` (`pending` \| `executed` \| `rejected`), `target_name`, `reason`, `risk`
- **`Runbook` & `Page`**: `title`, `steps`, `message`, `channel`

---

## 🛠️ The 12 GSQL Agent Tools

The autonomous agent interacts with TigerGraph purely through the Model Context Protocol (MCP) using 12 GSQL tools:

1. **`get_active_alerts`**: Retrieves all currently firing alerts across the topology.
2. **`find_common_cause`**: Multi-source BFS up to 5 hops finding services reachable from all alerting nodes.
3. **`deepest_failure`**: Reverse BFS identifying unhealthy nodes that have no unhealthy downstream callers (the root cause).
4. **`recent_changes`**: Traverses `Service <-DEPLOYED_TO- Deployment -CONTAINS-> Commit -AUTHORED_BY-> Person` within a time window.
5. **`blast_radius`**: Reverse BFS determining the upstream cascade and calculating total revenue-at-risk.
6. **`service_context`**: Comprehensive vertex inspection: owner team, on-call engineer, database dependencies, open circuit breakers.
7. **`recall_similar`**: Weighted graph traversal over historical `Incident` vertices and their resolutions.
8. **`critical_services`**: PageRank analysis identifying top topological bottlenecks in the network.
9. **`chokepoints`**: Brandes Betweenness Centrality identifying critical bridges.
10. **`propose_action`**: Creates a pending `Action` node (rollback, circuit breaker, scale up, page). Does not execute until human approval.
11. **`page_oncall`**: Formats and triggers paging notification to the on-call person.
12. **`conclude_investigation`**: Finalizes findings, generates structured postmortem, and commits learned patterns to graph memory.

---

## 🖥️ DevBrowser: Developer Client

DevBrowser (`DevBrowser/`) is an Electron desktop runtime that brings TigerGraph's graph intelligence straight into the developer's daily workflow:

- **CDP Network Interceptor**: Captures all HTTP requests, status codes, and timings directly from Chrome DevTools Protocol.
- **Automatic Graph Mapping**: Streams captured endpoints to `/api/browser-traffic`, dynamically linking `web:<host>` dependencies to backend services in TigerGraph.
- **Interactive Dependencies View**: Visualizes upstream/downstream blast radius using TigerGraph graph algorithms directly inside the browser.
- **1-Click Incident Investigation**: When an API returns 5xx or fails, click **"Investigate this failure"** to trigger an autonomous SentinelGraph investigation and view live root-cause analysis.
- **Encrypted Credential Vault**: Secures API tokens and environment variables locally using OS-level encrypted vaults (`safeStorage`).

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v20 or v22 LTS
- **Python**: v3.12+
- **TigerGraph**: TigerGraph Cloud instance (or local TigerGraph 4.x)

### 1. Environment Setup
Copy the example environment file and configure your TigerGraph credentials:

```bash
cp .env.example .env
```

Key variables in `.env`:
```ini
TG_HOST=https://your-instance.i.tgcloud.io
TG_GRAPH=Sentinel
TG_SECRET=your-tigergraph-secret
ADMIN_TOKEN=dev-admin-token
ACTIONS_MODE=dry-run   # change to 'live' for real Kubernetes/GitHub execution
ACTION_ADAPTER=auto    # 'kubernetes', 'github', or 'auto'
LLM_PROVIDER=gemini    # 'gemini', 'openai', or 'autopilot'
GEMINI_API_KEY=your-api-key
```

### 2. Backend API & MCP Server
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Seed the TigerGraph graph (seed 42 demo company)
python -m sentinel.seed --reset

# Run FastAPI backend
uvicorn sentinel.api.main:app --port 8100 --reload
```

### 3. Frontend Web Dashboard
```bash
cd frontend
npm install
npm run dev -- -p 3001
```
Open [http://localhost:3001](http://localhost:3001) to view the live 3D dependency topology and agent trail.

### 4. DevBrowser Desktop App
```bash
cd DevBrowser
npm install
npm run dev
```
In DevBrowser, navigate to **Settings → Integrations → SentinelGraph**, enter `http://localhost:8100` and your `ADMIN_TOKEN`, then click **Test & Save**.

---

## 🔄 Ingestion & Webhooks

### 1. Prometheus Alertmanager
Configure your Prometheus Alertmanager to send webhooks directly to SentinelGraph:
```yaml
receivers:
  - name: 'sentinelgraph'
    webhook_configs:
      - url: 'http://<sentinel-host>:8100/api/alerts/alertmanager'
        send_resolved: true
        http_config:
          bearer_token: '<ADMIN_TOKEN>'
```

### 2. OpenTelemetry Traces
Point OpenTelemetry Collector to graphxDevBrowser:
```yaml
exporters:
  otlphttp/sentinel:
    traces_endpoint: http://<sentinel-host>:8100/v1/traces
    encoding: json
    headers:
      Authorization: "Bearer <ADMIN_TOKEN>"
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp/sentinel]
```

### 3. CI/CD Deployment Markers
Record deploys from GitHub Actions, GitLab CI, or Jenkins:
```bash
curl -X POST http://localhost:8100/api/changes \
  -H "Authorization: Bearer dev-admin-token" \
  -H "Content-Type: application/json" \
  -d '{
    "service": "inventory-db-proxy",
    "version": "v4.2.1",
    "author": "Alice Developer",
    "sha": "9be56d0",
    "message": "Scale connection pool to 50"
  }'
```

---

## 🧪 Testing

### Backend Unit & Integration Tests (pytest against TigerGraph)
```bash
cd backend
source .venv/bin/activate
python -m pytest tests/test_db.py tests/test_actions.py tests/test_api.py -v
```

### DevBrowser Unit & Integration Tests (vitest)
```bash
cd DevBrowser
npm run typecheck
npm run lint
npm test
```

### Full Stack End-to-End Tests (Playwright)
```bash
cd e2e
npm install
npx playwright install chromium
ADMIN_TOKEN=dev-admin-token npx playwright test
```

---

## 📁 Repository Structure

```
graphxDevBrowser/
├── backend/                  # Python 3.12 FastAPI backend & MCP server
│   ├── sentinel/
│   │   ├── schema.py         # TigerGraph schema definition & reverse edges
│   │   ├── db.py             # Connection pooling, token auth, GSQL execution
│   │   ├── config.py         # Configuration & environment variables
│   │   ├── mcp_server.py     # 12 GSQL tools exposed via Model Context Protocol
│   │   ├── tools/            # GSQL traversal algorithms, actions, health, memory
│   │   ├── ingest/           # OpenTelemetry, Alertmanager, Monolith, DevBrowser traffic
│   │   ├── seed/             # Topology generator, historical commits, chaos scenarios
│   │   ├── agent/            # Autonomous LLM loop, prompts, autopilot mode
│   │   └── api/              # FastAPI REST endpoints & WebSocket hub
│   └── tests/                # Test suites against live TigerGraph
├── frontend/                 # Next.js 16 Web Dashboard
│   ├── src/                  # Topology Canvas, Agent Trail, Action Controls
│   └── public/               # Static assets & icons
├── DevBrowser/               # Electron Developer Browser
│   ├── src/main/             # CDP network interceptor, IPC bridge, encrypted vault
│   ├── src/preload/          # Safe API bridge for renderer
│   ├── src/renderer/         # React UI, Dependency View, Traffic Inspector
│   └── tests/                # Vitest unit & integration test suites
├── e2e/                      # Playwright End-to-End test suites
├── docs/                     # Architecture diagrams, demo scripts, blog posts
├── docker-compose.yml        # Multi-container orchestration
└── render.yaml               # Cloud deployment blueprint
```

---

## 📄 License

MIT © 2026 graphxDevBrowser contributors.
