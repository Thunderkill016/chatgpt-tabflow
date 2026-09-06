import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(root, rel));
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));

let failed = false;
function check(condition, message) {
  if (condition) console.log(`  ✅ ${message}`);
  else {
    failed = true;
    console.error(`  ❌ ${message}`);
  }
}

console.log('🚦 TabFlow v3.2 release-readiness audit');

check(manifest.manifest_version === 3, 'Manifest V3');
check(manifest.version === pkg.version, `manifest/package version agree (${manifest.version})`);
check(/^3\.2\.\d+$/.test(manifest.version), 'release version is on the 3.2.x line');
check(Number(manifest.minimum_chrome_version) >= 116, 'minimum Chrome is 116+ for chrome.sidePanel.open()');
check(pkg.license === 'MIT', 'package metadata declares MIT');
check(exists('LICENSE') && /MIT License/.test(read('LICENSE')), 'MIT LICENSE file exists');

const requiredPermissions = [
  'tabs', 'storage', 'alarms', 'sidePanel', 'tabGroups',
  'declarativeNetRequest', 'offscreen', 'unlimitedStorage', 'system.memory', 'downloads'
];
for (const permission of requiredPermissions) {
  check(manifest.permissions?.includes(permission), `permission justified and declared: ${permission}`);
}

const allowedHosts = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
check(JSON.stringify([...(manifest.host_permissions || [])].sort()) === JSON.stringify([...allowedHosts].sort()), 'host permissions are limited to ChatGPT domains');
check(!manifest.declarative_net_request, 'no global static DNR ruleset is enabled');
check(!exists('rules/rules.json'), 'legacy global CSP/XFO stripping rules are absent');

const manifestFiles = new Set([
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.side_panel?.default_path,
  manifest.options_ui?.page,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {})
].filter(Boolean));
for (const entry of manifest.content_scripts || []) {
  for (const file of entry.js || []) manifestFiles.add(file);
  for (const file of entry.css || []) manifestFiles.add(file);
}
for (const file of manifestFiles) check(exists(file), `manifest reference exists: ${file}`);

const popup = read('popup/popup.html') + '\n' + read('popup/popup.js');
const options = read('options/options.html');
const readme = read('README.md');
const lifecycle = read('service-worker.js');

const forbiddenClaims = [
  /RAM đã dọn/i,
  /tiết kiệm\s+\d+\s*(?:MB|GB)/i,
  /giải phóng\s+85-90%/i,
  /giảm\s+~?85%/i,
  /0ms/i,
  /0\.3s/i,
  /100% ngữ cảnh/i,
  /giảm giật lag 100%/i,
  /2 đến 4 phiên ChatGPT/i
];
for (const pattern of forbiddenClaims) {
  check(!pattern.test(`${popup}\n${options}\n${readme}`), `user-facing surfaces avoid unsupported claim ${pattern}`);
}

check(popup.includes('Unified Workspace'), 'popup launches Unified Workspace');
check(popup.includes('Control Center'), 'popup launches Control Center');
check(popup.includes('Capture Studio'), 'popup launches Capture Studio');
check(!popup.includes('estimatedMbSaved') && !popup.includes('freedMb'), 'popup does not expose estimated RAM savings');
check(!lifecycle.includes('estimatedMbSaved') && !lifecycle.includes('freedMb') && !lifecycle.includes('ESTIMATED_SAVINGS_PER_TAB_MB'), 'lifecycle contract has no invented per-tab RAM estimate');
check(!lifecycle.includes("case 'TILE_WINDOWS'"), 'obsolete fixed-resolution Tile Windows message is removed');
check(options.includes('Runtime bảo vệ'), 'settings explain productive-tab protection');
check(readme.includes('Chrome **116 or newer**'), 'README documents the real browser floor');
check(readme.includes('does **not** claim a fixed number of megabytes saved per tab'), 'README explicitly rejects fake per-tab RAM accounting');

const recorder = read('recorder/recorder.js') + '\n' + read('recorder/screenshot-controller.js');
check(!/\bfetch\s*\(/.test(recorder), 'Capture Studio has no network upload path');

const qualityScript = String(pkg.scripts?.quality || '');
check(qualityScript.includes('release:audit'), 'npm run quality includes release-readiness audit');
check(String(pkg.scripts?.['release:package'] || '').includes('package-release.mjs'), 'release package command is wired');

if (failed) process.exitCode = 1;
else console.log('🏁 Release-readiness audit passed');
