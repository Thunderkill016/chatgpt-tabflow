import fs from 'node:fs';

const html = fs.readFileSync('v3/sidepanel.html', 'utf8');
const controller = fs.readFileSync('v3/sidepanel-controller.js', 'utf8');
const css = fs.readFileSync('v3/sidepanel-control.css', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(html.includes('sidepanel-controller.js'), 'v3 side panel must use the Control Center controller');
assert(html.includes('sidepanel-control.css'), 'v3 side panel must load Control Center styles');
assert(!html.includes('../sidepanel/index.js'), 'legacy dashboard controller must not be loaded by v3 side panel');
assert(!html.includes('RAM TIẾT KIỆM'), 'side panel must not present estimated RAM saved as a product metric');
assert(!html.includes('stat-ram-saved'), 'legacy estimated-RAM stat card must not return');
assert(html.includes('Mở Unified Workspace'), 'Unified Workspace must remain the primary side-panel action');
assert(html.includes('Chat hiện tại'), 'current ChatGPT context must be visible before management tools');

for (const id of [
  'tab-nav-active', 'tab-nav-memory', 'tab-nav-runtime', 'tab-nav-stashed', 'tab-nav-projects',
  'active-tabs-view', 'memory-view', 'runtime-view', 'stashed-sessions-view', 'projects-vault-view',
  'memory-project-select', 'memory-bind-btn', 'runtime-project-select', 'runtime-start-btn'
]) {
  assert(html.includes(`id="${id}"`), `missing required side-panel integration node: ${id}`);
}

assert(!controller.includes('estimatedMbSaved'), 'Control Center must not expose fake exact RAM-saved estimates');
assert(!controller.includes('freedMb'), 'Control Center must not turn per-tab estimates into exact freed-RAM claims');
assert(controller.includes('discardedCount'), 'idle-sleep action must report actual successful discard count');
assert(controller.includes('protectedCount'), 'idle-sleep action must explain protected productive chats');
assert(controller.includes("chrome.runtime.getManifest().version"), 'version badge must come from the loaded manifest');
assert(controller.includes("TABFLOW_MEMORY_CLIENT_STATUS"), 'current-chat card must surface real Memory binding state');
assert(controller.includes("RUNTIME_GET_STATE"), 'Control Center summary must use real runtime state');
assert(css.includes('.control-current'), 'Control Center current-chat surface missing');
assert(css.includes('.control-workspace-btn'), 'Control Center workspace CTA missing');

console.log('sidepanel-control verification passed');
