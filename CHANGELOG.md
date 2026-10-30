# Changelog

All notable changes. Versions follow [semantic versioning](https://semver.org/).

## 1.0.0 (2026-10-30)

First release.

### DevBrowser (desktop app)
- A browser for developers: tabs, split view, separate profiles, device emulation, find, zoom, session restore, and
  one-click local dev servers.
- Network, Security and API Client panels that show **the website you are on**, with a History view for earlier sites.
- Passive security audit with SARIF export.
- A SentinelGraph panel: the live service map, blast radius, investigation trail, approve and reject, and simulated
  failures for trying it out.
- A new-tab page that walks through the three first steps.
- Installers for macOS (Apple silicon and Intel), Windows (installer and portable) and Linux (AppImage and deb).
- Production plumbing: log file, automatic recovery from interface crashes, window size and position remembered, an
  About panel, a single running instance, and an app window that can never navigate away.
- Captured traffic is sent to the SentinelGraph server without query strings or fragments.

### SentinelGraph (server)
- Reads a repository into a graph: Docker Compose (with `.env` variables) and Kubernetes manifests, services,
  databases, languages, owners (`CODEOWNERS`) and recent changes (git).
- Maps **monoliths** from source imports (TypeScript, JavaScript, Python): modules, the database, and the outside APIs
  each module calls.
- Leaves monitoring, load generators and feature-flag servers out of the map so they do not distort blast radius.
- An agent that finds the shared dependency behind a set of alerts, names the change and the owner, and proposes
  actions that wait for approval. Investigating a healthy system says so.
- One-command start (`scripts/sentinelgraph.sh`) and a Docker setup that listens on `127.0.0.1` only, keeps its graph
  in a volume and mounts your projects read-only.

### Known limits
- The server has no authentication: run it on your own machine only.
- Installers are not code-signed; expect one warning on first launch.
- Windows and Linux builds have not been run on real hardware.
See [docs/TESTING.md](docs/TESTING.md#10-known-limits).
