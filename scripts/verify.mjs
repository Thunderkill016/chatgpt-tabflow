import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(rootDir, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(rootDir, rel));
const manifest = JSON.parse(read('manifest.json'));

let totalChecks = 0;
let passedChecks = 0;
function check(condition, message) {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  ✅ ${message}`);
  } else {
    process.exitCode = 1;
    console.error(`  ❌ ${message}`);
  }
}

console.log('🔍 Verifying TabFlow MV3 package...');

check(manifest.manifest_version === 3, 'Manifest V3');
check(Number(manifest.minimum_chrome_version) >= 116, 'Chrome floor supports Side Panel open API');
for (const permission of ['tabs', 'storage', 'alarms', 'sidePanel', 'tabGroups', 'declarativeNetRequest', 'offscreen', 'unlimitedStorage', 'system.memory', 'downloads']) {
  check(manifest.permissions?.includes(permission), `permission declared: ${permission}`);
}
check(!manifest.declarative_net_request, 'no global static DNR ruleset');
check(!exists('rules/rules.json'), 'legacy static frame-stripping rules removed');

const runtimeRefs = new Set([
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.side_panel?.default_path,
  manifest.options_ui?.page,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {})
].filter(Boolean));
for (const entry of manifest.content_scripts || []) {
  for (const rel of entry.js || []) runtimeRefs.add(rel);
  for (const rel of entry.css || []) runtimeRefs.add(rel);
}
for (const rel of runtimeRefs) check(exists(rel), `manifest reference exists: ${rel}`);

for (const [size, rel] of Object.entries(manifest.icons || {})) {
  const abs = path.join(rootDir, rel);
  const stat = fs.existsSync(abs) ? fs.statSync(abs) : null;
  check(Boolean(stat && stat.size > 100), `icon ${size}px is non-empty`);
}

for (const rel of [manifest.action.default_popup, manifest.side_panel.default_path, manifest.options_ui.page, 'workspace/index.html', 'recorder/index.html']) {
  const html = read(rel);
  check(!/on(?:click|load|change|submit|input)\s*=/i.test(html), `no inline event handler: ${rel}`);
}

for (const rel of [
  manifest.background.service_worker,
  'service-worker.js',
  'popup/popup.js',
  'options/options.js',
  'v3/sidepanel-controller.js',
  'workspace/workspace.js',
  'recorder/recorder.js'
]) {
  const js = read(rel);
  check(!/\beval\s*\(/.test(js) && !/\bnew\s+Function\s*\(/.test(js), `no dynamic code execution: ${rel}`);
}

const framePolicy = read('workspace/frame-policy.js');
const framePolicyChrome = read('workspace/frame-policy-chrome.js');
check(framePolicy.includes('tabIds: normalized'), 'Workspace frame policy is tab-scoped');
check(framePolicy.includes("resourceTypes: ['sub_frame']"), 'Workspace frame policy is subframe-scoped');
check(framePolicyChrome.includes('updateSessionRules'), 'Workspace frame policy uses session DNR');

console.log(`🏁 Core verification: ${passedChecks}/${totalChecks} checks passed`);
