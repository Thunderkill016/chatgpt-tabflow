# TabFlow v3 — Cooperative Multi-Tab Runtime

## Problem observed on real workload

Three ChatGPT tabs can be logically related but Chromium still executes them as independent renderer workloads. Each tab may run React reconciliation, streaming DOM updates, timers, observers, syntax-highlight/code UI, and TabFlow maintenance at the same time. The legacy auto-discard policy only checks Chrome `tab.lastAccessed`, so a background tab that is still generating can be misclassified as idle and discarded, interrupting an in-flight answer.

## Runtime contract

TabFlow v3 treats each ChatGPT tab as an actor in one cooperative workspace.

States reported by a content-side runtime agent:

- `interactive`: visible/focused and usable by the developer.
- `typing`: prompt editor is receiving user input.
- `generating`: an answer is in progress.
- `idle`: no interactive or generation work is active.

The background coordinator assigns an execution mode:

- `interactive`: full extension UX for the foreground tab.
- `producer`: generation is in progress; never discard.
- `eco`: hidden idle actor; suspend TabFlow periodic maintenance.
- `strained`: generation is already in progress while concurrency exceeds the safe budget; keep the network task alive but disable non-essential extension work.

## Safety invariants

1. Never call `chrome.tabs.discard()` for a tab reported as `typing` or `generating`.
2. A freshly submitted prompt is protected for a grace window even before generation detection converges.
3. Manual Turbo Freeze follows the same safety guard; it must not kill in-flight answers.
4. The coordinator persists runtime state in `chrome.storage.session`; correctness does not depend on service-worker globals surviving.
5. Physical memory pressure is read through `chrome.system.memory.getInfo()`. It only adjusts scheduling policy; it never terminates a generation already in progress.
6. The extension does not attempt to keep three full renderers equally busy forever. Cooperative mode defaults to at most two concurrent generators under normal memory conditions and one under pressure. All three tabs can remain members of the same project/agent workspace.

## Why this is different from opening three independent tabs

The three tabs share a project memory binding and role map (Architect / Implementer / Reviewer), while the runtime continuously de-prioritizes idle actors and prevents destructive hibernation of productive actors. This preserves logical concurrency without forcing all renderers to do maximum UI work simultaneously.
