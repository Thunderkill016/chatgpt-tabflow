# TabFlow Testing

TabFlow uses two CI layers.

## 1. Static/unit quality gate

`npm run quality` covers deterministic unit/invariant checks for memory, context compilation, runtime protection, workspace layout/security, submit safety, diagnostics, and React-owned DOM safety.

## 2. Chromium extension E2E

`npm run browser:e2e` launches Chromium with the real unpacked extension and a deterministic HTTPS ChatGPT fixture. CI maps `chatgpt.com` to the local fixture so the production manifest/content-script match patterns, MV3 service worker, offscreen memory host, session DNR rules, frame bridge, fetch wrappers, runtime probe, IndexedDB memory and Workspace all execute as they do in Chromium.

The fixture intentionally sends `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`. Only the TabFlow Workspace session DNR exception should allow those ChatGPT frames.

Automated browser gates:

1. Workspace iframe security and scoped DNR.
2. Focus/Sync/resize document stability while a response is streaming.
3. Cross-pane Local Project Memory/RAG injection.
4. New Workspace chat project inheritance.
5. One trusted submit produces one mutating conversation POST; no replay.
6. Historical archive cannot overwrite newer live VFS evidence.
7. A live generating top-level ChatGPT tab cannot be discarded.
8. A non-Workspace page cannot inherit the Workspace frame-policy exception.

CI uploads `artifacts/browser-e2e/report.json` plus a Workspace screenshot for every run.

This harness removes routine manual gate testing. A real authenticated ChatGPT canary is still useful for upstream OpenAI DOM/API changes that a deterministic fixture cannot predict; it is not a substitute for the automated gates above.
