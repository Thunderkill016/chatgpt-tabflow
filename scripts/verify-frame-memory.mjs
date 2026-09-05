import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let total = 0;

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

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

console.log('🧩 Verifying frame-scoped Workspace Memory...');

const manifest = JSON.parse(read('manifest.json'));
const gate = read('content-scripts/frame-scope-gate.js');
const workspaceHtml = read('workspace/index.html');
const background = read('memory/memory-background.js');
const inheritance = read('memory/workspace-inheritance.js');

const mainMemory = manifest.content_scripts.find(item =>
  item.world === 'MAIN' && item.js?.includes('content-scripts/memory-fetch-bridge.js')
);
const isolatedMemory = manifest.content_scripts.find(item =>
  item.world !== 'MAIN' && item.js?.includes('content-scripts/memory-client.js')
);
const runtime = manifest.content_scripts.find(item => item.js?.includes('content-scripts/runtime-agent.js'));

check(mainMemory?.all_frames === true, 'MAIN memory/fetch hooks are available to workspace ChatGPT frames');
check(mainMemory?.js?.[0] === 'content-scripts/frame-scope-gate.js', 'MAIN frame scope gate runs before fetch hooks');
check(isolatedMemory?.all_frames === true, 'isolated memory client is available to workspace ChatGPT frames');
check(isolatedMemory?.js?.[0] === 'content-scripts/frame-scope-gate.js', 'isolated frame scope gate runs before memory client');
check(runtime?.all_frames !== true, 'runtime scheduler remains top-frame-only until actor migration');
check(workspaceHtml.includes('name="tabflow-workspace-pane"'), 'workspace iframe carries an explicit scope marker before navigation');

check(gate.includes("window.name === WORKSPACE_FRAME_NAME"), 'frame gate requires the workspace browsing-context marker');
check(gate.includes("chrome-extension://"), 'MAIN-world fallback requires an extension parent origin');
check(gate.includes('__tabflowMemoryFetchBridgeInstalled = true'), 'unauthorized frames fail closed before memory fetch bridge');
check(gate.includes('__tabflowProxyInstalled = true'), 'unauthorized frames fail closed before Turbo fetch proxy');
check(gate.includes('__tabflowMemoryClientInstalled = true'), 'unauthorized frames fail closed before DOM memory client');

check(background.includes("from './workspace-inheritance.js'"), 'memory background uses explicit workspace inheritance policy');
check(background.includes("source: 'workspace-default'"), 'new workspace actors can inherit the selected common project');
check(background.includes('identity.fromSender'), 'workspace inheritance requires an identity proven by MessageSender');
check(background.includes('const senderTabId = port?.sender?.tab?.id'), 'content actors derive tab identity from MessageSender');
check(background.indexOf('const senderTabId = port?.sender?.tab?.id') < background.indexOf('Number.isInteger(payload.tabId)'), 'MessageSender identity wins over caller-supplied actor ids');
check(inheritance.includes('isWorkspaceTabUrl'), 'inheritance verifies the parent is the real TabFlow workspace URL');
check(inheritance.includes('isChatGptDocumentUrl'), 'inheritance is limited to ChatGPT child documents');
check(inheritance.includes("projects.find"), 'workspace project must still exist in Project Vault');

for (const rel of [
  'content-scripts/frame-scope-gate.js',
  'memory/workspace-inheritance.js',
  'memory/memory-background.js'
]) {
  const source = read(rel);
  check(!/\beval\s*\(/.test(source), `${rel}: no eval()`);
  check(!/\bnew\s+Function\s*\(/.test(source), `${rel}: no new Function()`);
  check(!/\binnerText\b/.test(source), `${rel}: no innerText`);
  check(!/\bgetComputedStyle\s*\(/.test(source), `${rel}: no getComputedStyle`);
  check(!/\.offset(?:Height|Width|Top|Left|Parent)\b/.test(source), `${rel}: no forced-layout offset reads`);
  const syntax = spawnSync(process.execPath, ['--check', path.join(root, rel)], { encoding: 'utf8' });
  check(syntax.status === 0, `${rel}: node --check`);
  if (syntax.status !== 0) console.error(syntax.stderr || syntax.stdout);
}

console.log(`\n🏁 Frame-scoped memory verification: ${passed}/${total} checks passed`);
if (passed !== total) process.exitCode = 1;
