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
check(manifest.version === '3.1.1', 'manifest is v3.1.1');
check(manifest.permissions.includes('system.memory'), 'system.memory permission declared');
check(manifest.permissions.includes('storage'), 'storage permission declared');
check(manifest.permissions.includes('tabs'), 'tabs permission declared');

const isolated = manifest.content_scripts.find(item => item.world !== 'MAIN');
check(isolated?.js?.includes('content-scripts/runtime-agent.js'), 'runtime agent injected in isolated world');
check(isolated?.js?.indexOf('content-scripts/runtime-agent.js') < isolated?.js?.indexOf('content-scripts/booster.js'), 'runtime agent loads before booster');

const wrapper = read('v3/service-worker.js');
check(wrapper.includes("runtime/coordinator.js"), 'v3 service worker imports runtime coordinator');

const legacyWorker = read('service-worker.js');
check(legacyWorker.includes("runtime/protection.js"), 'legacy lifecycle uses runtime discard protection');
check(legacyWorker.includes('canDiscardRuntimeTab'), 'discard paths consult runtime protection state');

const sidepanel = read('v3/sidepanel.html');
const sidepanelRuntime = read('v3/sidepanel-runtime.js');
const coordinator = read('runtime/coordinator.js');
const agent = read('content-scripts/runtime-agent.js');
const protection = read('runtime/protection.js');

check(sidepanel.includes('ADAPTIVE N-TAB RUNTIME'), 'side panel clearly exposes N-tab runtime');
check(sidepanel.includes('Gắn tất cả tab ChatGPT'), 'workspace action binds all ChatGPT tabs');
check(!sidepanel.includes('3 tab, 1 project'), 'UI is not hard-coded to 3 tabs');
check(!sidepanelRuntime.includes('.slice(0, 3)'), 'side panel does not truncate workspace to 3 tabs');
check(!coordinator.includes('Math.min(2, Number(patch.maxParallelGenerators'), 'coordinator no longer hard caps configured target at 2');
check(coordinator.includes('liveTabCount'), 'coordinator tracks dynamic connected tab count');
check(coordinator.includes('connectedEntries'), 'coordinator distinguishes connected renderers');
check(protection.includes('if (!entry) return false'), 'unknown runtime state fails safe against discard');
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
  'v3/sidepanel-runtime.js'
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

const test = spawnSync(process.execPath, [path.join(root, 'test/runtime-policy.test.mjs')], { encoding: 'utf8' });
check(test.status === 0, 'runtime policy unit tests pass');
if (test.status !== 0) console.error(test.stderr || test.stdout);

console.log(`\n🏁 Runtime verification: ${passed}/${total} checks passed`);
if (passed !== total) process.exitCode = 1;
