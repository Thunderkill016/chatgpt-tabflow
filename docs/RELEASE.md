# TabFlow v3.2 Release Checklist

This checklist freezes the v3.2 scope. Do not add new product subsystems while this release is being closed.

## Automated gates

- [ ] `npm run quality`
- [ ] `npm run browser:e2e`
- [ ] `npm run release:package`
- [ ] release ZIP artifact exists and is non-empty
- [ ] PR is mergeable and has no unresolved review blocker

## Product surfaces

- [ ] Toolbar popup uses v3 wording and real counts; no estimated per-tab RAM claim
- [ ] Control Center opens and exposes Chats / Memory / Runtime / Sessions / Projects
- [ ] Unified Workspace loads the current ChatGPT tabs and keeps unchanged panes stable through Focus / Sync / resize
- [ ] Side Panel is disabled only on the Workspace tab
- [ ] Project Memory/RAG works across Workspace panes
- [ ] Runtime protects typing/generating top-level ChatGPT tabs from discard
- [ ] Capture Studio record / pause / resume / stop and PNG capture pass Chromium E2E
- [ ] Social Ready policy refuses to claim H.264/AAC compatibility when the browser cannot expose that MediaRecorder combination

## Security / privacy

- [ ] host permissions are limited to ChatGPT domains
- [ ] no global static CSP/XFO stripping ruleset
- [ ] Workspace frame override is session + tab + subframe scoped
- [ ] no automatic retry for mutating conversation requests
- [ ] Capture Studio has no upload/fetch path
- [ ] no `eval()` / `new Function()` in production paths checked by CI

## Release metadata

- [ ] `manifest.json` and `package.json` versions match
- [ ] minimum Chrome version reflects Side Panel API requirements
- [ ] README describes the current product without unsupported benchmark claims
- [ ] MIT `LICENSE` exists and is included in the release ZIP

## Production canary

This is the only gate that cannot be made fully deterministic in CI because it depends on authenticated ChatGPT, the real OS screen picker and local GPU/driver behavior.

Short canary:

1. Reload the unpacked release candidate in Chrome 116+.
2. Open several real ChatGPT conversations and Unified Workspace.
3. Send one real prompt with Local Project Memory enabled and confirm normal streaming.
4. Focus / resize / Sync once and confirm no unexpected remount warning.
5. Record a short real screen capture, stop it, and verify the downloaded file plays.

The canary is for upstream/browser drift only. It must not replace automated tests.

## Deferred from v3.2

- persistent full conversation DAG/checkpoint migration
- seamless automatic conversation rollover
- Runtime actors for Workspace subframes
- multi-agent orchestration / handoff
- cloud upload or direct social publishing
- full video editor/transcoder

These belong to later milestones, not the v3.2 release branch.
