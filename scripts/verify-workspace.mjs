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

console.log('🖥️ Verifying TabFlow v3.2.1 remote unified workspace...');

const manifest = JSON.parse(read('manifest.json'));
const workspace = read('workspace/workspace.js');
const layout = read('workspace/layout.js');
const html = read('workspace/index.html');
const remoteAgent = read('content-scripts/workspace-remote-agent.js');

check(manifest.version === '3.2.1', 'manifest is v3.2.1');
check(!manifest.permissions.includes('declarativeNetRequest'), 'workspace no longer strips site framing headers');
check(!manifest.declarative_net_request, 'obsolete iframe DNR rules are not registered');
const isolated = manifest.content_scripts.find(item => item.world !== 'MAIN' && item.js?.includes('content-scripts/runtime-agent.js'));
check(isolated?.js?.includes('content-scripts/workspace-remote-agent.js'), 'remote workspace agent registered in top-level ChatGPT tabs');
check(!manifest.content_scripts.some(item => item.js?.includes('content-scripts/workspace-frame-bridge.js')), 'iframe frame bridge removed from active manifest path');

check(html.includes('Unified Chat Workspace'), 'workspace remains the primary unified screen');
check(html.includes('v3.2.1'), 'workspace visibly identifies remote-console release');
check(!/<iframe\b/i.test(html), 'workspace contains zero ChatGPT iframes');
check(html.includes('pane-transcript'), 'workspace renders lightweight transcript mirrors');
check(html.includes('pane-input'), 'each pane has a local remote composer');
check(html.includes('btn-sleep-idle'), 'workspace can hibernate idle source tabs');

check(workspace.includes("chrome.tabs.connect(tabId, { name: REMOTE_PORT_NAME })"), 'workspace uses tabs.connect to each source tab');
check(workspace.includes("'COMMAND_SEND'"), 'workspace can send prompts to a source tab');
check(workspace.includes("'COMMAND_STOP'"), 'workspace can stop an active generation');
check(workspace.includes("type: 'GET_TABS_DATA'"), 'workspace discovers real ChatGPT tabs');
check(workspace.includes("type: 'DISCARD_ALL_BACKGROUND'"), 'workspace reuses protected idle-tab hibernation');
check(workspace.includes('computeGrid('), 'workspace keeps adaptive N-pane layout policy');
check(!workspace.includes('getBoundingClientRect('), 'workspace layout avoids forced geometry reads');
check(!workspace.includes('panes.length >= 4'), 'no four-pane hard cap');
check(!workspace.includes('.slice(0, 2)'), 'no destructive two-pane slicing');
check(!workspace.includes('.slice(0, 3)'), 'no three-pane cap');
check(!/\binnerHTML\b/.test(workspace), 'workspace avoids dynamic innerHTML injection');

check(remoteAgent.includes("const PORT_NAME = 'TABFLOW_WORKSPACE_REMOTE'"), 'remote agent exposes a dedicated Port protocol');
check(remoteAgent.includes('collectMessages()'), 'remote agent mirrors conversation transcript');
check(remoteAgent.includes('submitPrompt('), 'remote agent supports same-screen prompt submission');
check(remoteAgent.includes('hasConversationLimit()'), 'remote agent detects conversation-limit rollover boundary');
check(remoteAgent.includes("error.code = 'CONVERSATION_LIMIT'"), 'remote agent refuses unsafe send after conversation limit');
check(remoteAgent.includes('ports.size === 0'), 'remote DOM observer does no mirror work without workspace subscribers');

for (const rel of ['workspace/workspace.js', 'workspace/layout.js', 'content-scripts/workspace-remote-agent.js']) {
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
