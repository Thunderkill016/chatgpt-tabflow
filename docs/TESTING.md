# TabFlow Testing

TabFlow uses three release gates.

## 1. Static/unit quality gate

```bash
npm run quality
```

This runs deterministic unit/invariant tests, manifest/package verification and the release-readiness audit. Coverage includes memory, context compilation, runtime protection, workspace layout/security, submit safety, React-owned DOM safety, Capture Studio codec policy and social-profile limits.

## 2. Chromium unpacked-extension E2E

```bash
npm run browser:e2e
```

The harness launches Chromium with the real unpacked extension and deterministic fixtures. For Workspace tests it maps `chatgpt.com` to a local HTTPS fixture so the production manifest match patterns, MV3 service worker, offscreen memory host, session DNR rules, frame bridge, fetch wrappers, runtime probe and IndexedDB memory all execute through the real extension path.

Automated browser gates include:

1. Workspace iframe security and scoped DNR.
2. Focus/Sync/resize document stability while a response streams.
3. Cross-pane Local Project Memory/RAG injection.
4. New Workspace chat project inheritance.
5. One trusted submit produces one mutating conversation POST; no replay.
6. Historical archive cannot overwrite newer live VFS evidence.
7. A live generating top-level ChatGPT tab cannot be discarded.
8. A non-Workspace page cannot inherit the Workspace frame-policy exception.
9. Workspace tab-specific Side Panel disable policy.
10. Control Center smoke navigation and Workspace launch.
11. Capture Studio standalone PNG screenshot.
12. Capture Studio MediaRecorder record → pause → resume → stop.
13. Actual capture resolution reporting (no fake 4K label for a lower-resolution source).
14. Social profile policy unit coverage for H.264/AAC MP4 and X non-Premium limits.

CI uploads browser artifacts for inspection when available.

## 3. Production canary

Automation cannot reproduce every real ChatGPT DOM/API change, OS screen picker, GPU/driver combination or authenticated account behavior. Before a release, use one short production canary to detect upstream/browser/hardware drift.

The production canary is a final compatibility check, not a replacement for the automated gates.

## Release-readiness audit

```bash
npm run release:audit
```

The audit verifies version alignment, Chrome minimum version, permission/host scope, manifest file references, removal of global static frame-stripping rules, absence of unsupported performance claims on current user-facing surfaces, Capture Studio local-only networking boundary and inclusion of the audit in the main quality gate.
