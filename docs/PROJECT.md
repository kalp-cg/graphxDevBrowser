# SentinelGraph + DevBrowser: what this project is

## One sentence
When something breaks in a system made of many services, tell the on-call engineer **which service is the cause**, with the evidence,
and what to do about it, in minutes instead of an hour of reading dashboards.

## The problem
In a company with tens or hundreds of services, one failing component makes many others alert. The engineer sees fifty alerts and has to
work out which one is the cause. Today that means reading dashboards, traces and chat history, and knowing who owns what.

## What the product should be
A system that, for a mid-size or large engineering organisation:

1. **Knows the system.** Builds and keeps current a map of services, databases, calls, owners, deploys and past incidents, from sources
   already there: code and manifests, OpenTelemetry traces, Prometheus metrics and alerts, git history.
2. **Notices trouble without being told what to look for.** Errors, slowness against the service's own normal, resource anomalies.
3. **Names the cause.** Walks the map from the symptoms to the deepest failing service, ranks competing causes by evidence, says how
   confident it is, and says when there are several independent failures.
4. **Explains and acts safely.** Shows the path and the evidence, finds the recent change and its author, pages the right team, proposes a
   fix, and runs it only after a human approves.
5. **Learns.** Past incidents are remembered and recalled.
6. **Works before the incident.** Shows what a change could break before merge.
7. **Is honest.** Never shows invented data, never presents a fallback as the chosen model's work, and says where it is unsure.

## What exists today

| Part | State |
|---|---|
| **Map from code**: compose, Kubernetes, monolith modules, owners, git changes | Works; tested on real open-source repositories |
| **Map and health from traces** (OTLP): calls, error rate, latency against a learned normal | Works |
| **Health from metrics** (`POST /api/metrics`): any series that leaves its own normal | Works |
| **Alerts** from Alertmanager | Works |
| **Root cause**: deepest failing service, independent failures, loops between services, strongest evidence first, confidence | Works; see accuracy below |
| **Agent**: built-in deterministic investigator, or a language model (Ollama, Gemini, OpenAI-compatible), with honest fallback | Works; 12 of 12 on the sandbox exam for both |
| **Safe actions** with human approval, dry-run by default | Works in dry-run; real adapters (Kubernetes, GitHub, PagerDuty) are not proven against live systems |
| **Pre-merge impact** from git changes | Works; CI template included |
| **DevBrowser** (Electron): browser, API client, network, security, graph as a page, sandbox exam | Works; 26 end-to-end tests |

## How accurate, measured on real data
RCAEval is a public benchmark of real injected faults with the true root cause labelled (`docs/TESTING.md` section 9c).

| System | Services | Cases | Right cause first | In top 3 |
|---|---|---|---|---|
| Online Boutique | about 12 | 90 | 93% | 94% |
| Train Ticket | about 69 | see `CHANGELOG.md` | see `CHANGELOG.md` | see `CHANGELOG.md` |

Before the latency and metrics detectors were added, the product found 0 of 90, because it only noticed faults that raised errors. That
is why the detectors exist.

## What it is not yet
- Not proven in a production environment of any company. All accuracy numbers are from replayed recordings of test systems.
- Single fault at a time in the benchmark. The agent handles several independent failures, but that is tested on synthetic cases only.
- No multi-user accounts, shared maps or access control. One engineer, one machine, one graph.
- The local graph engine is a JSON file; a large organisation needs TigerGraph (supported) and a service that stays up.
- Installers are not code-signed.
- Metrics arrive as JSON you send; there is no built-in Prometheus puller yet.

## The path to big and mid-size companies
1. Accuracy at scale (hundreds of services): measured on Train Ticket; ranking and false-positive control are the work.
2. Always-on service: run the API as a deployment with TigerGraph, fed by the OpenTelemetry Collector and Alertmanager.
3. Team features: shared map, ownership, roles, audit log of approved actions.
4. A pilot with a real team, comparing time-to-root-cause against how they work today.
