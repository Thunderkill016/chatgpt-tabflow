import assert from 'node:assert/strict';
import {
  isTabFlowWorkspaceUrl,
  applyWorkspaceSidePanelPolicy
} from '../workspace/sidepanel-policy-background.js';

const extensionOrigin = 'chrome-extension://tabflow-test/';
const getURL = path => `${extensionOrigin}${path}`;

assert.equal(
  isTabFlowWorkspaceUrl(`${extensionOrigin}workspace/index.html`, getURL),
  true,
  'exact workspace URL is recognized'
);
assert.equal(
  isTabFlowWorkspaceUrl(`${extensionOrigin}workspace/index.html?density=compact`, getURL),
  true,
  'workspace query URL is recognized'
);
assert.equal(
  isTabFlowWorkspaceUrl(`${extensionOrigin}workspace/index.html#pane-2`, getURL),
  true,
  'workspace hash URL is recognized'
);
assert.equal(
  isTabFlowWorkspaceUrl(`${extensionOrigin}v3/sidepanel.html`, getURL),
  false,
  'side panel itself is not treated as workspace'
);
assert.equal(
  isTabFlowWorkspaceUrl('https://chatgpt.com/c/example', getURL),
  false,
  'normal ChatGPT tabs remain side-panel eligible'
);

const calls = [];
const api = {
  runtime: { getURL },
  sidePanel: {
    async setOptions(options) {
      calls.push(options);
    }
  }
};

assert.equal(
  await applyWorkspaceSidePanelPolicy({ id: 42, url: `${extensionOrigin}workspace/index.html` }, api),
  true,
  'workspace tab policy is applied'
);
assert.deepEqual(
  calls,
  [{ tabId: 42, enabled: false }],
  'workspace tab disables only its own side panel'
);

calls.length = 0;
assert.equal(
  await applyWorkspaceSidePanelPolicy({ id: 43, url: 'https://chatgpt.com/c/example' }, api),
  false,
  'normal ChatGPT tab does not receive a disabling override'
);
assert.deepEqual(calls, [], 'normal ChatGPT tab leaves side panel untouched');

assert.equal(
  await applyWorkspaceSidePanelPolicy({ id: 0, url: `${extensionOrigin}workspace/index.html` }, api),
  false,
  'invalid tab ids fail closed'
);
assert.equal(
  await applyWorkspaceSidePanelPolicy({ id: 44, pendingUrl: `${extensionOrigin}workspace/index.html` }, api),
  true,
  'pending workspace URL is handled during tab creation'
);

console.log('✅ workspace side-panel policy tests passed');
