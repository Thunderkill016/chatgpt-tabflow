import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

console.log('⚙️ Verifying TabFlow adaptive N-tab runtime...');

const manifest = JSON.parse(read('manifest.json'));
check(/^3\.(?:[2-9]|[1-9]\d)\./.test(manifest.version) || manifest.version === '3.1.1', 'manifest includes stable adaptive N-tab runtime');
check(manifest.permissions.includes('system.memory'), 'system.memory permission declared');
check(manifest.permissions.includes('storage'), 'storage permission declared');
check(manifest.permissions.includes('tabs'), 'tabs permission declared');

const isolated = manifest.content_scripts.find(item => item.world !== 'MAIN' && item.js?.includes('content-scripts/runtime-agent.js'));
check(isolated?.js?.includes('content-scripts/runtime-agent.js'), 'runtime agent injected in isolated world');
check(isolated?.js?.indexOf('content-scripts/runtime-agent.js') < isolated?.js?.indexOf('content-scripts/booster.js'), 'runtime agent loads before booster');

const wrapper = read('v3/service-worker.js');
check(wrapper.includes("runtime/coordinator.js"), 'v3 service worker imports runtime coordinator');

const legacyWorker = read('service-worker.js');
check(legacyWorker.includes("runtime/protection.js"), 'legacy lifecycle uses runtime discard protection');
check(legacyWorker.includes('canDiscardRuntimeTab'), 'discard paths consult runtime protection state');
check(legacyWorker.includes('autoDiscardEnabled'), 'lifecycle has a real auto-sleep setting');
check(legacyWorker.includes('discardIdleMinutes'), 'lifecycle has a real idle threshold setting');

const sidepanel = read('v3/sidepanel.html');
const sidepanelRuntime = read('v3/sidepanel-runtime.js');
const coordinator = read('runtime/coordinator.js');
const agent = read('content-scripts/runtime-agent.js');
const protection = read('runtime/protection.js');

check(sidepanel.includes('id="tab-nav-runtime"') && sidepanel.includes('id="runtime-view"'), 'side panel clearly exposes adaptive runtime');
check(sidepanel.includes('id="runtime-start-btn"') && sidepanelRuntime.includes('bindAllTabsToWorkspace'), 'project action binds all ChatGPT tabs');
check(sidepanel.includes('id="runtime-coop-toggle"') && sidepanelRuntime.includes('cooperativeEnabled: cooperativeToggle.checked'), 'automatic coordination control maps to runtime settings');
check(sidepanel.includes('id="runtime-auto-sleep-toggle"') && sidepanelRuntime.includes('autoDiscardEnabled: autoSleepToggle.checked'), 'auto-sleep control maps to real lifecycle settings');
check(sidepanel.includes('id="runtime-idle-minutes"') && sidepanelRuntime.includes('discardIdleMinutes: minutes'), 'idle threshold control maps to real lifecycle settings');
check(sidepanel.includes('id="runtime-parallel-select"') && sidepanelRuntime.includes('maxParallelGenerators: maximum'), 'parallel ceiling control maps to runtime settings');
check(sidepanel.includes('id="runtime-optimize-btn"') && sidepanelRuntime.includes("type: 'DISCARD_ALL_BACKGROUND'"), 'optimize-now action uses protected background discard path');
check(sidepanel.includes('runtime-locked') && sidepanel.includes('Luôn bật'), 'productive-chat protection is presented as a non-optional safety invariant');
check(!sidepanel.includes('Recommended budget'), 'runtime UI does not expose internal scheduler jargon');
check(!sidepanel.includes('target 1 gen') && !sidepanel.includes('target 2 gen'), 'runtime UI does not expose raw generation target jargon');
check(!sidepanelRuntime.includes('formatHeap('), 'runtime UI does not present per-tab heap as total resource truth');
check(!sidepanel.includes('3 tab, 1 project'), 'UI is not hard-coded to 3 tabs');
check(!sidepanelRuntime.includes('.slice(0, 3)'), 'side panel does not truncate workspace to 3 tabs');
check(!coordinator.includes('Math.min(2, Number(patch.maxParallelGenerators'), 'coordinator no longer hard caps configured target at 2');
check(coordinator.includes('liveTabCount'), 'coordinator tracks dynamic connected tab count');
check(coordinator.includes('connectedEntries'), 'coordinator distinguishes connected renderers');
check(protection.includes('if (!entry) return false'), 'unknown runtime state fails safe against discard');
check(protection.includes("chrome.tabs.sendMessage(tabId, { type: RUNTIME_PROBE_MESSAGE })"), 'discard protection requires a live renderer probe');
check(protection.includes('if (!live) return false'), 'missing live renderer probe fails safe against discard');
check(agent.includes('RUNTIME_PROBE_MESSAGE'), 'runtime agent exposes live discard-state probe');
check(agent.includes('GENERATION_START_GRACE_MS'), 'generation detector has startup grace window');
check(agent.includes('GENERATION_FINISH_MISSES'), 'generation detector requires stable completion');
check(!agent.includes('RUNTIME_TASK'), 'unfinished pipeline executor is absent from runtime agent');
check(!fs.existsSync(path.join(root, 'runtime', 'pipeline.js')), 'unfinished pipeline module removed');
check(!fs.existsSync(path.join(root, 'runtime', 'task-store.js')), 'unfinished task store removed');

const runtimeFiles = [
  'runtime/policy.js',
  'runtime/protection.js',
  'runtime/coordinator.js',
  'content-scripts/runtime-agent.js',
  'content-scripts/booster.js',
  'v3/sidepanel-runtime.js',
  'test/runtime-protection.test.mjs'
];

for (const rel of runtimeFiles) {
  const source = read(rel);
  check(!/\beval\s*\(/.test(source), `${rel}: no eval()`);
  check(!/\bnew\s+Function\s*\(/.test(source), `${rel}: no new Function()`);
  check(!/\binnerText\b/.test(source), `${rel}: no innerText`);
  check(!/\bgetComputedStyle\s*\(/.test(source), `${rel}: no getComputedStyle`);
  check(!/\boffset(?:Height|Width|Top|Left|Parent)\b/.test(source), `${rel}: no offset* forced-layout reads`);

  const result = spawnSync(process.execPath, ['--check', path.join(root, rel)], { encoding: 'utf8' });
  check(result.status === 0, `${rel}: node --check`);
  if (result.status !== 0) console.error(result.stderr || result.stdout);
}

const policyTest = spawnSync(process.execPath, [path.join(root, 'test/runtime-policy.test.mjs')], { encoding: 'utf8' });
check(policyTest.status === 0, 'runtime policy unit tests pass');
if (policyTest.status !== 0) console.error(policyTest.stderr || policyTest.stdout);

const protectionTest = spawnSync(process.execPath, [path.join(root, 'test/runtime-protection.test.mjs')], { encoding: 'utf8' });
check(protectionTest.status === 0, 'runtime live-probe protection tests pass');
if (protectionTest.status !== 0) console.error(protectionTest.stderr || protectionTest.stdout);

console.log(`\n🏁 Runtime verification: ${passed}/${total} checks passed`);
if (passed !== total) process.exitCode = 1;
