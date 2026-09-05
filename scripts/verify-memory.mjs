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
  'memory/memory-background.js',
  'workers/memory-worker.js',
  'offscreen/memory.html',
  'offscreen/memory-host.js',
  'content-scripts/memory-fetch-bridge.js',
  'content-scripts/memory-client.js',
  'v3/service-worker.js',
  'v3/sidepanel.html',
  'v3/sidepanel-memory.js',
  'v3/sidepanel-memory.css',
  'test/memory-core.test.mjs'
];
for (const rel of required) check(fs.existsSync(path.join(root, rel)) && fs.statSync(path.join(root, rel)).size > 20, `${rel} exists`);

const manifest = JSON.parse(read('manifest.json'));
check(manifest.manifest_version === 3, 'Manifest remains MV3');
check(Number(manifest.minimum_chrome_version) >= 109, 'Chrome baseline supports offscreen documents');
check(manifest.permissions.includes('offscreen'), 'offscreen permission declared');
check(manifest.permissions.includes('unlimitedStorage'), 'unlimitedStorage declared for local IndexedDB corpus');
check(manifest.background?.service_worker === 'v3/service-worker.js', 'v3 wrapper service worker is active');
check(manifest.side_panel?.default_path === 'v3/sidepanel.html', 'Cognitive Memory side panel is active');

const mainScripts = manifest.content_scripts.find(item => item.world === 'MAIN')?.js || [];
const isolatedScripts = manifest.content_scripts.find(item => item.world !== 'MAIN')?.js || [];
check(mainScripts.indexOf('content-scripts/memory-fetch-bridge.js') >= 0, 'MAIN-world RAG bridge registered');
check(mainScripts.indexOf('content-scripts/memory-fetch-bridge.js') < mainScripts.indexOf('content-scripts/fetch-proxy.js'), 'Memory bridge wraps native fetch before Turbo Loader');
check(isolatedScripts.indexOf('content-scripts/memory-client.js') >= 0, 'Isolated memory client registered');
check(isolatedScripts.indexOf('content-scripts/memory-client.js') < isolatedScripts.indexOf('content-scripts/booster.js'), 'Memory client loads before UI booster');

const background = read('memory/memory-background.js');
check(background.includes("chrome.runtime.onConnect.addListener"), 'Memory transport uses runtime.Port actor channel');
check(background.includes("reasons: ['WORKERS']"), 'Offscreen document uses official WORKERS reason');
check(!background.includes('chrome.runtime.onMessage.addListener'), 'Memory background avoids competing with legacy onMessage router');
check(background.includes('chrome.tabs.onRemoved.addListener'), 'Transient tab bindings are cleaned on tab close');

const bridge = read('content-scripts/memory-fetch-bridge.js');
check(bridge.includes('responseArchiveMeta'), 'Full-DAG archive piggybacks on existing JSON parse');
check(bridge.includes('submitCache'), 'Non-idempotent prompt submission shield enabled');
check(bridge.includes('SUBMIT_DEDUPE_MS'), 'Prompt replay protection has bounded lifetime');
check(bridge.includes('fingerprint !== prepared.fingerprint'), 'RAG injection is fingerprint-bound to current prompt');

const client = read('content-scripts/memory-client.js');
check(client.includes("chrome.runtime.connect({ name: PORT_NAME })"), 'Content client uses long-lived Port RPC');
check(client.includes('TABFLOW_MEMORY_CLIENT_STATUS'), 'Side panel can inspect live RAG state');
check(client.includes('TABFLOW_MEMORY_FORCE_SYNC'), 'Side panel can trigger manual sync');

const panel = read('v3/sidepanel.html');
check(panel.includes('id="tab-nav-memory"'), 'Visible Memory navigation exists');
check(panel.includes('Virtual Project Filesystem'), 'Visible VFS inspector exists');
check(panel.includes('Architecture Decisions'), 'Visible decision log exists');
check(panel.includes('Prompt Context Compiler'), 'Visible RAG inspector exists');

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
