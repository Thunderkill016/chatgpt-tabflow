# ⚡ ChatGPT TabFlow v3.2

TabFlow is a local-first Chrome extension for people who work with many ChatGPT conversations as one project.

The v3.2 release focuses on four product surfaces:

- **Unified Workspace** — show the ChatGPT conversations you already have open in one workbench.
- **Project Memory + local RAG** — index project constraints, decisions, code evidence and conversation context locally, then retrieve relevant context for another chat in the same project.
- **Adaptive Runtime** — protect productive chats and hibernate only background chats that are actually safe to discard.
- **Capture Studio** — record or screenshot a screen/window/tab locally, including 4K targets when the selected source really provides 4K.

TabFlow is not a proxy service and does not require a TabFlow cloud account.

## Requirements

- Google Chrome **116 or newer**.
- Manifest V3.
- A signed-in ChatGPT session for normal production use.

Chrome 116 is the minimum because TabFlow uses the Side Panel API including programmatic `sidePanel.open()`.

## Install from source

```bash
cd ~/Code/chatgpt-tabflow
git switch feat/v3-cognitive-memory-wave1
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository directory.

After pulling an update, use **Reload** on the extension card. Existing ChatGPT tabs may also need one page reload when content scripts or the manifest changed.

## Main workflow

### 1. Control Center

Open the extension Side Panel with the toolbar popup or `Alt+C`.

The Control Center contains:

- open ChatGPT conversations and their live runtime state;
- current Project Memory binding;
- Memory/RAG inspectors;
- Runtime automation controls;
- saved sessions;
- Project Vault;
- entry points to Unified Workspace and Capture Studio.

### 2. Unified Workspace

Unified Workspace imports the ChatGPT tabs that are currently open. It is not limited to three conversations.

Workspace behavior includes:

- adaptive layout for 1, 2, 3, 5, 10 or more open chats;
- primary-pane / spotlight layouts;
- resizable split view;
- Focus mode without intentionally destroying the iframe browsing context;
- Sync without intentionally remounting unchanged panes;
- document-token diagnostics for unexpected pane remounts;
- project inheritance for new Workspace chats;
- scoped session DNR rules so the frame-policy exception is limited to the Workspace tab rather than every ChatGPT tab.

The Side Panel is disabled specifically on the Workspace tab so it does not consume Workspace width.

### 3. Local Project Memory

TabFlow stores project memory in extension-owned IndexedDB (`tabflow_project_memory`). The current memory system includes:

- projects;
- conversations;
- virtual project files;
- chunks for local retrieval;
- decisions;
- graph edges and metadata.

The Context Compiler allocates explicit context budget across:

```text
authority → continuity → profile → structural → retrieval
```

User constraints and accepted project rules are treated as higher-authority context than retrieved assistant prose.

Historical archive observations are guarded so older evidence cannot overwrite a newer live VFS observation.

### 4. Adaptive Runtime

Runtime state distinguishes productive activity such as typing/generating from idle background work.

Important safety behavior:

- typing/generating chats are protected from discard;
- destructive discard performs a live renderer probe first;
- unavailable or malformed probe data fails safe: the tab is not discarded;
- generation concurrency is a ceiling and can be reduced under memory pressure;
- auto-sleep uses Chrome tab discard rather than pretending to know exact per-tab RAM usage.

TabFlow does **not** claim a fixed number of megabytes saved per tab. Actual browser memory usage depends on Chrome, the conversation, extensions, GPU state and the machine.

## Capture Studio

Open **Capture Studio** from the toolbar popup or Control Center.

Features:

- screen / window / tab picker through `getDisplayMedia()`;
- 4K UHD, 1440p, 1080p and Native targets;
- 30 or 60 FPS master capture targets;
- MP4 when the current Chrome MediaRecorder implementation supports the requested codec/container;
- WebM fallback;
- source/system audio when Chrome exposes it;
- optional microphone mix;
- pause / resume / stop;
- PNG screenshots;
- direct-to-file chunk writing for long recordings when File System Access is available;
- Chrome Downloads fallback and recent-recording actions;
- no Capture Studio network-upload path.

### Master vs Social Ready

- **Master** keeps quality controls such as 4K/60.
- **Social Ready** targets 1080p30 MP4 H.264/AAC-LC when the browser exposes that MediaRecorder combination.
- **X Free** uses the Social Ready target and automatically stops before the non-Premium 140-second limit.

TabFlow reports the **actual captured resolution**. A 1920×1080 source is not relabeled or upscaled as true 4K.

## Privacy and security model

TabFlow is designed as a local-first extension:

- project memory stays in extension-owned browser storage;
- Capture Studio does not upload recordings;
- no `eval()` / `new Function()` in the production extension path;
- automatic retry is limited to safe GET/HEAD requests;
- mutating conversation POST requests are not blindly replayed;
- ChatGPT iframe header overrides are installed as session DNR rules scoped to the Workspace tab and `sub_frame` resources;
- the legacy global static CSP/X-Frame-Options stripping ruleset is removed.

Host permissions are limited to:

```text
https://chatgpt.com/*
https://chat.openai.com/*
```

## Permissions

| Permission | Why TabFlow uses it |
| --- | --- |
| `tabs` | list, activate, create, close and safely discard ChatGPT tabs |
| `storage` | settings, sessions, project bindings and runtime state |
| `alarms` | periodic idle/sleep checks |
| `sidePanel` | Control Center |
| `tabGroups` | optional ChatGPT Tab Group organization |
| `declarativeNetRequest` | session-scoped Workspace frame policy |
| `offscreen` | local memory worker host |
| `unlimitedStorage` | larger local Project Memory corpora |
| `system.memory` | coarse system memory-pressure signal, not per-tab RAM accounting |
| `downloads` | video and screenshot export / recent download actions |

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+C` | Open Control Center |
| `Alt+F` | Ask Runtime to hibernate safe background ChatGPT tabs |

Workspace also supports pane focus and splitter keyboard controls documented by the in-product UI.

## Tests

Deterministic checks:

```bash
npm run quality
```

Real unpacked-extension Chromium tests:

```bash
npm run browser:e2e
```

The Chromium harness verifies the actual MV3 extension path, including Workspace frame policy, cross-pane local RAG, submit safety, runtime discard protection, Side Panel policy and Capture Studio record/pause/resume/stop.

A production canary with an authenticated ChatGPT session is still useful for detecting upstream ChatGPT DOM/API drift that a deterministic fixture cannot predict.

See `docs/TESTING.md`, `docs/RECORDER.md`, `docs/PRODUCT-ARCHITECTURE-ADOPTIONS.md` and `docs/RESEARCH-ADOPTIONS.md` for engineering details.

## Release policy

`main` should represent a usable release baseline. New architecture work belongs on a feature branch and must pass both static/unit quality gates and Chromium extension E2E before merge.

Current release line: **v3.2.0**.

## License

MIT. Upstream repositories are used as design/research references according to the adoption notes in `docs/`; TabFlow does not copy incompatible-license code into the project.
