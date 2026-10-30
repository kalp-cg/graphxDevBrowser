# Getting started

About ten minutes, most of it the one-time server setup.

## 1. Install DevBrowser

Download the installer for your system from the [latest release](../../../releases/latest).

| System | Install |
| :--- | :--- |
| macOS | Open the `.dmg`, drag **DevBrowser** to **Applications**. Choose the file that matches your Mac: `arm64` for Apple Silicon (M1 and later), `x64` for Intel. |
| Windows | Run `DevBrowser-Setup-<version>-x64.exe`. Or use the `Portable` build: no installer, no admin rights, run it from anywhere. |
| Linux | `chmod +x DevBrowser-*.AppImage && ./DevBrowser-*.AppImage`, or `sudo apt install ./DevBrowser-*.deb`. |

### First launch

Version 1.0 is not yet code-signed (a signing certificate is an annual purchase we have not made), so your system
asks you to confirm once. The installer is the same file whether or not it is signed; verify it against
`SHA256SUMS.txt` on the release page if you want to be certain.

- **macOS:** right-click **DevBrowser** in Applications, choose **Open**, then **Open** again. Or, in a terminal:
  `xattr -dr com.apple.quarantine /Applications/DevBrowser.app`
- **Windows:** at "Windows protected your PC", choose **More info**, then **Run anyway**.
- **Linux:** nothing to confirm.

You can use DevBrowser as a browser right away: it needs no account and no server. The service map and the
investigation agent need SentinelGraph (next step).

## 2. Run SentinelGraph

SentinelGraph is the server that builds the map. Run it on your own machine. **It has no login: it listens on
127.0.0.1 only and must never be exposed to a network.** See [Security](SECURITY.md).

### Option A: one command (Python 3.12)

```bash
git clone https://github.com/MahirPatel2005/graphxDevBrowser.git
cd graphxDevBrowser
./scripts/sentinelgraph.sh
```

The first run creates a Python environment and installs the dependencies. It then serves
`http://127.0.0.1:8100` and keeps its graph in `.sentinel-data/`. Use `PORT=8200 ./scripts/sentinelgraph.sh` for
another port.

### Option B: Docker

```bash
PROJECTS_DIR=/absolute/path/to/the/folder/that/holds/your/code docker compose up --build backend
```

The container cannot see your disk, so give it the folder that contains your projects (read-only). Pick projects
inside that folder when you connect a codebase. The graph is kept in a Docker volume.

### Optional: let a model reason

By default the agent is deterministic: same graph, same answer, no model and no key. To have a language model
drive the investigation, set `LLM_PROVIDER` to `ollama` (local, free), `gemini` or `openai`, with the key in a
`.env` file at the repository root (see `.env.example`). Your source code is never sent; the model sees the results of the
graph queries (service names, alert metrics, commit messages and authors).

## 3. Connect DevBrowser to it

1. In DevBrowser choose **Connect SentinelGraph** on the new-tab page (or **Settings → Integrations**).
2. Enter `http://127.0.0.1:8100` and press **Connect & Load Graph**. The status bar shows *SentinelGraph connected*.

## 4. Connect a project

1. Open the SentinelGraph panel (the share icon in the left rail) and press **Connect codebase…**.
2. Pick the folder of a repository.

You get one of these, depending on how the project is built:

| Your project | What appears |
| :--- | :--- |
| Docker Compose or Kubernetes files | Every service and database, and the connections between them. |
| A monolith (one deployable) | Its modules, the imports between them, its database and the outside APIs it calls. |
| Neither | Each package folder as a service; traces and your browsing fill in the connections. |

Connecting a *different* project replaces the map, so it always shows exactly what you connected. Connecting the
*same* project again only refreshes it and keeps live health.

## 5. Try a failure

1. In the SentinelGraph panel type a service name in **Find a service** and pick it.
2. Under **Simulate a failure** choose **Ship a bad deploy**, **Crash it** or **Degrade it**.
3. Press **Investigate**. Read the steps, the root cause and the proposed fixes.
4. **Approve** or **Reject** a fix, or press **Restore healthy**.

The failure is simulated in the graph; nothing real is touched. (With the bundled sandbox shop it breaks a real,
local, running shop so you can watch the fix work: `python sandbox/run.py up`, see [sandbox/README.md](../sandbox/README.md).)

## Where things are stored

| | macOS | Windows | Linux |
| :--- | :--- | :--- | :--- |
| App data and **log file** | `~/Library/Application Support/DevBrowser/` | `%APPDATA%\DevBrowser\` | `~/.config/DevBrowser/` |
| Log | `…/logs/devbrowser.log` | same | same |

To uninstall, delete the app and, if you want, that folder.

## Something wrong?

See [Troubleshooting](USER_GUIDE.md#troubleshooting).
