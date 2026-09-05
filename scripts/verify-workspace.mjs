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

console.log('🖥️ Verifying TabFlow unified N-pane workspace...');

const manifest = JSON.parse(read('manifest.json'));
const workspace = read('workspace/workspace.js');
const layout = read('workspace/layout.js');
const html = read('workspace/index.html');
const bridge = read('content-scripts/workspace-frame-bridge.js');

check(manifest.version === '3.2.0', 'manifest is v3.2.0');
const bridgeEntry = manifest.content_scripts.find(item => item.js?.includes('content-scripts/workspace-frame-bridge.js'));
check(Boolean(bridgeEntry), 'workspace frame bridge registered');
check(bridgeEntry?.all_frames === true, 'workspace frame bridge runs in embedded ChatGPT frames');
check(html.includes('Unified Chat Workspace'), 'workspace is the primary unified screen');
check(html.includes('id="btn-sync-tabs"'), 'workspace exposes real-tab sync');
check(html.includes('id="btn-takeover"'), 'workspace exposes safe takeover');
check(workspace.includes("type: 'GET_TABS_DATA'"), 'workspace imports real open ChatGPT tabs');
check(workspace.includes("type: 'DISCARD_TAB'"), 'takeover can hibernate original tabs');
check(workspace.includes('computeGrid('), 'workspace uses adaptive N-pane layout policy');
check(workspace.includes('paneElementById'), 'workspace reconciles stable pane elements');
check(workspace.includes('if (!paneEl) {'), 'existing pane browsing contexts are preserved during sync');
check(!workspace.includes('panes.length >= 4'), 'no four-pane hard cap');
check(!workspace.includes('.slice(0, 2)'), 'no destructive two-pane slicing');
check(!workspace.includes('.slice(0, 3)'), 'no three-pane cap');
check(!/\binnerHTML\b/.test(workspace), 'workspace avoids dynamic innerHTML injection');
check(!/on(?:click|change|input|load)\s*=/.test(html), 'workspace HTML has no inline handlers');
check(bridge.includes('TABFLOW_WORKSPACE_FRAME_STATE'), 'frame bridge reports SPA URL/title state');
check(bridge.includes('TABFLOW_WORKSPACE_FOCUS_COMPOSER'), 'frame bridge supports focused-pane composer handoff');

for (const rel of ['workspace/workspace.js', 'workspace/layout.js', 'content-scripts/workspace-frame-bridge.js']) {
  const source = read(rel);
  check(!/\beval\s*\(/.test(source), `${rel}: no eval()`);
  check(!/\bnew\s+Function\s*\(/.test(source), `${rel}: no new Function()`);
  check(!/\binnerText\b/.test(source), `${rel}: no innerText`);
  check(!/\bgetComputedStyle\s*\(/.test(source), `${rel}: no forced style read`);
  check(!/\.offset(?:Height|Width|Top|Left|Parent)\b/.test(source), `${rel}: no offset* forced-layout read`);
  const syntax = spawnSync(process.execPath, ['--check', path.join(root, rel)], { encoding: 'utf8' });
  check(syntax.status === 0, `${rel}: node --check`);
  if (syntax.status !== 0) console.error(syntax.stderr || syntax.stdout);
}

const unit = spawnSync(process.execPath, [path.join(root, 'test/workspace-layout.test.mjs')], { encoding: 'utf8' });
check(unit.status === 0, 'adaptive workspace layout unit tests pass');
if (unit.status !== 0) console.error(unit.stderr || unit.stdout);

console.log(`\n🏁 Workspace verification: ${passed}/${total} checks passed`);
if (passed !== total) process.exitCode = 1;
