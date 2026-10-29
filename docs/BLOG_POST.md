# How I Built an AI Incident Commander That Thinks in Graphs

*Built for the Graph Hacks: Context for AI Agents Hackathon (WeMakeDevs × FalkorDB)*

---

At 3 AM, three services break at once: `checkout-api`, `cart-service`, and `orders-service` all start timing out. The on-call engineer gets paged. They open five dashboards, grep through logs, and 45 minutes later—after digging through pull requests—they find it: someone reduced a connection pool size in a shared library that everything depends on.

This is the problem SentinelGraph solves. And it works the problem out in about a minute with a local 8B model (16–24 seconds with the deterministic autopilot, measured), using a graph.

## Why a Graph Database and Not a Vector Search?

The first instinct when building an AI agent for incident response is to throw logs at a vector database and use semantic search to find "similar past incidents." It feels right. But it misses the most important question an engineer actually asks:

> *"What do all three broken services have in common?"*

This isn't a similarity question. It's a **path question**. You need to find the shared downstream dependency—the node that lies on the path from every alerting service to something broken. That's a multi-hop graph traversal, not a cosine similarity.

FalkorDB makes this one Cypher query (`find_common_cause`, straight from `tools/rootcause.py`):

```cypher
UNWIND $services AS name
MATCH p = (s:Service {name: name})-[:DEPENDS_ON*0..5]->(d:Service)
WITH s, d, min(length(p)) AS dist
WITH d, count(s) AS hits, max(dist) AS worst, sum(dist) AS total
WHERE hits = $n
WITH d, worst, total
OPTIONAL MATCH (d)-[:DEPENDS_ON*1..5]->(x:Service) WHERE x.status <> 'healthy'
WITH d, worst, total, count(DISTINCT x) AS unhealthy_below
RETURN d.name AS name, d.uid AS uid, d.status AS status, d.tier AS tier, worst AS max_hops, total AS total_hops,
       unhealthy_below,
       CASE WHEN d.status = 'healthy' THEN 0 WHEN unhealthy_below = 0 THEN 2 ELSE 1 END AS rank,
       CASE d.status WHEN 'down' THEN 1 ELSE 0 END AS is_down
ORDER BY rank DESC, is_down DESC, max_hops, total_hops, name
LIMIT 5
```

Every alerting service walks downstream up to five hops (`*0..5`, so the service itself counts), and only the services that *all* of them reach survive (`hits = $n`). The ranking does the rest: an unhealthy candidate with **nothing unhealthy below it** (rank 2) beats an unhealthy one that is merely explained by a broken dependency (rank 1), which beats a healthy one. That is how it tells the shared root from a symptom.

## The Architecture: Every Decision Is a Graph Query

SentinelGraph is built as a chain of tools exposed over **MCP (Model Context Protocol)**:

```
Browser (Next.js)
    ↕ REST + WebSocket
FastAPI backend
    ↕ MCP (stdio)
MCP Tool Server — 12 graph tools
    ↕ Cypher
FalkorDB (graph: "sentinel")
```

The agent is an MCP client. It discovers the available tools at startup with `list_tools`. It never touches the database directly—it goes through tools that always return a structured result with `{result, cypher, node_uids, edge_uids}`. The UI shows every Cypher query and lights up exactly the nodes and edges the agent touched, in order.

### The Graph Model

Everything lives in one FalkorDB graph called `sentinel`:

- **Services** are nodes with `status` (healthy/degraded/down), `tier`, and `layer`.
- **`DEPENDS_ON`** edges carry a `breaker` property (open/closed) for circuit breaker state.
- **`Deployment → Commit → Person`** tracks who pushed what and when.
- **`Incident → SIMILAR_TO → Incident`** is the memory layer—past postmortems linked to the services they touched.

The direction rule matters: `(checkout-api)-[:DEPENDS_ON]->(inventory-db-proxy)` means checkout *calls* the proxy. Failure flows *against* the arrow. Blast radius is a *reverse* traversal.

## The Investigation Protocol

The agent follows a deterministic protocol through 7 steps:

1. **`get_active_alerts`** — which services are firing?
2. **`find_common_cause`** — multi-hop traversal to find the deepest shared unhealthy dependency.
3. **`recall_similar`** — has the graph seen this pattern before? Resolved incidents that touched these services, or anything within two hops downstream of them.
4. **`recent_changes`** — what was deployed in the last 60 minutes on the suspect service?
5. **`blast_radius`** + **`critical_services`** — how many services are at risk? Uses `algo.pageRank` and `algo.betweenness` from FalkorDB's built-in algorithms.
6. **`propose_action`** — draft a rollback, circuit breaker, or scale-up. Write it to the graph as `(:Action {status:'pending'})`. The agent can't execute anything.
7. **`conclude_investigation`** — write the incident back as memory.

A human clicks **Approve**. Only then does the backend execute the action and trigger graph-traversal-based recovery (callers recover once nothing below them is broken).

## The Killer Feature: Memory That Actually Works

Most agent memory systems store text embeddings and do semantic search. The problem is they match on *language*, not on *structure*.

SentinelGraph stores resolved incidents as nodes in the same FalkorDB graph, linked directly to the services and deployments they involved. When a new incident fires, the `recall_similar` tool (`tools/memory.py`) does this:

```cypher
UNWIND $services AS name
MATCH p = (s:Service {name: name})-[:DEPENDS_ON*0..2]->(n:Service)
WITH n, min(length(p)) AS hops
MATCH (i:Incident {status: 'resolved'})
WHERE (i)-[:AFFECTED|ROOT_CAUSE]->(n) OR (i)-[:ROOT_CAUSE]->(:Deployment)-[:DEPLOYED_TO]->(n)
WITH i, n, hops,
     size([(i)-[:ROOT_CAUSE]->(n) | 1]) + size([(i)-[:ROOT_CAUSE]->(:Deployment)-[:DEPLOYED_TO]->(n) | 1]) AS rc
WITH i, n, hops, CASE WHEN rc > 0 THEN 2.0 ELSE 1.0 END AS weight
WITH i, collect(DISTINCT n.name) AS via, sum(weight / (1 + hops)) AS score
OPTIONAL MATCH (i)-[:ROOT_CAUSE]->(rc)
OPTIONAL MATCH (rc)-[:DEPLOYED_TO]->(rcs:Service)
OPTIONAL MATCH (i)-[:RESOLVED_BY]->(a:Action)
OPTIONAL MATCH (i)-[:FOLLOWED]->(rb:Runbook)
OPTIONAL MATCH (i)-[:SIMILAR_TO]-(other:Incident)
RETURN i.id AS id, i.uid AS uid, i.title AS title, i.severity AS severity, i.summary AS summary,
       i.steps_taken AS steps_taken, rc.uid AS root_cause_uid, coalesce(rcs.name, rc.name) AS root_cause_service,
       collect(DISTINCT a.kind) AS fixes, rb.uid AS runbook_uid, rb.title AS runbook, rb.steps AS runbook_steps,
       collect(DISTINCT other.id) AS similar_to, via, score
ORDER BY score DESC, id DESC
LIMIT 5
```

From each alerting service it walks `DEPENDS_ON` downstream up to two hops, because failures come from below. Any resolved incident that is linked to one of those services scores `weight / (1 + hops)`, where the weight is 2 if the service was the incident's root cause (directly, or through the deployment that caused it) and 1 if it was only affected. The best matches come back with the fixes that worked and the runbook that was followed. `SIMILAR_TO` and `FOLLOWED` links ride along as extra context; they are not what ranks the results.

It finds past incidents that touched the *same part of the graph*, not incidents that *sound* similar. If the root cause service matches the current suspect, the agent recognizes it as a repeat and skips straight to the fix.

**Measured result** (local `qwen3:8b` on a 6 GB laptop GPU): first run of `kafka-rebalance-storm`: **8 steps, 67 seconds**. Second run (with memory): **6 steps, 47 seconds**.

## Algorithms FalkorDB Provided Out of the Box

One of the reasons we chose FalkorDB over rolling our own graph layer is the built-in algorithm suite. We used four directly in production:

| Algorithm | Where |
| :--- | :--- |
| `algo.pageRank` | Node size in the UI; identifies which services are globally most central |
| `algo.betweenness` | Chokepoints tool; finds single points of failure with dashed rings in the UI |
| `algo.SPpaths` | `failure_path` tool; shortest weighted path from an alert to its root cause |
| Variable-length `DEPENDS_ON` | `*0..5` common cause, `*1..6` blast radius, `*0..2` memory recall |

These aren't decorative. When the agent explains why a failure matters, the numbers come from these calls: `critical_services` and `chokepoints` return a service's rank and `out_of` (how many services were ranked), and the report cites them.

## What I Learned

**1. Graph traversal and LLM reasoning are complementary, not competing.**
The LLM is good at deciding *which* tool to call next and how to phrase a report. The graph is good at answering structural questions the LLM cannot reason about from text alone. Separating these cleanly through MCP made both better.

**2. Autopilot as a safety net is essential for live demos.**
Free LLM tiers have rate limits. We built a deterministic `Autopilot` fallback that implements the same investigation protocol without any model. It looks identical in the UI. If Groq hits a limit during the demo, the autopilot takes over mid-run without breaking anything.

**3. "Human in the loop" is a feature, not a limitation.**
Several people who saw the project said: "Why doesn't the agent just fix it automatically?" Because production is where your bad days happen. The approval gate is the point—you get the reasoning and the recommendation, but the action only runs after a human reviews it.

## Try It Live

- **Demo**: [https://graph-hacks-alpha.vercel.app](https://graph-hacks-alpha.vercel.app)
- **GitHub**: [https://github.com/kalp-cg/graph-hacks](https://github.com/kalp-cg/graph-hacks)
- **One-command local run**: `git clone ... && docker compose up`

Click **db-pool-exhaustion**, then **Investigate**, then **Approve**. With the autopilot the investigation takes 16–24 seconds (measured on the live site); a local 8B model takes 46–94 seconds. Then break `kafka-rebalance-storm`, approve, break it again, and watch the memory shortcut kick in (8 steps, then 6). Write actions ask for an admin token the first time you use them.

---

*Built during Graph Hacks: Context for AI Agents (WeMakeDevs × FalkorDB, Oct 15–18, 2026).*
