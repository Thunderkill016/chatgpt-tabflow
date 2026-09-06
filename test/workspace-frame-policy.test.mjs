import assert from 'node:assert/strict';
import {
  WORKSPACE_FRAME_RULE_ID,
  WORKSPACE_FRAME_REQUEST_DOMAINS,
  buildWorkspaceFrameRule,
  isWorkspaceTabUrl,
  normalizeTabIds
} from '../workspace/frame-policy.js';

assert.deepEqual(normalizeTabIds([9, 2, 9, -1, '4', null]), [2, 4, 9]);
assert.deepEqual(normalizeTabIds(null), []);

const workspaceUrl = 'chrome-extension://abc/workspace/index.html';
assert.equal(isWorkspaceTabUrl(workspaceUrl, workspaceUrl), true);
assert.equal(isWorkspaceTabUrl(`${workspaceUrl}?x=1#focus`, workspaceUrl), true);
assert.equal(isWorkspaceTabUrl('chrome-extension://abc/workspace/other.html', workspaceUrl), false);
assert.equal(isWorkspaceTabUrl('https://chatgpt.com/', workspaceUrl), false);

assert.equal(buildWorkspaceFrameRule([]), null, 'no workspace tabs means no header override rule');

const rule = buildWorkspaceFrameRule([42, 7, 42]);
assert.equal(rule.id, WORKSPACE_FRAME_RULE_ID);
assert.equal(rule.action.type, 'modifyHeaders');
assert.deepEqual(rule.condition.tabIds, [7, 42]);
assert.deepEqual(rule.condition.resourceTypes, ['sub_frame']);
assert.deepEqual(rule.condition.requestDomains, [...WORKSPACE_FRAME_REQUEST_DOMAINS]);
assert.equal('urlFilter' in rule.condition, false, 'policy is domain + tab scoped, not a global URL filter');
assert.deepEqual(
  rule.action.responseHeaders.map(item => [item.header, item.operation]),
  [
    ['x-frame-options', 'remove'],
    ['content-security-policy', 'remove']
  ]
);

console.log('✅ workspace-frame-policy.test.mjs passed');
