# TabFlow upstream research adoptions

Research snapshot: 2026-09-05. Star counts are approximate and used only to rank mature public codebases; architecture fit matters more than popularity.

| Rank | Repository | Approx. stars | Why it matters to TabFlow | Decision |
|---:|---|---:|---|---|
| 1 | microsoft/vscode | 186k | Workbench/grid/split-view model, compact command/status chrome, persistent workspace layout | ADOPT concepts |
| 2 | gorhill/uBlock | 67k | Browser-extension hot-path discipline, event-driven work, low-allocation performance mindset | ADOPT concepts only; GPL code is not copied |
| 3 | refined-github/refined-github | 31.8k | Small independently-scoped feature modules instead of one giant content/workspace script | ADOPT module boundary pattern |
| 4 | darkreader/darkreader | 22k | Cancellable/throttled DOM work and lifecycle-aware observers | ADOPT frame-throttled UI updates |
| 5 | GoogleChrome/chrome-extensions-samples | 17.7k | Official MV3 lifecycle, messaging, storage and Chrome API usage | REFERENCE for platform correctness |
| 6 | MetaMask/metamask-extension | 13.2k | Controller/UI separation and explicit state ownership at large extension scale | ADOPT selectively |
| 7 | PlasmoHQ/plasmo | 13.1k | Browser-extension build/entrypoint ergonomics | DEFER framework migration |
| 8 | wxt-dev/wxt | 10.3k | File-based entrypoints, MV3-aware build model, isolated build groups | DEFER full migration; adopt entrypoint separation ideas |
| 9 | bvaughn/react-resizable-panels | 5.3k | Resizable panel math, persisted layouts, keyboard-accessible separators | ADOPT now |
| 10 | mbnuqw/sidebery | 4.6k | Dense tab/panel workspace UX, snapshots, panel-first navigation | REFERENCE for future tab UX |

## Applied in the current workspace milestone

### Workbench layout instead of equal tiles
TabFlow keeps a semantic `MAIN` pane and a Spotlight 2+1 layout for three active chats. This follows the workbench idea used by IDEs: one primary work surface plus secondary surfaces, rather than treating every pane as equally important.

### Resizable Spotlight splitter
`workspace/spotlight-layout.js` owns pure resize policy and constraints. `workspace/spotlight-resize.js` owns the interaction feature. The separator:

- uses `role="separator"` and ARIA value attributes;
- supports pointer drag;
- supports ArrowLeft/ArrowRight, Home/End and Enter reset;
- persists the primary-pane ratio;
- guarantees a minimum secondary-pane width;
- frame-throttles pointer updates with `requestAnimationFrame`;
- disables iframe pointer events only while dragging so embedded ChatGPT frames cannot swallow the drag gesture.

### Feature isolation
The splitter is intentionally not added to the already-large `workspace/workspace.js`. It is an independent entry module loaded by the workspace page. New workspace capabilities should follow this shape when possible: small feature module + pure policy module + focused tests.

### Performance rule
UI input handlers may write already-known geometry to CSS, but should not synchronously read layout (`getBoundingClientRect`, `offset*`, `getComputedStyle`) in hot paths. Existing CI verifies this invariant for the new workspace modules.

## Explicitly not adopted yet

- No WXT/Plasmo migration during the active workspace milestone. A build-system rewrite would add risk without fixing the current user-facing bottleneck.
- No React rewrite just to use `react-resizable-panels`; the useful interaction and accessibility principles are implemented in the existing vanilla architecture.
- No code copied from uBlock Origin. Only general performance principles are used because its repository is GPL-licensed while TabFlow has a different licensing context.
- No additional agent/filesystem subsystem until the Unified Workspace UX and browser performance are stable on real workloads.
