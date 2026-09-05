import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let total = 0;

function check(condition, label) {
  total += 1;
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    console.error(`  ❌ ${label}`);
    process.exitCode = 1;
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

console.log('🧠 Verifying TabFlow v3 Cognitive Memory Wave 1...\n');

const required = [
  'memory/text.js',
  'memory/db.js',
  'memory/bm25.js',
  'memory/context-compiler.js',
  'memory/continuity.js',
  'memory/versioning.js',
  'memory/binding-identity.js',
  'memory/workspace-inheritance.js',
  'memory/memory-background.js',
  'workers/memory-worker.js',
  'offscreen/memory.html',
  'offscreen/memory-host.js',
  'content-scripts/frame-scope-gate.js',
  'content-scripts/memory-fetch-bridge.js',
  'content-scripts/memory-client.js',
  'v3/service-worker.js',
  'v3/sidepanel.html',
  'v3/sidepanel-controller.js',
  'v3/sidepanel-control.css',
  'v3/sidepanel-memory.js',
  'v3/sidepanel-memory.css',
  'test/memory-core.test.mjs',
  'test/memory-binding-identity.test.mjs',
  'test/context-compiler.test.mjs',
  'test/continuity.test.mjs'
];
for (const rel of required) check(fs.existsSync(path.join(root, rel)) && fs.statSync(path.join(root, rel)).size > 20, `${rel} exists`);

const manifest = JSON.parse(read('manifest.json'));
check(manifest.manifest_version === 3, 'Manifest remains MV3');
check(Number(manifest.minimum_chrome_version) >= 109, 'Chrome baseline supports offscreen documents and documentId actor identity');
check(manifest.permissions.includes('offscreen'), 'offscreen permission declared');
check(manifest.permissions.includes('unlimitedStorage'), 'unlimitedStorage declared for local IndexedDB corpus');
check(manifest.background?.service_worker === 'v3/service-worker.js', 'v3 wrapper service worker is active');
check(manifest.side_panel?.default_path === 'v3/sidepanel.html', 'Cognitive Memory side panel is active');

const mainEntry = manifest.content_scripts.find(item => item.world === 'MAIN');
const memoryEntry = manifest.content_scripts.find(item => item.world !== 'MAIN' && item.js?.includes('content-scripts/memory-client.js'));
const topUiEntry = manifest.content_scripts.find(item => item.js?.includes('content-scripts/runtime-agent.js') || item.js?.includes('content-scripts/booster.js'));
const mainScripts = mainEntry?.js || [];
check(mainScripts.indexOf('content-scripts/memory-fetch-bridge.js') >= 0, 'MAIN-world RAG bridge registered');
check(mainScripts.indexOf('content-scripts/memory-fetch-bridge.js') < mainScripts.indexOf('content-scripts/fetch-proxy.js'), 'Memory bridge wraps native fetch before Turbo Loader');
check(mainEntry?.all_frames === true, 'MAIN-world memory/fetch layer runs inside ChatGPT workspace subframes');
check(memoryEntry?.all_frames === true, 'Isolated memory client runs inside ChatGPT workspace subframes');
check(mainEntry?.js?.[0] === 'content-scripts/frame-scope-gate.js', 'MAIN hooks fail closed through frame scope gate');
check(memoryEntry?.js?.[0] === 'content-scripts/frame-scope-gate.js', 'isolated memory fails closed through frame scope gate');
check(topUiEntry?.all_frames !== true, 'runtime/booster remain top-frame only until frame-aware scheduler migration');
check(!memoryEntry?.js?.includes('content-scripts/runtime-agent.js'), 'frame-aware memory entry does not accidentally enable tab-keyed runtime in subframes');
check(!memoryEntry?.js?.includes('content-scripts/booster.js'), 'workspace panes do not duplicate top-level booster UI');

const background = read('memory/memory-background.js');
const identity = read('memory/binding-identity.js');
check(background.includes("chrome.runtime.onConnect.addListener"), 'Memory transport uses runtime.Port actor channel');
check(background.includes("reasons: ['WORKERS']"), 'Offscreen document uses official WORKERS reason');
check(!background.includes('chrome.runtime.onMessage.addListener'), 'Memory background avoids competing with legacy onMessage router');
check(background.includes('chrome.tabs.onRemoved.addListener'), 'Transient actor bindings are cleaned on tab close');
check(background.includes('senderDocumentId(port)'), 'Memory binding resolves MV3 sender document identity');
check(background.includes('memoryActorKey(tabId, frameId, documentId)'), 'Memory background keys subframe actors by tab/frame/document');
check(background.includes("source: 'workspace-default'"), 'new workspace panes inherit the selected common project only through background policy');
check(identity.includes("if (frame === 0) return `${tabId}:0`"), 'Top-frame project binding survives document reloads');
check(identity.includes('`${tabId}:${frame}:${doc}`'), 'Subframe binding includes documentId when available');
check(identity.includes('frameId === 0 ? [actor, String(tabId)] : [actor]'), 'Legacy tab-only binding is inherited only by top frame');

const bridge = read('content-scripts/memory-fetch-bridge.js');
check(bridge.includes('responseArchiveMeta'), 'Full-DAG archive piggybacks on existing JSON parse');
check(bridge.includes('submitCache'), 'Non-idempotent prompt submission shield enabled');
check(bridge.includes('SUBMIT_DEDUPE_MS'), 'Prompt replay protection has bounded lifetime');
check(bridge.includes('fingerprint !== prepared.fingerprint'), 'RAG injection is fingerprint-bound to current prompt');
check(bridge.includes('sourceTime * 1000 : 1'), 'Unknown archive timestamps remain older than live DOM observations');

const client = read('content-scripts/memory-client.js');
check(client.includes("chrome.runtime.connect({ name: PORT_NAME })"), 'Content client uses long-lived Port RPC');
check(client.includes('TABFLOW_MEMORY_CLIENT_STATUS'), 'Side panel can inspect live RAG state');
check(client.includes('TABFLOW_MEMORY_FORCE_SYNC'), 'Side panel can trigger manual sync');

const worker = read('workers/memory-worker.js');
const staleGuardIndex = worker.indexOf('isStaleObservation(existingMessageEvidence, observedAt)');
const destructiveReplaceIndex = worker.indexOf('removeChunksForMessage(projectId, sourceMessageId, existingMessageEvidence)');
check(worker.includes("from '../memory/versioning.js'"), 'Memory worker uses shared observation-version policy');
check(staleGuardIndex >= 0 && destructiveReplaceIndex > staleGuardIndex, 'Stale observation guard runs before destructive message replacement');
check(worker.includes('monotonicObservedAt(existingUpdatedAt, observedAt, observedAt)'), 'VFS timestamps cannot regress on older archives');
check(worker.includes('skippedStale'), 'Archive ingest reports skipped stale observations');

const panel = read('v3/sidepanel.html');
check(panel.includes('id="tab-nav-memory"'), 'Visible Memory navigation exists');
check(panel.includes('id="memory-files-list"') && panel.includes('id="memory-file-preview"'), 'Visible VFS inspector exists');
check(panel.includes('id="memory-decisions-list"'), 'Visible decision log exists');
check(panel.includes('id="memory-rag-state"') && panel.includes('id="memory-rag-citations"'), 'Visible RAG inspector exists');

const forbiddenFiles = required.filter(rel => rel.endsWith('.js') || rel.endsWith('.mjs'));
for (const rel of forbiddenFiles) {
  const source = read(rel);
  check(!/\beval\s*\(/.test(source), `${rel}: no eval()`);
  check(!/\bnew\s+Function\s*\(/.test(source), `${rel}: no new Function()`);
  check(!/\binnerText\b/.test(source), `${rel}: no innerText`);
  check(!/getComputedStyle\s*\(/.test(source), `${rel}: no getComputedStyle()`);
  check(!/\.offset(?:Height|Width|Top|Left|Parent)\b/.test(source), `${rel}: no offset* layout reads`);
}

console.log(`\nMemory verification: ${passed}/${total} checks passed.`);
if (passed !== total) process.exitCode = 1;
