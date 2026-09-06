import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isChatGptUrl } from '../service-worker.js';

console.log('🧪 TabFlow core smoke tests');

assert.equal(isChatGptUrl('https://chatgpt.com/c/678a-1234'), true);
assert.equal(isChatGptUrl('https://chatgpt.com/'), true);
assert.equal(isChatGptUrl('https://chat.openai.com/g/g-abc-custom-gpt'), true);
assert.equal(isChatGptUrl('https://google.com/search?q=chatgpt'), false);
assert.equal(isChatGptUrl('https://fake-chatgpt.com/'), false);
assert.equal(isChatGptUrl(''), false);
assert.equal(isChatGptUrl(null), false);
assert.equal(isChatGptUrl(undefined), false);

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(manifest.manifest_version, 3, 'Manifest V3');
assert.equal(manifest.version, pkg.version, 'manifest/package versions stay aligned');
assert.ok(Number(manifest.minimum_chrome_version) >= 116, 'Chrome floor supports sidePanel.open');
assert.deepEqual(
  [...manifest.host_permissions].sort(),
  ['https://chat.openai.com/*', 'https://chatgpt.com/*'].sort(),
  'host permissions stay scoped to ChatGPT'
);
assert.equal(Boolean(manifest.declarative_net_request), false, 'no static global DNR ruleset');

console.log('✅ TabFlow core smoke tests passed');
