# DevBrowser and SentinelGraph: the product, the problem, the market

A plain-language overview for founders, investors, customers and new colleagues. No code in it.

**How to read the numbers.** Every figure here is one of three kinds, and says which:

- **Sourced**: from a named public source, linked in [Sources](#sources), with the caveat that source carries.
- **Measured**: something we ran ourselves, with how.
- **Assumption**: our own planning number, written as such, that has not been validated. Where a calculation uses an
  assumption, the formula is shown so you can change it.

We do not state a number we cannot back. Where a number we would like does not exist yet (for example, how many
minutes real engineers save), we say so and describe [how we will get it](#what-we-have-not-proven-yet).

---

## 1. What it is, in one minute

Modern software is not one program; it is dozens of small services that call each other. When something breaks,
the people on call see a wall of alerts from many services at once. Almost all of those alerts are *symptoms*. The
real question is: **which one thing is actually broken, what changed there, and who owns it?** Answering it today
means jumping between dashboards, logs, deployment history and chat.

**SentinelGraph** keeps a map of how a system's parts depend on each other, and reasons over that map. Give it the
alerts and it finds the one shared dependency that explains them, names the change that likely caused it, says who
owns it and who is on call, shows what else will break, and proposes a fix. A person approves or rejects it.

**DevBrowser** is the way developers meet it: a desktop browser for people who build software. It does what a browser
does, shows a developer the network traffic and security findings of the site they are on, and adds the map. Point it
at a code repository and the map appears, with no diagrams to draw and nothing to install in production.

In short: *find the cause of an outage in seconds, from a tool a developer already has open.*

## 2. The problem, with numbers

**Outages are expensive, and the bill is large for most companies.**

- More than **90%** of mid-size and large enterprises say one hour of downtime costs them **over $300,000**. This is
  from a 2024 survey of more than 1,000 firms; the figure excludes legal costs and penalties. *(Sourced: ITIC 2024.)*
- Across 1,700 technology professionals in 16 countries, the **median cost of a high-business-impact outage was
  $1.9 million per hour**, and the median respondent lost **77 hours a year** to such outages. *(Sourced: New Relic,
  2024 Observability Forecast. This is a vendor-run survey; treat it as indicative, not audited.)*
- In financial services and insurance the median time to *detect* such an outage was 42 minutes and the median time
  to *resolve* it 58 minutes. *(Sourced: New Relic, 2025 report, one sector only.)*

**Systems are getting harder to reason about.** One survey found 74% of respondent organisations use a
microservices architecture *(Sourced: Gartner Peer Community; the survey year is not stated on the page, so treat
it as indicative)*. And the pendulum is swinging back in places: a CNCF survey summary reports **42%** of the
organisations that adopted microservices are now consolidating services into larger deployable units *(Sourced:
secondary summary of the CNCF survey, fieldwork autumn 2024)*. Both worlds need a map: a web of services, or a
monolith with a lot inside it. We handle both.

**The time to diagnose is the part tools help with least.** Dashboards show each service on its own; the relationships
between services live in people's heads, in out-of-date diagrams, or across five tools. We have not found a trustworthy
public figure for "average minutes spent finding the cause of an incident", so we do not quote one. Our pilot
([below](#what-we-have-not-proven-yet)) measures it directly.

## 3. Who it is for

| | Who | Why they care |
| :--- | :--- | :--- |
| **Start here** | An individual developer or a small team shipping a few services | Free, local, nothing to install in production. It is the browser they open all day. |
| **Grow into** | An engineering team with an on-call rotation (20+ services is where the pain is sharp) | One shared map, owners and on-call in one place, root cause in seconds, every fix approved by a person. |
| **Later** | Larger organisations, regulated industries | The data never leaves their network; roles, single sign-on and audit are on the roadmap. |

**Buyer** at team size: an engineering manager or SRE lead. **User**: every developer on the team. This is
bottom-up adoption: individuals use the free product first, and teams pay when they want sharing and control.

## 4. How it works for a customer

| Step | What happens | Effort |
| :--- | :--- | :--- |
| 1 | Install DevBrowser. | One download, one drag. |
| 2 | Start SentinelGraph on your own machine. | One command. |
| 3 | Pick a code repository. | One click; the scan takes **0.4 to 1.0 s** (*measured*, seven repositories). |
| 4 | See the map: services, databases, outside APIs, connections, owners, recent changes. | Nothing to draw. |
| 5 | When something breaks, press **Investigate**. | One click. |
| 6 | Read the root cause, the change and the owner; approve or reject the proposed fix. | A person decides. |

It reads what the repository already says: Docker Compose and Kubernetes files, source-code imports,
`CODEOWNERS`, and the git history. Later, real traffic from OpenTelemetry and from the developer's own browsing makes
the map exact.

## 5. What we have measured

Everything below was run on the release build, on one Apple-silicon Mac, unless stated.

**Reading real, public systems.** We pointed the scanner at six open-source systems we did not write, plus ContractAI (a
monolith written by the team). Per repository: what it found, and how long it took.

| System | Kind | Services | Databases | Connections | Scan |
| :--- | :--- | ---: | ---: | ---: | ---: |
| OpenTelemetry Demo | Docker Compose, 8 languages | 14 | 2 | 20 | 0.6 s |
| GCP Online Boutique | Kubernetes | 11 | 1 | 16 | 1.0 s |
| Spring PetClinic (microservices) | Docker Compose, Java | 8 | 0 | 13 | 0.5 s |
| FTGO | Docker Compose, Java | 9 | 4 | 34 | 0.4 s |
| Example voting app | Docker Compose | 4 | 2 | 5 | 0.4 s |
| Sock Shop | Docker Compose | 9 | 5 | 1 | 0.4 s |
| ContractAI | A Next.js monolith | 19 modules | 1 | 52 | 0.4 s |

Median across the seven: **0.4 s**; slowest **1.0 s**. The numbers are the *shape* of the system as the repository
declares it. We checked service names and a sample of connections by hand against each project's own documentation;
we have **not** yet measured precision and recall across a large set of systems.

**Finding a cause.** We injected a fault into one service of three different systems (the sample shop, OpenTelemetry
Demo, and ContractAI) and pressed Investigate. The agent named the right service as the root cause every time, in
**3 to 4 seconds** with the built-in deterministic agent; the hosted demo with a language model took 16 to 24 seconds
(*measured by the team on the hosted site*). These are single, injected faults on small and medium systems, not
production incidents; see the limits below.

**The product itself.**

| | Measured |
| :--- | :--- |
| Installer size | 96 MB (Mac, Apple silicon), 100 MB (Mac, Intel), 84 MB (Windows installer), 76 MB (Windows portable) |
| Start-up to a usable window | **0.6 to 0.8 s** after the first launch (median of five launches, two separate runs: 0.58 s and 0.80 s); the very first launch on a machine took 3.4 s |
| Code loaded for the first screen | 280 KB (the map's 200 KB is loaded only when you open it) |
| Automated checks that pass | **111** server tests, **62** app unit tests, **17** end-to-end tests that drive the real, installed app |
| Platforms | macOS (tested), Windows and Linux (built, not yet run on real hardware) |

## 6. The market

**The tools-and-platforms observability market** is the nearest well-measured market. Estimates differ with how each
firm draws the boundary:

| Source | Size | Growth |
| :--- | :--- | :--- |
| Grand View Research | $2.71 B (2023) to $5.40 B (2030) | 10.7% a year, 2024 to 2030 |
| MarketsandMarkets (via The New Stack) | $2.4 B (2023) to $4.1 B (2028) | 11.7% a year |

Other analysts publish higher figures (the range we found for 2030 is roughly $5 to $6 billion at 10 to 16% a year).
We use the lower, better-documented ones.

**The people.** There were about **47.2 million** software developers worldwide in early 2025, of whom **36.5 million**
are professionals, and **48.4 million** in the third quarter of 2025 *(Sourced: SlashData; a modelled estimate, not a
census; IDC's own estimate is lower, 40.2 million for 2025)*.

**What a slice could be worth.** This is an illustration. It uses two assumptions we have not validated, and shows its
arithmetic so you can change them:

- *Assumption A:* 25% of professional developers work on multi-service systems or an on-call rotation (a planning number).
- *Assumption B:* a team price of $12 per developer per month, $144 a year (a planning number; see [pricing](#8-business-model-a-proposal)).

| Step | Calculation | Result |
| :--- | :--- | ---: |
| Professional developers | SlashData, early 2025 | 36,500,000 |
| Who could use it | 36,500,000 × 25% (A) | 9,125,000 |
| Yearly value of all of them | 9,125,000 × $144 (B) | **$1.31 B** |
| 0.1% of them as paying seats | 9,125 × $144 | $1.31 M a year |
| 1% as paying seats | 91,250 × $144 | **$13.1 M a year** |
| 5% as paying seats | 456,250 × $144 | $65.7 M a year |

The $1.31 B figure is about a quarter of the $5.40 B 2030 observability forecast. That is the same order of magnitude,
which is reassuring, but the two measure different things (seats versus vendor revenue) and neither is a forecast of
what we will earn.

## 7. What it is worth to a customer

The question a buyer asks is: *if this saves my on-call engineers some minutes on each incident, what is that worth?*
Use their own downtime cost. Two reference points from the sources above:

- **$300,000 an hour** (the floor reported by over 90% of mid-size and large enterprises) is **$5,000 a minute**.
- **$1.9 million an hour** (the median high-impact outage, New Relic) is **$31,667 a minute**.

*Assumption C:* a team has **6 high-impact incidents a year**. *Assumption D:* the map shortens finding the cause by
the minutes shown. **D is exactly what the pilot measures; we do not yet know the number.** What it would be worth:

| Minutes saved per incident (D) | At $5,000 a minute | At $31,667 a minute |
| ---: | ---: | ---: |
| 5 | $150,000 a year | $950,000 a year |
| 10 | $300,000 a year | $1.90 M a year |
| 20 | $600,000 a year | $3.80 M a year |

(Calculation: 6 incidents × minutes saved × cost per minute.) Even five minutes saved per incident, at the *floor*, is worth
$150,000 a year, against a team price (for a 20-developer team, $12 × 20 × 12 = $2,880 a year) that is a small fraction of that. For a small company with a much lower downtime cost the
value is mostly engineers' time and calmer on-call nights, and the free tier is the right product for them.

## 8. Business model (a proposal)

| Tier | For | Price (assumption) | What it is |
| :--- | :--- | :--- | :--- |
| **Free** (MIT licence) | Individuals, open-source, evaluation | $0 | The desktop app and the local server, as shipped. |
| **Team** | Teams with an on-call rotation | **$12 per developer per month** | A shared server with sign-in and roles, one map for the whole team, history and audit, Slack and paging integrations. |
| **Business** | Larger and regulated organisations | Custom | Single sign-on, self-hosting support, audit exports, support commitments. |

Why this shape: the free product is also the distribution. A developer installs it, it is useful alone, and the team
purchase happens when they want to share it. The product runs on the customer's own machine, so serving a free user
costs us almost nothing in infrastructure.

*Not yet decided or tested:* the price points, the free/paid line, and whether the unit should be developers or
services. They are hypotheses to take to the first design partners.

## 9. How it affects the market

These are our expectations, not results.

1. **From "look across tools" to "ask the map".** Today the relationships between services are reassembled by hand during
   every incident. Keeping them as a graph that can be queried turns diagnosis into one question. That changes who can
   do it: a junior engineer on call at 3 a.m. gets the answer a senior would.
2. **A much cheaper first map.** Most system maps are drawn by hand and go stale. This one is read from the repository
   in under a second and rebuilt on demand, so the first map costs minutes, not a project.
3. **Adoption from the developer up.** A free tool that lives in the browser a developer already has open reaches teams
   without a procurement cycle. That is a different route to market from selling a platform to a central
   observability budget.
4. **Complement before replacement.** It does not collect logs, metrics or traces at scale, and it does not claim to replace
   the platforms that do. It sits in front of them and asks the question they leave to people. Its map gets better as
   it is fed traces, so it works *with* them.
5. **Privacy as a feature.** Source code never leaves the machine; the server runs locally. That opens doors in
   organisations that cannot send code or topology to a third party.
6. **Fits both directions of the architecture trend.** It maps microservices and monoliths, which matters when 42%
   of adopters report consolidating.

## 10. Competition and where we sit

| Category | Examples | What they do well | The gap we address |
| :--- | :--- | :--- | :--- |
| Observability platforms | Datadog, New Relic, Dynatrace, Grafana | Collect and show metrics, logs and traces at scale | They need data flowing in first, and leave "which one thing caused this" largely to the human. |
| Browser developer tools | The tools built into Chrome, Firefox, Edge | Inspect one page very well | They stop at the page; the system behind it is out of view. |
| Hand-drawn architecture diagrams and wikis | Many | Free | Out of date the day after they are drawn. |

We make no claims here about competitors' features, pricing or customers beyond the categories above; before
any public comparison those need their own research.

## 11. What we have not proven yet

Said plainly, because a buyer will ask.

- **We have not measured time saved by real engineers.** This is the single most important missing number
  (assumption D above). The [pilot protocol](TESTING.md#8-pilot-with-real-engineers) measures it with 8 to 12 on-call
  engineers.
- **Root-cause accuracy is shown on single, injected faults** on small and medium systems, not on production incidents.
  We have not tested two simultaneous, independent failures.
- **The map's accuracy is checked by hand on seven systems**, not at scale, and it depends on what a repository
  declares. A system whose structure is only in runtime traffic needs traces.
- **No customer has used it in production yet.**
- **Windows and Linux builds are not yet run on real hardware.**
- **The server has no authentication.** It is built to run on a developer's own machine. Team use needs sign-in and
  roles first ([Security](SECURITY.md)).
- **The installers are not code-signed**, so each operating system shows a warning on first launch.

## 12. Roadmap

In the order we would do it. No dates: we will date them after the pilot.

1. **Pilot** with 8 to 12 on-call engineers; publish the measured time saved.
2. **Sign-in and roles** on the server, so a team can share one safely.
3. **Signed and notarized installers and automatic updates.**
4. **More languages** for monolith mapping (Go, Java, C#) and more manifest formats (Helm, Terraform).
5. **Easier live data:** a generated OpenTelemetry collector configuration, so real traffic joins the map in minutes.
6. **Team features:** shared history of incidents (the product already learns from each one), Slack and paging.

## Sources

Accessed 30 October 2026.

- ITIC, *2024 Hourly Cost of Downtime Survey*: [Part 1](https://www.calyptix.com/wp-content/uploads/Hourly-Cost-of-Downtime-ITIC.pdf), [Part 2](https://calyptix.com/wp-content/uploads/ITIC-2024-Hourly-Cost-of-Downtime-Survey-Results-Part-2.pdf). (More than 90% of mid-size and large enterprises: over $300,000 an hour; 1,000+ firms surveyed from November 2023 to March 2024.)
- New Relic, [2024 Observability Forecast press release](https://newrelic.com/press-release/20241022): median $1.9 M an hour for high-impact outages, median 77 hours a year; 1,700 respondents in 16 countries; vendor-run survey.
- New Relic, [2025 financial services and insurance report](https://www.businesswire.com/news/home/20250429915969/en/New-Relic-Report-Reveals-High-Business-Impact-Outages-Cost-Financial-Services-and-Insurance-Sectors-%242.2-Million-Per-Hour): MTTD 42 and MTTR 58 minutes, financial services only.
- SlashData, [Global developer population trends 2025](https://www.slashdata.co/post/global-developer-population-trends-2025-how-many-developers-are-there): 47.2 M developers early 2025 (36.5 M professional), 48.4 M in Q3 2025; modelled estimate. IDC's lower estimate (40.2 M for 2025) is reported in [ShiftMag's summary](https://shiftmag.dev/there-are-47-million-developers-in-the-world-5200).
- Grand View Research, [Observability Tools and Platforms Market Report](https://www.grandviewresearch.com/industry-analysis/observability-tools-platforms-market-report): $2.71 B (2023), $5.40 B (2030), 10.7% CAGR.
- MarketsandMarkets, as reported by [The New Stack](https://thenewstack.io/the-looming-crisis-in-the-data-observability-market/): $2.4 B (2023) to $4.1 B (2028), 11.7% CAGR.
- Gartner Peer Community, [Microservices Architecture: Have Engineering Organizations Found Success?](https://www.gartner.com/peer-community/oneminuteinsights/omi-microservices-architecture-have-engineering-organizations-found-success-u6b): 74% of respondents use microservices; survey year not stated.
- CNCF survey (fieldwork autumn 2024), via [a secondary summary](https://www.softwareseni.com/the-great-microservices-consolidation-what-the-cncf-2025-survey-reveals-about-industry-trends): 42% of microservices adopters consolidating. We have not read the primary report.
- Our own measurements: [Testing](TESTING.md) lists the repositories, commits and commands.
