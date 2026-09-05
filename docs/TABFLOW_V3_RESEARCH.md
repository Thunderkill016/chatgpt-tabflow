# TabFlow v3 — Browser/AI Research Ledger (Wave 1)

This document records the browser contracts used by v3 so architecture decisions do not depend on assumptions about Manifest V3.

## 1. Service-worker lifecycle

Chrome can terminate an extension service worker after roughly 30 seconds of inactivity. Durable project state therefore lives in IndexedDB / chrome.storage, not globals. Long-lived Port creation alone is not used as a keepalive strategy; actual Port traffic wakes/resets lifecycle timers as needed.

Source: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

## 2. Offscreen compute host

`chrome.offscreen` is available to MV3 extensions from Chrome 109. `WORKERS` is an explicit supported reason for an offscreen document that needs to spawn workers. The offscreen document exposes only `chrome.runtime`, which is why TabFlow uses a Port to the service worker and a dedicated module Worker for indexing/retrieval.

Source: https://developer.chrome.com/docs/extensions/reference/api/offscreen

## 3. Local filesystem roadmap

File System Access handles are serializable and can be stored in IndexedDB. Permissions must still be checked with `queryPermission()` and, where needed, renewed with `requestPermission()` from a user gesture. Pillar 2 will keep handles in extension-origin storage and never pass them into ChatGPT page context.

Source: https://developer.chrome.com/docs/capabilities/web-apis/file-system-access

## 4. Built-in local AI roadmap

Chrome's Prompt API is available to Chrome Extensions, but as of the 2026-08-26 documentation it is not available in Web Workers. TabFlow therefore treats Gemini Nano as an optional extension-document coprocessor for decision distillation/reranking, not as the mandatory retrieval engine.

Source: https://developer.chrome.com/docs/ai/prompt-api

## 5. WebMCP roadmap

WebMCP is still experimental/origin-trial territory in 2026. It is tracked as a future adapter for exposing TabFlow project tools to agents, but it is not part of the core persistence/runtime contract.

Source: https://developer.chrome.com/docs/ai/webmcp/imperative-api

## Wave-1 consequence

The production baseline is intentionally dependency-light:

- extension service worker = control plane;
- `runtime.Port` = memory RPC bus;
- offscreen document = stable worker host;
- dedicated Worker = indexing/retrieval compute;
- IndexedDB = durable project memory;
- BM25 + path/symbol boosts = deterministic retrieval baseline;
- MAIN-world fetch bridge = exact-fingerprint RAG injection without mutating React's editor;
- visible Side Panel Memory inspector = operational observability.
