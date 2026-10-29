# Dev Browser — Architecture Decision Records (ADRs)

**Document Version:** 1.0.0  
**Status:** Approved Architectural Standard  
**Target Hardware:** Apple MacBook Air M4 (16 GB Unified Memory, 8-Core/10-Core CPU/GPU, Apple Neural Engine)  
**Core Technologies:** Electron, React, TypeScript, Ollama (Local AI)  
**Companion Documents:** [PRD.md](file:///Users/mahir/Downloads/DevBrowser/docs/PRD.md), [ROADMAP.md](file:///Users/mahir/Downloads/DevBrowser/docs/ROADMAP.md)

---

## Architecture Overview & System Topology

Dev Browser is engineered as a multi-process, local-first developer environment. The system decouples web rendering, developer tooling, background security auditing, local AI inference, and graph processing into isolated memory spaces to ensure system stability and strict security.

```mermaid
graph TD
    subgraph macOS Host System
        OllamaDaemon[Ollama Local Daemon<br/>Port 11434 / Unix Socket<br/>Models: Qwen2.5-Coder 7B / Llama 3.2 3B]
        Keychain[macOS Keychain<br/>Electron safeStorage]
        WisprApp[Wispr Flow Desktop App<br/>macOS Accessibility / Dictation]
        TigerGraphCloud[TigerGraph REST++ Server<br/>Port 9000 / 443 HTTPS<br/>Optional Cloud / Docker]
    end

    subgraph Dev Browser Application Boundary
        subgraph Electron Main Process Node.js
            ProcessMgr[Window & Session Manager]
            PartitionMgr[Partition & Cookie Engine]
            CDPCoordinator[CDP Network & Security Coordinator]
            CredentialVault[Encrypted Credential Vault]
            GraphBridge[Graph Provider Bridge]
            SQLiteEngine[Local SQLite Database]
        end

        subgraph Preload & Security Boundary
            ContextBridge[ContextBridge IPC Gateway<br/>Strict Type Isolation & Validation]
        end

        subgraph UI Renderer Process React 18/19
            DevSuiteUI[Developer Workspace Shell]
            TabManagerUI[Multi-Pane Split Tab UI]
            ApiClientUI[API Client & Chained Workflow Editor]
            NetworkViewerUI[Real-Time Network Stream UI]
            SecurityAuditUI[Passive Security Findings Drawer]
            LocalAIChatUI[AI Debugger & Diff Viewer]
            GraphViewerUI[Interactive Dependency Canvas]
        end

        subgraph Isolated Web Content Runtimes
            WebTab1[WebContents Session: Partition A<br/>Customer Role]
            WebTab2[WebContents Session: Partition B<br/>Admin Role]
        end
    end

    DevSuiteUI -->|Type-Safe IPC| ContextBridge
    ContextBridge -->|IPC Invocation| ProcessMgr
    ProcessMgr --> CDPCoordinator
    CDPCoordinator -->|DevTools Protocol| WebTab1
    CDPCoordinator -->|DevTools Protocol| WebTab2
    CDPCoordinator -->|Audit Stream| SQLiteEngine
    ProcessMgr -->|Local REST| OllamaDaemon
    ProcessMgr -->|REST++ HTTP| TigerGraphCloud
    ProcessMgr -->|AES-256| Keychain
    WisprApp -.->|OS Keystrokes| DevSuiteUI
```

---

## Memory Allocation Architecture (MacBook Air M4, 16 GB Budget)

On a 16 GB Apple Silicon machine, unified memory is shared dynamically between the CPU and GPU. Dev Browser enforces strict memory ceilings to guarantee zero thermal throttling, zero swap memory thrashing, and zero interference with the developer's local development servers (e.g., Next.js, Node, Docker).

```mermaid
pie title RAM Allocation Budget on 16 GB M4 MacBook Air (Megabytes)
    "macOS Sequoia & System Daemons" : 4608
    "User Dev Server & IDE (Next.js / Docker / VSCode)" : 3584
    "Local AI Inference (Ollama Qwen2.5-Coder 7B Q4)" : 5120
    "Dev Browser Main Process & SQLite" : 400
    "Dev Browser React Workspace UI" : 450
    "Active Browser Tabs & CDP Interception (5 tabs)" : 1200
    "Emergency System Headroom" : 1022
```

### Memory Guardrails & Hibernation Policies
1. **Per-Tab Memory Threshold:** If any individual `WebContents` exceeds 600 MB RSS, the user is presented with a non-blocking performance notification.
2. **Auto-Hibernation (30-Minute Idle):** Inactive background tabs serialize their navigation state, DOM scroll offset, and form drafts to disk, releasing their Chromium renderer process. This reclaims ~120–250 MB RAM per hibernated tab.
3. **AI Inference Dynamic Eviction:** Dev Browser communicates with Ollama's `/api/generate` and `/api/chat` endpoints with `keep_alive: "5m"`. If no AI queries occur within 5 minutes, Ollama automatically unloads model weights from unified memory, releasing ~4.7 GB back to the OS.

---

## Architecture Decision Records

---

### ADR-001: Desktop Application Framework Selection

* **Status:** Accepted  
* **Date:** 2026-10-29  
* **Decision Owner:** Principal Product Architect  

#### Context & Problem Statement
Dev Browser requires deep, low-level programmatic control over Chromium web rendering, multi-session cookie partitioning, raw network packet inspection via the Chrome DevTools Protocol (CDP), local hardware-accelerated rendering, and access to macOS native APIs (Keychain, native menus). We evaluated Electron, Tauri 2.0 (WKWebView on macOS), Neutralinojs, and native Swift/WebKit.

#### Decision
We select **Electron (latest LTS branch)** paired with **React 18/19** and **TypeScript (strict mode)**.

#### Technical Rationale
1. **Uniform Chromium Engine:** Modern web developers develop and debug against Chromium standards. Tauri on macOS relies on WKWebView (Safari/WebKit), which lacks native support for the Chrome DevTools Protocol (CDP), Chrome WebExtension APIs (MV3), and identical Chromium rendering parity.
2. **First-Class CDP Control:** Electron provides direct access to `webContents.debugger`, enabling non-invasive, raw network body capture, console event interception, and DOM mutation monitoring without custom proxy servers.
3. **Multi-Session Isolation:** Electron’s `session.fromPartition()` enables robust, isolated cookie stores and local storage containers in a single application window.

#### Mitigations for Electron Memory Overhead
* Disable unused Chromium features via launch switches: `--disable-background-timer-throttling=false`, `--disable-renderer-backgrounding=false`.
* Aggressive renderer process recycling and custom tab hibernation.
* Node.js integration disabled across all rendering layers to eliminate runtime bloat and security risk.

---

### ADR-002: Process Architecture & Application Security Boundaries

* **Status:** Accepted  
* **Date:** 2026-10-29  
* **Decision Owner:** Principal Product Architect / DevSecOps  

#### Context & Problem Statement
A browser running untrusted third-party code from the internet cannot share execution privileges with the developer tool suite, filesystem, or operating system credentials. A vulnerability in a browsed website must never compromise the host machine.

#### Decision
We implement a **Three-Tier Process Isolation Architecture** enforcing absolute privilege separation:

```mermaid
sequenceDiagram
    autonumber
    participant UntrustedWeb as Untrusted WebContents (Target Site)
    participant DevUI as Renderer Process (React Dev Workspace)
    participant Preload as Preload ContextBridge (Sanitizer)
    participant Main as Electron Main Process (Node.js)
    participant OS as OS / Keychain / Disk / Network

    UntrustedWeb->>UntrustedWeb: Execute Remote JS (Sandboxed)
    Note over UntrustedWeb: nodeIntegration: false<br/>sandbox: true<br/>contextIsolation: true

    DevUI->>Preload: devBrowserAPI.apiClient.sendRequest(payload)
    Note over Preload: Validate Payload Schema (Zod)<br/>Strip Dangerous Tokens
    Preload->>Main: ipcRenderer.invoke('api-client:send', sanitizedPayload)
    
    Main->>OS: Execute HTTP Request / Read Keychain
    OS-->>Main: Raw Response
    Main-->>Preload: Structured Response Object
    Preload-->>DevUI: Safe Immutable Clone
```

#### Security Directives Enforced Across Runtimes
1. **`nodeIntegration: false`**: Never allow Node.js APIs (`fs`, `child_process`, `net`) in any Renderer or WebContents.
2. **`contextIsolation: true`**: Ensure scripts running in WebContents cannot access preload scripts or internal Electron prototypes.
3. **`sandbox: true`**: Chromium sandbox enforced for all web rendering processes.
4. **Content Security Policy (CSP)** for Dev Browser Internal UI:
   ```http
   default-src 'self';
   script-src 'self';
   style-src 'self' 'unsafe-inline';
   img-src 'self' data: https:;
   connect-src 'self' http://127.0.0.1:11434 http://localhost:9000 https:;
   font-src 'self';
   ```
5. **IPC Validation:** All IPC messages passing through Electron's `ipcMain.handle` are validated against strict **Zod schemas** before execution.

---

### ADR-003: Local AI Inference Subsystem (Ollama)

* **Status:** Accepted  
* **Date:** 2026-10-29  
* **Decision Owner:** Principal Product Architect  

#### Context & Problem Statement
Developers demand intelligent debugging, error explanation, test generation, and diff generation directly inside their browser workflow. However, commercial enterprises strictly forbid sending internal API payloads, proprietary source code, or internal URLs to external cloud AI vendors. Furthermore, the solution must operate smoothly on an M4 MacBook Air with 16 GB RAM without freezing the OS.

#### Decision
We implement a **Local-First AI Engine** interfacing with a local **Ollama** daemon over loopback HTTP (`http://127.0.0.1:11434/api`), managing quantized local models optimized for Apple Silicon Metal acceleration.

#### Model Strategy & Memory Allocation

| Parameter | Primary Coding Model | Lightweight / Low-Power Model |
| :--- | :--- | :--- |
| **Model Name** | `qwen2.5-coder:7b-instruct-q4_K_M` | `llama3.2:3b-instruct-q4_K_M` |
| **Parameter Count** | 7.61 Billion | 3.21 Billion |
| **Quantization** | 4-bit (Q4_K_M) | 4-bit (Q4_K_M) |
| **RAM / VRAM Footprint** | ~4.7 GB | ~2.0 GB |
| **Inference Speed (M4)** | ~38 tokens/sec | ~72 tokens/sec |
| **Context Window Size** | 16,384 tokens | 8,192 tokens |
| **Specialization** | Code generation, AST reasoning, diff synthesis | Rapid log explanation, quick JSON parsing |

#### Context Sanitization Pipeline
Before any prompt is dispatched to the AI provider, it passes through the **Privacy Sanitizer**:
1. Mask credit card numbers, Social Security numbers, and common private key formats (`-----BEGIN PRIVATE KEY-----`).
2. Replace authorization bearer tokens and API keys with synthetic tokens (`[REDACTED_BEARER_TOKEN]`).
3. Truncate repetitive payload arrays (e.g., arrays > 10 items collapsed to `[... 90 more items]`).

---

### ADR-004: Network Interception & API Client Engine

* **Status:** Accepted  
* **Date:** 2026-10-29  
* **Decision Owner:** Principal Product Architect  

#### Context & Problem Statement
To provide live network inspection, cURL generation, and instant conversion of browser traffic into editable API client requests, Dev Browser must capture raw network traffic. Traditional local HTTP proxy approaches (e.g., Charles Proxy, Burp Suite) require installing custom root CA certificates on the user's OS, disrupting HTTPS trust stores and breaking client-certificate authentication.

#### Decision
We adopt a **Native Chrome DevTools Protocol (CDP) Interception Architecture** attached via Electron's `webContents.debugger` API.

```mermaid
sequenceDiagram
    autonumber
    participant WebPage as Web Application
    participant Blink as Chromium Blink / Network Stack
    participant CDP as Electron webContents.debugger
    participant Inspector as Dev Browser Network Inspector
    participant ApiClient as Dev Browser API Client

    Inspector->>CDP: attach("1.3")
    Inspector->>CDP: sendCommand("Network.enable", { maxPostDataSize: 10485760 })
    
    WebPage->>Blink: fetch('/api/v2/orders', { method: 'POST', body: JSON })
    Blink->>CDP: Network.requestWillBeSent (id, url, headers, method, postData)
    CDP->>Inspector: Stream Request Header & Metadata
    
    Blink->>CDP: Network.responseReceived (id, status, headers, mimeType)
    Blink->>CDP: Network.loadingFinished (id, encodedDataLength)
    
    Inspector->>CDP: sendCommand("Network.getResponseBody", { requestId: id })
    CDP-->>Inspector: Raw Response Body (Decoded UTF-8 / Base64)
    
    Note over Inspector,ApiClient: Developer clicks "Open in API Client"
    Inspector->>ApiClient: Clone Transaction -> Editable Request Model
```

#### Key Architecture Benefits
1. **Zero Root CA Certificates:** Operates directly inside the Chromium network stack after TLS termination; zero certificate warnings or system keychain tampering.
2. **Complete Fidelity:** Intercepts modern protocols including HTTP/2 multiplexed streams, HTTP/3 (QUIC), WebSocket frames, and Server-Sent Events (SSE).
3. **Bi-Directional Action:** Once captured, the API Client re-dispatches requests using a native Node.js HTTP/2 and fetch pipeline, entirely independent of the browser tab's active session if desired.

---

### ADR-005: Graph Provider Abstraction & TigerGraph Architecture

* **Status:** Accepted  
* **Date:** 2026-10-29  
* **Decision Owner:** Principal Product Architect  

#### Context & Problem Statement
Modern microservice architectures obscure how frontend UI components trigger cascading backend API dependencies. Developers need real-time visualization of service dependencies and failure blast radiuses. Dev Browser must provide a universal graph contract that supports both offline local development (zero setup) and enterprise graph databases (specifically **TigerGraph**).

#### Decision
We establish the `IGraphProvider` interface and provide two concrete implementations:
1. **`InMemoryGraphProvider` (MVP):** An embedded, zero-dependency graph using Graphlib / SQLite, fully functioning offline for local microservice topologies.
2. **`TigerGraphRestProvider` (Subsequent Release):** An enterprise-grade adapter connecting to TigerGraph instances via standard **REST++** endpoints.

#### TigerGraph Verified REST++ Adapter Specification

```mermaid
classDiagram
    class IGraphProvider {
        <<interface>>
        +providerId: string
        +providerName: string
        +initialize(config): Promise~void~
        +healthCheck(): Promise~HealthResult~
        +upsertNode(node: IGraphNode): Promise~void~
        +upsertEdge(edge: IGraphEdge): Promise~void~
        +batchUpsert(nodes, edges): Promise~void~
        +queryDependencies(nodeId, depth): Promise~GraphData~
        +calculateBlastRadius(nodeId): Promise~BlastRadiusResult~
        +clearGraph(): Promise~void~
    }

    class InMemoryGraphProvider {
        -graph: GraphlibGraph
        -sqliteDb: SQLiteDatabase
        +upsertNode()
        +upsertEdge()
        +queryDependencies()
    }

    class TigerGraphRestProvider {
        -baseUrl: string
        -graphName: string
        -apiToken: string
        +requestToken(secret): Promise~string~
        +upsertVerticesAndEdges(): Promise~void~
        +runInstalledQuery(queryName, params): Promise~any~
    }

    IGraphProvider <|.. InMemoryGraphProvider : Implements MVP
    IGraphProvider <|.. TigerGraphRestProvider : Implements Subsequent
```

#### TigerGraph Verified Endpoint Mappings
* **Authentication:** `POST /restpp/v1/requesttoken` with body `{"secret": "...", "lifetime": 86400}` -> returns token for `Authorization: Bearer <token>`.
* **Health / Diagnostics:** `GET /echo` (port 9000) or `GET /api/ping` (port 14240).
* **Batch Mutation:** `POST /restpp/graph/{graph_name}` with standard TigerGraph vertex/edge upsert schema:
  ```json
  {
    "vertices": {
      "Service": {
        "auth-service": { "environment": { "value": "staging" } },
        "billing-service": { "environment": { "value": "staging" } }
      }
    },
    "edges": {
      "Service": {
        "auth-service": {
          "CALLS": {
            "Service": {
              "billing-service": { "weight": { "value": 1.0 } }
            }
          }
        }
      }
    }
  }
  ```
* **Installed Query Execution:** `GET /restpp/query/{graph_name}/{query_name}?source={id}&max_depth={depth}`.

---

### ADR-006: Voice Input Provider Abstraction & Wispr Flow Workflow

* **Status:** Accepted  
* **Date:** 2026-10-29  
* **Decision Owner:** Principal Product Architect  

#### Context & Problem Statement
Voice-driven developer tools dramatically accelerate prompt entry, test assertion authoring, and documentation. Dev Browser must support **Wispr Flow** without hard-coding a fragile, undocumented integration or claiming unverified public developer tiers.

#### Decision
We architect a decoupled `IVoiceInputProvider` abstraction supporting two distinct operating modes:
1. **Mode A (MVP — Recommended): Native Wispr Flow Desktop System Workflow:**
   * Dev Browser adheres to macOS Accessibility and standard DOM input specifications.
   * Wispr Flow operates as a native system assistant, capturing microphone audio at the OS level, executing AI transcription with automatic filler removal and punctuation formatting, and injecting text directly into Dev Browser's focused editor via standard OS keystroke events.
   * *Zero configuration, zero API keys, 100% reliable.*
2. **Mode B (Subsequent Release): Direct Wispr Flow Voice Interface API Provider:**
   * Uses Wispr Flow's developer API via WebSocket (`wss://platform-api.wisprflow.ai/ws`) or REST (`POST /api/v1/dash/api`).
   * Automatically streams base64-encoded 16kHz WAV audio while enriching requests with contextual code boundaries via Wispr Flow's official `context.textbox_contents` (`before_text`, `selected_text`, `after_text`).
   * Requires user-supplied Wispr Flow API key / client JWT token.

```mermaid
flowchart LR
    subgraph Developer Interaction
        SpokenVoice[Developer Speaks Command]
    end

    subgraph Mode A: Wispr Flow Desktop Workflow (MVP)
        WisprDesktop[Wispr Flow macOS App]
        GlobalShortcut[Global Hotkey]
        OSInjection[macOS Keystroke Injection]
    end

    subgraph Mode B: Wispr Flow API Provider (Subsequent)
        AudioStream[Dev Browser Mic Streamer]
        ContextBuilder[Code & Env Context Builder]
        WisprWebSocket[Wispr Flow WebSocket /ws]
    end

    subgraph Dev Browser Target Inputs
        MonacoEditor[Monaco Script / Test Editor]
        AIPromptBar[Local AI Prompt Input]
    end

    SpokenVoice --> GlobalShortcut --> WisprDesktop --> OSInjection --> MonacoEditor
    SpokenVoice --> AudioStream
    ContextBuilder --> WisprWebSocket
    AudioStream --> WisprWebSocket --> AIPromptBar
```

---

### ADR-007: Credential Storage & Privacy-First Data Isolation

* **Status:** Accepted  
* **Date:** 2026-10-29  
* **Decision Owner:** Principal Product Architect / Security  

#### Context & Problem Statement
Developers store high-privilege credentials in browser workspaces: production API tokens, AWS access keys, TigerGraph database secrets, and session cookies. Storing credentials in plaintext JSON or SQLite files on disk presents severe security vulnerabilities.

#### Decision
We mandate hardware-backed encryption using Electron’s native `safeStorage` API backed by the **macOS Keychain** on Apple Silicon:
* When a secret environment variable or API key is saved, it is encrypted via `safeStorage.encryptString(plaintext)`.
* The resulting encrypted buffer is stored in local SQLite.
* Plaintext is only decrypted in the Electron Main process memory at the exact instant an outgoing HTTP request is dispatched.
* Decrypted values are never transferred across IPC to the React Renderer process unless explicitly requested by a user clicking "Reveal Secret" (requiring macOS Touch ID / password prompt).

---

### ADR-008: Passive Web Security Auditing Engine

* **Status:** Accepted  
* **Date:** 2026-10-29  
* **Decision Owner:** Principal Product Architect / Security  

#### Context & Problem Statement
Traditional web application security scanners (e.g., OWASP ZAP, Burp Suite Active Scan) use active fuzzing, sending thousands of malicious payloads (`' OR 1=1--`, `<script>alert(1)</script>`). If run against a developer's local or staging database, active scanners can corrupt test data, trigger rate limits, or crash local servers.

#### Decision
We engineer a **100% Passive, Evidence-Based Security Auditing Engine**:
1. Hooks directly into the CDP `Network.responseReceived` and `DOM.documentUpdated` event stream.
2. Evaluates incoming response headers, cookies, and DOM structures against an in-memory rule engine.
3. Generates structured findings with immutable raw evidence (exact header text, URL, line numbers, status codes).
4. Strictly forbids emitting synthetic secondary HTTP requests.

```mermaid
flowchart TD
    RawCDP[CDP Event: Network.responseReceived] --> FilterMime{MIME Type Check}
    FilterMime -->|Document / XHR / Script| AuditPipeline[Security Audit Pipeline]
    FilterMime -->|Images / Media| Skip[Ignore]

    subgraph Passive Rule Execution
        AuditPipeline --> Rule1[Rule: Strict CSP Evaluator]
        AuditPipeline --> Rule2[Rule: Cookie Flags Secure / HttpOnly / SameSite]
        AuditPipeline --> Rule3[Rule: Permissive CORS Validator]
        AuditPipeline --> Rule4[Rule: Sensitive Token in URL Regex]
        AuditPipeline --> Rule5[Rule: HSTS & Mixed Content Check]
    end

    Rule1 --> FindingsCollector[Evidence & Finding Compiler]
    Rule2 --> FindingsCollector
    Rule3 --> FindingsCollector
    Rule4 --> FindingsCollector
    Rule5 --> FindingsCollector

    FindingsCollector --> Redaction[Redact Sensitive User Auth]
    Redaction --> Store[Local SQLite Findings Store]
    Store --> UI[Security Drawer UI Badge: 2 High, 1 Med]
```

---

### ADR-009: Extension Architecture & Standards Compliance

* **Status:** Accepted  
* **Date:** 2026-10-29  
* **Decision Owner:** Principal Product Architect  

#### Context & Problem Statement
Proprietary browser extension APIs quickly become obsolete and alienate developers who depend on established developer extensions (e.g., React DevTools, Redux DevTools, Vue Devtools, password managers).

#### Decision
1. **Chromium WebExtension Manifest V3 (MV3):** Dev Browser implements standard Chromium extension loading via Electron's `session.loadExtension()` API, allowing users to load standard Chrome extensions directly from disk or the Chrome Web Store.
2. **Standard Interoperability Formats:**
   * **HAR 1.2:** Standard network archive export/import.
   * **OpenAPI 3.0 / 3.1:** Collection synchronization.
   * **OASIS SARIF 2.1.0:** Security finding reporting.
   * **Postman v2.1:** Collection format compatibility.
3. No proprietary, locked extension APIs will be created.

---

### ADR-010: State Management & UI Architecture

* **Status:** Accepted  
* **Date:** 2026-10-29  
* **Decision Owner:** Principal Product Architect  

#### Context & Problem Statement
The Dev Browser user interface must render high-frequency network streams (hundreds of requests per second), complex Monaco code editors, and animated graph canvases without UI hitching or frame drops on a 60/120 Hz display.

#### Decision
1. **UI Framework:** React 18/19 with TypeScript strict mode.
2. **State Layer:** **Zustand** with granular slice stores:
   * `useNetworkStore`: High-performance buffer with virtualized windowing (rendering only visible rows in the table via `@tanstack/react-virtual`).
   * `useTabStore`: Window layout, split views, active partitions.
   * `useApiClientStore`: Active request drafts, collections, environments.
   * `useSecurityStore`: Real-time findings, active filters, SARIF export.
3. **Editor Engine:** **Monaco Editor** (`@monaco-editor/react`) for full code editing, JSON highlighting, diff views, and IntelliSense.
4. **Graph Engine:** **Cytoscape.js** / WebGL-backed canvas for 60 FPS rendering of microservice topology graphs up to 2,000 nodes.

---

## Technical Debt & Architecture Verification Registry

| Architecture Risk | Failure Mode | Mitigation Strategy | Verification Metric |
| :--- | :--- | :--- | :--- |
| **Unified Memory Starvation** | Ollama + 10 browser tabs exceed 16 GB, causing swap thrashing. | Tab auto-hibernation, Ollama dynamic 5m eviction, 7B Q4 quantization limit. | System swap usage remains < 512 MB under 2-hour heavy test. |
| **CDP Buffer Overflow** | Rapid streaming (e.g., SSE/WebSocket) floods Electron IPC channel. | In-memory circular buffer (max 10,000 entries), throttling UI state updates to 30ms batches. | UI maintains 60 FPS during 1,000 req/sec network flood. |
| **Ollama Daemon Unavailability** | User launches Dev Browser without Ollama installed or running. | Graceful UI status banner with automated 1-click terminal installation instructions. | Zero uncaught exceptions; fallback to non-AI features. |
| **Keychain Access Lockout** | Corrupted or locked macOS Keychain prevents credential decryption. | Graceful error prompts, fallback to session-only in-memory storage with explicit user warning. | User notified without application crash. |
