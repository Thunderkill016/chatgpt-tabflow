# TabFlow v3 Local Project Memory — Wave 1

## Runtime graph

```text
ChatGPT MAIN world
  memory-fetch-bridge.js
    ├─ exact-prompt RAG injection
    ├─ submit replay shield
    └─ full DAG archive hook (reuses Turbo Loader JSON parse)
          │ postMessage
ChatGPT ISOLATED world
  memory-client.js
    ├─ DOM/code sensors
    ├─ live RAG preparation
    └─ runtime.Port RPC
          │
          ▼
v3/service-worker.js
  ├─ legacy service-worker.js
  └─ memory-background.js (control plane / binding / RPC)
          │ runtime.Port
          ▼
offscreen/memory.html
  memory-host.js
          │ Worker.postMessage
          ▼
workers/memory-worker.js
  ├─ IndexedDB project graph
  ├─ VFS files
  ├─ decisions/constraints
  └─ BM25 + symbol/path retrieval
```

## IndexedDB stores

- `projects`: project profile / stack / rules.
- `conversations`: ChatGPT conversation provenance.
- `files`: virtual project filesystem with content hashes.
- `chunks`: searchable prose/code chunks.
- `decisions`: durable user constraints and architecture decisions.
- `edges`: graph relations (`CONTAINS_FILE`, `GENERATED_FILE`, `DEFINES_SYMBOL`, `HAS_CONSTRAINT`).
- `meta`: schema/runtime metadata.

## Authority model

Assistant output is evidence, never automatically authoritative. Only explicit user constraints are auto-promoted into durable `decisions` with `authority=user`.

## React safety

Automatic RAG never writes into ChatGPT's textarea/contenteditable. Retrieval completes in the isolated world; MAIN world augments the outgoing conversation POST only when the user-prompt fingerprint matches exactly.

## Performance model

No retrieval/indexing runs on ChatGPT's main thread. The page-side client only reads `textContent`, batches DOM observations, and sends bounded payloads. Search/index work runs in a dedicated extension Worker.
