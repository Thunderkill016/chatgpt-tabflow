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

console.log('🔬 Verifying Workspace document-stability diagnostics...');

const bridge = read('content-scripts/workspace-frame-bridge.js');
const core = read('workspace/diagnostics.js');
const ui = read('workspace/workspace-diagnostics-ui.js');
const bootstrap = read('workspace/frame-policy-bootstrap.js');

check(bridge.includes('documentToken'), 'frame bridge emits a per-document token');
check(bridge.includes('crypto?.randomUUID'), 'document token uses browser randomness when available');
check(bridge.includes('generationActive: hasGenerationControl()'), 'frame bridge reports generation without layout reads');
check(bridge.includes("window.name === WORKSPACE_FRAME_NAME"), 'diagnostic bridge is scoped to marked workspace frames');
check(core.includes('unexpectedRemounts'), 'diagnostic core distinguishes unexpected document remounts');
check(core.includes('expectedDocumentChangeUntil'), 'explicit reload has a bounded expectation window');
check(core.includes('spaNavigations'), 'SPA navigation is tracked separately from document replacement');
check(ui.includes("event.data?.type !== 'TABFLOW_WORKSPACE_FRAME_STATE'"), 'workspace UI only consumes frame-state messages');
check(ui.includes('frame.contentWindow !== source'), 'frame state is bound to the actual source WindowProxy');
check(ui.includes('tabflowDocumentToken'), 'per-pane document token is exposed as diagnostic dataset');
check(ui.includes("closest('.btn-reload')"), 'explicit pane reload is marked before navigation');
check(bootstrap.includes("import('./workspace-diagnostics-ui.js').catch"), 'diagnostics are non-blocking after secure workspace bootstrap');

for (const rel of [
  'content-scripts/workspace-frame-bridge.js',
  'workspace/diagnostics.js',
  'workspace/workspace-diagnostics-ui.js',
  'workspace/frame-policy-bootstrap.js'
]) {
  const source = read(rel);
  check(!/\beval\s*\(/.test(source), `${rel}: no eval()`);
  check(!/\bnew\s+Function\s*\(/.test(source), `${rel}: no new Function()`);
  check(!/\binnerText\b/.test(source), `${rel}: no innerText`);
  check(!/\bgetComputedStyle\s*\(/.test(source), `${rel}: no getComputedStyle`);
  check(!/getBoundingClientRect\s*\(/.test(source), `${rel}: no rect layout read`);
  check(!/\.offset(?:Height|Width|Top|Left|Parent)\b/.test(source), `${rel}: no offset layout read`);
  const syntax = spawnSync(process.execPath, ['--check', path.join(root, rel)], { encoding: 'utf8' });
  check(syntax.status === 0, `${rel}: node --check`);
  if (syntax.status !== 0) console.error(syntax.stderr || syntax.stdout);
}

const unit = spawnSync(process.execPath, [path.join(root, 'test/workspace-diagnostics.test.mjs')], { encoding: 'utf8' });
check(unit.status === 0, 'workspace diagnostics unit tests pass');
if (unit.status !== 0) console.error(unit.stderr || unit.stdout);

console.log(`\n🏁 Workspace diagnostics verification: ${passed}/${total} checks passed`);
if (passed !== total) process.exitCode = 1;
