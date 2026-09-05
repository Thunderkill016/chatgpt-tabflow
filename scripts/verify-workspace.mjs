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

console.log('🖥️ Verifying TabFlow unified N-pane workspace UI/UX...');

const manifest = JSON.parse(read('manifest.json'));
const workspace = read('workspace/workspace.js');
const layout = read('workspace/layout.js');
const spotlightLayout = read('workspace/spotlight-layout.js');
const spotlightResize = read('workspace/spotlight-resize.js');
const html = read('workspace/index.html');
const css = read('workspace/workspace.css');
const spotlightCss = read('workspace/spotlight-resize.css');
const bridge = read('content-scripts/workspace-frame-bridge.js');
const framePolicy = read('workspace/frame-policy.js');
const framePolicyChrome = read('workspace/frame-policy-chrome.js');
const framePolicyBootstrap = read('workspace/frame-policy-bootstrap.js');
const framePolicyBackground = read('workspace/frame-policy-background.js');
const wrapper = read('v3/service-worker.js');

check(manifest.version === '3.2.0', 'manifest is v3.2.0');
check(manifest.permissions.includes('declarativeNetRequest'), 'workspace frame policy keeps DNR permission');
check(!manifest.declarative_net_request, 'manifest has no global static ChatGPT header-stripping ruleset');
const bridgeEntry = manifest.content_scripts.find(item => item.js?.includes('content-scripts/workspace-frame-bridge.js'));
check(Boolean(bridgeEntry), 'workspace frame bridge registered');
check(bridgeEntry?.all_frames === true, 'workspace frame bridge runs in embedded ChatGPT frames');
check(html.includes('TabFlow Workspace'), 'compact workspace command bar present');
check(html.includes('id="btn-sync-tabs"'), 'workspace exposes real-tab sync');
check(html.includes('id="btn-takeover"'), 'workspace exposes safe takeover');
check(html.includes('id="btn-focus-primary"'), 'workspace exposes first-class primary focus action');
check(html.includes('id="status-primary"'), 'workspace exposes compact bottom status bar');
check(html.includes('role="separator"'), 'spotlight splitter is keyboard-accessible separator');
check(html.includes('frame-policy-bootstrap.js'), 'secure frame policy bootstraps before workspace modules');
check(!html.includes('src="workspace.js"'), 'workspace does not create iframes before frame policy is ready');
check(framePolicyBootstrap.indexOf('ensureWorkspaceFramePolicyForCurrentTab') < framePolicyBootstrap.indexOf("import('./workspace.js')"), 'frame policy resolves before workspace iframe code imports');
check(framePolicy.includes('tabIds: normalized'), 'header override is scoped to explicit workspace tab ids');
check(framePolicy.includes("resourceTypes: ['sub_frame']"), 'header override is scoped to subframes');
check(framePolicy.includes("requestDomains: [...WORKSPACE_FRAME_REQUEST_DOMAINS]"), 'header override is scoped to ChatGPT request domains');
check(!framePolicy.includes('urlFilter'), 'frame rule avoids broad URL-filter scope');
check(framePolicyChrome.includes('updateSessionRules'), 'workspace uses session-scoped DNR rules');
check(framePolicyChrome.includes('removeRuleIds: [WORKSPACE_FRAME_RULE_ID]'), 'session policy atomically replaces the reserved rule');
check(framePolicyBackground.includes('chrome.tabs.onRemoved.addListener'), 'closed workspace tabs trigger frame-policy cleanup');
check(framePolicyBackground.includes('queueSync().catch'), 'service-worker restart reconciles workspace frame policy');
check(wrapper.includes("workspace/frame-policy-background.js"), 'v3 service worker imports frame-policy lifecycle cleanup');
check(workspace.includes("type: 'GET_TABS_DATA'"), 'workspace imports real open ChatGPT tabs');
check(workspace.includes("type: 'DISCARD_TAB'"), 'takeover can hibernate original tabs');
check(workspace.includes('primaryPaneId'), 'workspace persists a primary working pane');
check(workspace.includes('computeGrid('), 'workspace uses adaptive N-pane layout policy');
check(workspace.includes('grid.mode'), 'workspace consumes semantic layout mode');
check(workspace.includes('paneElementById'), 'workspace reconciles stable pane elements');
check(workspace.includes('if (!paneEl) {'), 'existing pane browsing contexts are preserved during sync');
check(!workspace.includes('getBoundingClientRect'), 'workspace avoids layout-forcing rect reads');
check(!workspace.includes('panes.length >= 4'), 'no four-pane hard cap');
check(!workspace.includes('.slice(0, 2)'), 'no destructive two-pane slicing');
check(!workspace.includes('.slice(0, 3)'), 'no three-pane cap');
check(!/\binnerHTML\b/.test(workspace), 'workspace avoids dynamic innerHTML injection');
check(!/on(?:click|change|input|load)\s*=/.test(html), 'workspace HTML has no inline handlers');
check(layout.includes("'spotlight-3'"), 'layout policy has asymmetric three-pane spotlight mode');
check(css.includes('[data-layout="spotlight-3"]'), 'base CSS implements asymmetric three-pane spotlight layout');
check(css.includes('@container'), 'pane actions compact with container queries');
check(spotlightCss.includes('--spotlight-primary-width'), 'resizable spotlight CSS uses persisted primary width');
check(spotlightCss.includes('body.workspace-resizing iframe'), 'iframe pointer capture is protected during splitter drag');
check(spotlightLayout.includes('SPOTLIGHT_SECONDARY_MIN_PX'), 'spotlight ratio policy preserves secondary minimum width');
check(spotlightResize.includes('requestAnimationFrame'), 'splitter pointer updates are frame-throttled');
check(spotlightResize.includes('ArrowLeft') && spotlightResize.includes('ArrowRight'), 'splitter supports keyboard resizing');
check(bridge.includes('TABFLOW_WORKSPACE_FRAME_STATE'), 'frame bridge reports SPA URL/title state');
check(bridge.includes('TABFLOW_WORKSPACE_FOCUS_COMPOSER'), 'frame bridge supports focused-pane composer handoff');

for (const rel of [
  'workspace/workspace.js',
  'workspace/layout.js',
  'workspace/spotlight-layout.js',
  'workspace/spotlight-resize.js',
  'workspace/frame-policy.js',
  'workspace/frame-policy-chrome.js',
  'workspace/frame-policy-bootstrap.js',
  'workspace/frame-policy-background.js',
  'content-scripts/workspace-frame-bridge.js'
]) {
  const source = read(rel);
  check(!/\beval\s*\(/.test(source), `${rel}: no eval()`);
  check(!/\bnew\s+Function\s*\(/.test(source), `${rel}: no new Function()`);
  check(!/\binnerText\b/.test(source), `${rel}: no innerText`);
  check(!/\bgetComputedStyle\s*\(/.test(source), `${rel}: no forced style read`);
  check(!/\.offset(?:Height|Width|Top|Left|Parent)\b/.test(source), `${rel}: no offset* forced-layout read`);
  check(!/getBoundingClientRect\s*\(/.test(source), `${rel}: no rect forced-layout read`);
  const syntax = spawnSync(process.execPath, ['--check', path.join(root, rel)], { encoding: 'utf8' });
  check(syntax.status === 0, `${rel}: node --check`);
  if (syntax.status !== 0) console.error(syntax.stderr || syntax.stdout);
}

const layoutUnit = spawnSync(process.execPath, [path.join(root, 'test/workspace-layout.test.mjs')], { encoding: 'utf8' });
check(layoutUnit.status === 0, 'adaptive workspace layout unit tests pass');
if (layoutUnit.status !== 0) console.error(layoutUnit.stderr || layoutUnit.stdout);

const framePolicyUnit = spawnSync(process.execPath, [path.join(root, 'test/workspace-frame-policy.test.mjs')], { encoding: 'utf8' });
check(framePolicyUnit.status === 0, 'workspace frame-policy unit tests pass');
if (framePolicyUnit.status !== 0) console.error(framePolicyUnit.stderr || framePolicyUnit.stdout);

console.log(`\n🏁 Workspace verification: ${passed}/${total} checks passed`);
if (passed !== total) process.exitCode = 1;
