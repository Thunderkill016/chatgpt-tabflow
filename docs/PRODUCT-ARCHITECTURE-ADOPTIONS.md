# TabFlow whole-product upstream adoption matrix

Research snapshot: 2026-09-05. Repositories are sorted by GitHub stars (descending) inside the relevant product set. Stars are a discovery/ranking signal only; architectural fit, license, maintenance status and browser constraints decide whether a pattern is adopted.

## Ranked product/codebase references

| Rank | Repository | Stars (snapshot) | License/status | TabFlow relevance | Decision |
|---:|---|---:|---|---|---|
| 1 | microsoft/vscode | 190,898 | MIT | Workbench, split/grid views, state ownership, compact command/status UI | ADOPT concepts |
| 2 | open-webui/open-webui | 151,025 | custom/other | Chat message DAG, forks, context compaction checkpoints, RAG, tool/runtime state | ADOPT architecture concepts only |
| 3 | ChatGPTNextWeb/NextChat | 88,714 | MIT | Session memory prompt, token stats, summarize checkpoint index, clear-context boundary | ADOPT memory/session concepts |
| 4 | OpenHands/OpenHands | 86,246 | MIT | Long-running developer tasks, event/runtime architecture, agent/workspace boundaries | REFERENCE; defer agent runtime |
| 5 | lobehub/lobehub | 82,248 | custom/other | Session/topic/run separation, explicit operation ownership/status, persistence | ADOPT domain-state concepts only |
| 6 | gorhill/uBlock | 67,585 | GPL-3.0 | Extremely disciplined browser-extension hot paths and event-driven work | ADOPT principles only; copy no GPL code |
| 7 | cline/cline | 67,514 | Apache-2.0 | Developer task checkpoints, auto context compaction, restore semantics | ADOPT continuity/checkpoint model |
| 8 | Mintplex-Labs/anything-llm | 65,650 | MIT | Workspace-scoped RAG, pinned sources, vector retrieval, source/citation separation | ADOPT context compiler tiers |
| 9 | CherryHQ/cherry-studio | 51,473 | AGPL-3.0 | Multi-model desktop chat UX, knowledge/workspace product patterns | REFERENCE concepts only |
| 10 | Aider-AI/aider | 48,767 | Apache-2.0 | Token-budgeted repo map, tree-sitter symbols, file/identifier ranking, cache fallback | ADOPT structural-context model |
| 11 | danny-avila/LibreChat | 42,840 | MIT | Message branches, resumable streams/jobs, reconnect state and E2E coverage | ADOPT runtime-state concepts |
| 12 | chatboxai/chatbox | 41,656 | GPL-3.0 | Mature AI-client conversation/product UX | REFERENCE concepts only |
| 13 | continuedev/continue | 35,773 | Apache-2.0 | IDE context providers, developer workflows, model/tool boundaries | REFERENCE for project context |
| 14 | RooCodeInc/Roo-Code | 24,310 | Apache-2.0; archived snapshot | Multi-agent developer UX/modes | HISTORICAL REFERENCE; do not build on archived code |
| 15 | ChatGPTBox-dev/chatGPTBox | 10,757 | MIT | Deep browser ChatGPT integration; MV3 background/content/service separation | ADOPT extension-structure lessons selectively |

General extension/workbench references remain in `docs/RESEARCH-ADOPTIONS.md`: Refined GitHub, Dark Reader, Chrome extension samples, MetaMask, WXT, Plasmo, react-resizable-panels and Sidebery.

## What the implementations teach TabFlow

### 1. Conversation is a graph, not an array

Open WebUI stores message identity with `parentId`, `childrenIds` and a `currentId`. LibreChat likewise treats `parentMessageId` and regenerated responses as branch-sensitive state. TabFlow already receives ChatGPT's native DAG in `/backend-api/conversation/<id>`; therefore the long-term local model must preserve graph identity instead of flattening everything into prose chunks.

Adoption contract:

- retain immutable source message IDs;
- retain parent/child links and active branch head;
- index the active branch for normal RAG, while preserving sibling branches for provenance/history;
- conversation rollover links conversations (`CONTINUES_AS`) rather than pretending a new ChatGPT conversation is the same server object;
- branch/regenerate operations must never overwrite sibling evidence.

The pure graph/checkpoint primitives now live in `memory/continuity.js`. DB migration is deliberately staged behind recovery tests instead of being mixed into the current workbench change.

### 2. Continuity is a checkpoint, not “last N messages”

Open WebUI's context compaction preserves decisions, user constraints, files/artifacts/tool results, current task, unresolved questions and next steps, and stores the summary against a checkpoint message. NextChat tracks `memoryPrompt`, token stats and `lastSummarizeIndex`. Cline auto-compacts near the context limit and combines that with restorable checkpoints.

TabFlow checkpoint contract:

- `projectId`, `conversationId`, `checkpointMessageId`;
- previous checkpoint link;
- factual summary (optional until a summarizer is available);
- authoritative user constraints and accepted decisions;
- relevant files/artifacts;
- current task, unresolved items and next steps;
- a small recent tail;
- provenance to original message/conversation IDs.

`memory/continuity.js` implements the deterministic data shape and formatter now. Automatic ChatGPT rollover remains a later browser-E2E milestone; it must consume this checkpoint rather than copying arbitrary recent messages.

### 3. Context must be compiled under explicit budgets

AnythingLLM separates workspace history, pinned docs, parsed files and vector-search context. Aider assigns an explicit token budget to a structural repo map and boosts mentioned files/identifiers. This is stronger than letting the highest-scoring BM25 chunks consume every remaining token.

TabFlow context tiers are now standardized by `memory/context-compiler.js`:

1. `authority` — explicit user constraints/accepted hard decisions;
2. `continuity` — checkpoint/current task state;
3. `profile` — project stack/rules;
4. `structural` — compact repo/file/symbol map;
5. `retrieval` — full BM25/code/prose evidence.

The compiler reserves a normalized share for each tier, then spills unused capacity to remaining evidence. This ensures retrieval cannot starve constraints/continuity while still using the full budget when a tier is empty. Structural candidates aggregate file path/language/symbol data so the model sees a cheap repository map before expensive code chunks.

Context sent to the model and citations shown to the user are separate concepts. A context item may support reasoning without being presented as a fresh citation; visible citations must describe the evidence actually surfaced for the current request.

### 4. Running work needs explicit operation ownership

LobeHub separates topic/session data from the operation currently owning that topic and has explicit live/parked states plus stale-operation backstops. LibreChat reconstructs resumable generation state and treats the running job's aggregated content as authoritative when persisted chat text can be stale.

TabFlow runtime contract:

- tab/document identity is not generation identity;
- `typing`, `generating`, `waiting`, `idle`, `stale/error` are explicit states, not guesses from last-access time;
- productive states are protected from discard;
- missing UI signals never immediately mean “generation finished”;
- stale protection expires through heartbeat/TTL logic;
- future shared operations need `operationId`, `conversationId`, `projectId`, owner and timestamps.

Because ChatGPT's private server stream is not TabFlow's server job, these patterns are used for local state correctness only; TabFlow must not claim it can resume a server generation unless the upstream page/API actually supports it.

### 5. Browser hot paths must be fail-safe and idempotency-aware

uBlock Origin and Dark Reader reinforce that extension performance comes from avoiding unnecessary work, using event-driven scheduling and throttling visual updates. TabFlow already uses adaptive runtime modes and requestAnimationFrame-throttled splitter writes.

A whole-repo transport rule is now explicit: **automatic network replay is allowed only for safe/idempotent methods**. `content-scripts/fetch-proxy.js` no longer retries POST/other mutating ChatGPT requests on HTTP 429 or network failure. This prevents an optimization layer from duplicating a future mutation endpoint if ChatGPT changes request semantics.

### 6. Feature modules, not one giant extension script

Refined GitHub, WXT and mature extension projects show the value of explicit entry/module boundaries. ChatGPTBox also separates background, content scripts, services, components and pages rather than turning one content script into the product.

TabFlow direction:

- service worker = lifecycle/control plane;
- MAIN-world bridges = minimal request/page integration only;
- isolated content scripts = page sensors/adapters + small UI overlays;
- offscreen/worker = heavy indexing/retrieval;
- workspace = workbench presentation/orchestration;
- `memory/*` = pure policies/data access where possible;
- future site-specific DOM selectors belong behind a ChatGPT adapter rather than spreading across the codebase.

A WXT/Plasmo/React migration is still deferred. The current vanilla build is not the user-facing bottleneck, and framework migration would create risk without solving workspace performance or continuity.

## Adoption status by TabFlow subsystem

| TabFlow subsystem | Upstream patterns | Current status |
|---|---|---|
| Unified Workspace | VS Code, react-resizable-panels, Sidebery | ACTIVE — workbench/MAIN/Spotlight/splitter/persistence |
| Browser performance/runtime | uBlock Origin, Dark Reader, Chrome samples | ACTIVE — N-tab states, safe discard, throttled UI, safe retry rule |
| Project RAG | AnythingLLM, Aider, Continue | ACTIVE/STAGED — BM25 active; tier compiler + structural candidates added, deeper repo-map integration next |
| Conversation memory | Open WebUI, NextChat, Cline | STAGED — continuity/checkpoint kernel added; persistent DAG/checkpoint DB migration requires recovery tests |
| Stream/reconnect state | LibreChat, LobeHub | PARTIAL — local productive-state protection active; durable operation identity is next architecture migration |
| Multi-agent developer workflow | OpenHands, Cline, LobeHub/Roo | DEFER — do not restart until workspace/runtime/continuity are stable |
| Extension build system | WXT, Plasmo, ChatGPTBox | DEFER — preserve current MV3 build during active product milestones |

## License rule

Popularity never overrides licensing. MIT/Apache implementations may be studied and, where appropriate, adapted with license obligations respected. GPL/AGPL/custom-license repositories are treated as architecture/product references unless a deliberate compatible licensing decision is made. No code from uBlock Origin, Chatbox, Cherry Studio or other incompatible sources is copied into TabFlow by default.

## Engineering gate for every future adoption

A pattern is not considered “adopted” because it appears in this document. For each migration:

1. identify the TabFlow failure/invariant it addresses;
2. cite the upstream implementation or test that motivated the pattern;
3. implement it behind a small module/contract where possible;
4. add deterministic unit/verification coverage;
5. run repository quality gates;
6. browser-E2E the real ChatGPT workload;
7. only then remove/replace the old path.

This prevents repository popularity from turning TabFlow into a pile of unrelated abstractions.
