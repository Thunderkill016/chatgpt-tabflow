import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridgePath = path.join(root, 'content-scripts', 'memory-fetch-bridge.js');
const proxyPath = path.join(root, 'content-scripts', 'fetch-proxy.js');
const bridge = fs.readFileSync(bridgePath, 'utf8');
const proxy = fs.readFileSync(proxyPath, 'utf8');
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

console.log('📨 Verifying non-idempotent submit safety...');

check(bridge.includes('SUBMIT_DEDUPE_MS'), 'conversation POST dedupe remains bounded');
check(bridge.includes('const response = await existing.promise'), 'only a real duplicate shares the in-flight POST');
check(bridge.includes('return response.clone()'), 'duplicate caller receives an independent response body');
check(!bridge.includes('entry.snapshot'), 'normal POST path never keeps an unread response snapshot');
check(!bridge.includes('snapshot: null'), 'submit cache has no pre-emptive streaming clone slot');
check(bridge.includes('if (submitCache.get(key) === entry) submitCache.delete(key)'), 'in-flight dedupe entry is removed when fetch headers settle');
check(proxy.includes("const retrySafe = method === 'GET' || method === 'HEAD'"), 'Turbo retry allowlist is limited to idempotent GET/HEAD');
check(proxy.includes('const maxRetries = retrySafe ? 3 : 0'), 'mutating methods receive zero automatic retries');
check(proxy.includes('if (!retrySafe || attempt >= maxRetries) throw err'), 'network-error retry path fails through for mutating methods');

for (const [rel, file] of [
  ['content-scripts/memory-fetch-bridge.js', bridgePath],
  ['content-scripts/fetch-proxy.js', proxyPath]
]) {
  const source = fs.readFileSync(file, 'utf8');
  check(!/\beval\s*\(/.test(source), `${rel}: no eval()`);
  check(!/\bnew\s+Function\s*\(/.test(source), `${rel}: no new Function()`);
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  check(syntax.status === 0, `${rel}: node --check`);
  if (syntax.status !== 0) console.error(syntax.stderr || syntax.stdout);
}

console.log(`\n🏁 Submit safety verification: ${passed}/${total} checks passed`);
if (passed !== total) process.exitCode = 1;
