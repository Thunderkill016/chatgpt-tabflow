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

console.log('⚙️ Verifying TabFlow cooperative multi-tab runtime...');

const manifest = JSON.parse(read('manifest.json'));
check(manifest.version === '3.1.0', 'manifest is v3.1.0');
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
check(legacyWorker.includes('canDiscardRuntimeTab'), 'all discard entry points can consult protection state');

const sidepanel = read('v3/sidepanel.html');
check(sidepanel.includes('tab-nav-runtime'), 'side panel exposes Co-op navigation');
check(sidepanel.includes('runtime-start-btn'), 'side panel exposes cooperative workspace action');
check(sidepanel.includes('sidepanel-runtime.js'), 'runtime controller loaded');

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
