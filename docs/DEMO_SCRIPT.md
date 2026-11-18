# Demo day script: DevBrowser + SentinelGraph

For a room of founders and investors. **Pitch 4 minutes, live demo 3 minutes, questions after.**
Every number below is sourced or measured; where it is neither, it says so. Do not add numbers on stage that are not
in [PRODUCT.md](PRODUCT.md) or [PROJECT.md](PROJECT.md).

---

## Before you go on stage (10 minutes before)

```bash
./scripts/demo.sh        # clean sample company, DevBrowser opens with SentinelGraph already running
```

- Laptop on power, notifications off, display mirrored, window maximised.
- In the app: open **Overview** once (it should say *All 38 services healthy*), then go back to a **New tab**.
- Wi-Fi is not needed: everything runs on the laptop. That is part of the story.
- Backup: the screenshots in `docs/images/` and a screen recording of one full run, in case the laptop fails.

---

## The pitch (4 minutes)

**1. The moment everyone in the room knows (30 s)**
> "It's 2 a.m. Forty alerts fire across a dozen services. Every one of them is a symptom. The on-call engineer has
> one question: which *one* thing is actually broken, what changed, and who owns it? Today that answer lives in
> five dashboards, a stale diagram and a senior engineer's head."

**2. Why it matters (30 s)**
> "Over 90% of mid-size and large companies say an hour of downtime costs them more than $300,000 (ITIC 2024).
> The median high-impact outage costs $1.9 million an hour (New Relic 2024). Detecting it is solved. *Explaining*
> it is not."

**3. What we built (45 s)**
> "DevBrowser is a browser for people who build software. It's the window a developer already has open all day:
> it browses, it inspects every request, and it carries a live map of their system, read straight from the code.
> No diagrams to draw. When something breaks, one click walks that map to the root cause, names the change
> behind it, and proposes a fix. A person approves it. Nothing runs on its own."

**4. Demo (3 minutes, below)**

**5. Proof (30 s)**
> "On a public benchmark of real injected faults, RCAEval, we name the right root cause 86% of the time on a
> 12-service system and 73% on a 69-service one. A random guess gets 8% and 1.5%. We read seven open-source
> systems we didn't write in under a second each."

Say the limit before they ask: *"Large systems are not solved. On the 69-service system a simple baseline comes close,
and that is our next piece of work."*

**6. Business (30 s)**
> "Free for individual developers: it runs on their laptop, so a free user costs us almost nothing. Teams pay when
> they want one shared map, roles and paging: our working price is $12 per developer per month, a hypothesis we're
> testing with design partners. Bottom-up, like the tools developers already love."

**7. The ask (15 s)**: *fill in before Sunday: amount, what it buys (for example the pilot and the first hires), and
the milestone it reaches.* Do not improvise this line.

---

## The live demo (3 minutes, exact clicks)

| Time | Click | Say |
| :--- | :--- | :--- |
| 0:00 | App is open on a **New tab** | "This is a browser. It browses. The left side is everything else it does." |
| 0:15 | **Overview** | "This is a sample company: 38 services, 102 dependencies, read from code. All healthy." |
| 0:30 | **System map** | "Front-ends at the top, business services, data, platform at the bottom. Bigger circles are what more of the system depends on." |
| 0:50 | Type `inventory-db-proxy` in **Find a service**, then **Ship a bad deploy** | "I'll break production the way it usually breaks: someone ships a config change." |
| 1:05 | Wait for the colours | "Orders and inventory go amber and start alerting. Those teams get paged. Neither of them broke anything. And this incident isn't scripted: the agent has to work it out." |
| 1:20 | **Investigate** | "Now watch the map. Each step is a real query over the graph, and the path lights up as it goes." |
| 1:45 | The result appears on the right (about 8 s) | "Root cause: inventory-db-proxy. It names the change that shipped minutes before the alerts and who shipped it, and says high confidence, with the reason." |
| 2:10 | Point at **Proposed fixes** | "It proposes a rollback, a scale-up, and paging the owner. It can't do any of them. A human decides." |
| 2:25 | **Approve** the rollback | "Approved: rolled back, and the map goes healthy again. The incident is stored in the graph, so the next similar one is recognised straight away." |
| 2:45 | **Overview** | "Back to the overview: what changed, what's critical, what's waiting on a person. That's the product." |

If something misbehaves: **Restore healthy** (top of the System map) resets the map; then start again from 0:50.

---

## Questions you will get

**"Isn't this Datadog / an APM?"** They show each service's health. We keep the *relationships* (who depends on whom,
what changed, who owns it) as a graph and reason over it. We can read their data; we do not replace it.

**"Does it work on real code?"** Yes, and we test it on real code: 20 public repositories of every shape (microservices,
monorepos, Android, Swift, .NET, a Python library, a repo with no code) all map correctly, each in under half a second. It
reads Docker Compose, Kubernetes, the workspaces of npm, Gradle, Cargo, Swift, Maven and .NET, and imports in every common
language. Show it: **Connect codebase…** on any repository on the laptop.

**"What about large companies?"** The graph runs embedded on one machine today, sized for one team's system. A shared
server for a whole organisation, with sign-in and roles, is the paid Team tier and is on the roadmap.

**"Is the AI making things up?"** By default the agent is deterministic: the same graph gives the same answer, with no
language model. Every step is a graph query you can inspect, and every action waits for a person.

**"What haven't you proven?"** How many minutes it saves real engineers on real incidents. Our pilot measures exactly
that; we don't quote a number until it does.
