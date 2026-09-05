/**
 * Verification Script for ChatGPT TabFlow Extension
 * Validates Manifest V3 specifications, file integrity, icon assets, and CSP/security invariants.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

let totalChecks = 0;
let passedChecks = 0;

function check(condition, message) {
  totalChecks++;
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passedChecks++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

console.log('🔍 Running ChatGPT TabFlow Extension Verification Suite...\n');

// 1. Manifest verification
const manifestPath = path.join(rootDir, 'manifest.json');
check(fs.existsSync(manifestPath), 'manifest.json exists');

let manifest = {};
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  check(manifest.manifest_version === 3, 'Manifest Version is 3 (Manifest V3)');
  check(manifest.name && manifest.version, 'Manifest has valid name and version');
  check(manifest.permissions && manifest.permissions.includes('tabs'), 'Declares tabs permission for discarding & URLs');
  check(manifest.permissions && manifest.permissions.includes('sidePanel'), 'Declares sidePanel permission');
  check(manifest.permissions && manifest.permissions.includes('storage'), 'Declares storage permission');
  check(manifest.permissions && manifest.permissions.includes('tabGroups'), 'Declares tabGroups permission');
  check(manifest.permissions && manifest.permissions.includes('declarativeNetRequest'), 'Declares DNR permission for scoped workspace session policy');
  check(!manifest.declarative_net_request, 'No global static DNR ruleset is enabled');
} catch (e) {
  check(false, `manifest.json is valid JSON: ${e.message}`);
}

// 2. Icon asset checks
if (manifest.icons) {
  for (const [size, relPath] of Object.entries(manifest.icons)) {
    const iconAbsPath = path.join(rootDir, relPath);
    const exists = fs.existsSync(iconAbsPath);
    const stats = exists ? fs.statSync(iconAbsPath) : null;
    check(exists && stats.size > 100, `Icon ${size}x${size} exists on disk (${stats ? stats.size : 0} bytes): ${relPath}`);
  }
}

// 3. Side Panel files
const sidePanelHtml = path.join(rootDir, 'sidepanel', 'index.html');
const sidePanelJs = path.join(rootDir, 'sidepanel', 'index.js');
const sidePanelCss = path.join(rootDir, 'sidepanel', 'style.css');
check(fs.existsSync(sidePanelHtml), 'Side panel HTML exists');
check(fs.existsSync(sidePanelJs), 'Side panel JS exists');
check(fs.existsSync(sidePanelCss), 'Side panel CSS exists');

// 4. Popup files
const popupHtml = path.join(rootDir, 'popup', 'popup.html');
const popupJs = path.join(rootDir, 'popup', 'popup.js');
const popupCss = path.join(rootDir, 'popup', 'popup.css');
check(fs.existsSync(popupHtml), 'Popup HTML exists');
check(fs.existsSync(popupJs), 'Popup JS exists');
check(fs.existsSync(popupCss), 'Popup CSS exists');

// 5. Options files
const optionsHtml = path.join(rootDir, 'options', 'options.html');
const optionsJs = path.join(rootDir, 'options', 'options.js');
const optionsCss = path.join(rootDir, 'options', 'options.css');
check(fs.existsSync(optionsHtml), 'Options HTML exists');
check(fs.existsSync(optionsJs), 'Options JS exists');
check(fs.existsSync(optionsCss), 'Options CSS exists');

// 6. Content Script files
const fetchProxyJs = path.join(rootDir, 'content-scripts', 'fetch-proxy.js');
const boosterJs = path.join(rootDir, 'content-scripts', 'booster.js');
const boosterCss = path.join(rootDir, 'content-scripts', 'booster.css');
check(fs.existsSync(fetchProxyJs), 'Content script fetch-proxy.js exists');
check(fs.existsSync(boosterJs), 'Content script booster.js exists');
check(fs.existsSync(boosterCss), 'Content script booster.css exists');

// 7. Background Service Worker
const swPath = path.join(rootDir, 'service-worker.js');
check(fs.existsSync(swPath), 'Background service worker exists');

// 8. Workspace frame-security policy
const legacyRulesPath = path.join(rootDir, 'rules', 'rules.json');
const framePolicyPath = path.join(rootDir, 'workspace', 'frame-policy.js');
const framePolicyChromePath = path.join(rootDir, 'workspace', 'frame-policy-chrome.js');
const framePolicyBootstrapPath = path.join(rootDir, 'workspace', 'frame-policy-bootstrap.js');
check(!fs.existsSync(legacyRulesPath), 'Legacy global ChatGPT CSP/XFO stripping rules are removed');
check(fs.existsSync(framePolicyPath), 'Scoped workspace frame-policy module exists');
check(fs.existsSync(framePolicyChromePath), 'Session DNR workspace policy adapter exists');
check(fs.existsSync(framePolicyBootstrapPath), 'Workspace secure bootstrap exists');

if (fs.existsSync(framePolicyPath) && fs.existsSync(framePolicyChromePath)) {
  const framePolicy = fs.readFileSync(framePolicyPath, 'utf8');
  const framePolicyChrome = fs.readFileSync(framePolicyChromePath, 'utf8');
  check(framePolicy.includes('tabIds: normalized'), 'Workspace header override is tab-scoped');
  check(framePolicy.includes("resourceTypes: ['sub_frame']"), 'Workspace header override is subframe-scoped');
  check(framePolicyChrome.includes('updateSessionRules'), 'Workspace header override is session-scoped');
}

// 9. Multi-Chat Coding Hub Workspace files
const workspaceHtml = path.join(rootDir, 'workspace', 'index.html');
const workspaceJs = path.join(rootDir, 'workspace', 'workspace.js');
const workspaceCss = path.join(rootDir, 'workspace', 'workspace.css');
check(fs.existsSync(workspaceHtml), 'Workspace HTML exists');
check(fs.existsSync(workspaceJs), 'Workspace JS exists');
check(fs.existsSync(workspaceCss), 'Workspace CSS exists');

// 10. Security & CSP Checks: No inline event handlers in HTML files
const htmlFiles = [sidePanelHtml, popupHtml, optionsHtml, workspaceHtml];
for (const file of htmlFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const hasEventHandlers = /on(click|load|change|submit|input)\s*=/gi.test(content);
  check(!hasEventHandlers, `No inline event handlers in ${path.basename(file)}`);
}

// 11. No eval() in core extension JS
const jsFiles = [
  swPath,
  fetchProxyJs,
  boosterJs,
  sidePanelJs,
  popupJs,
  optionsJs,
  workspaceJs,
  framePolicyPath,
  framePolicyChromePath,
  framePolicyBootstrapPath
];
for (const file of jsFiles) {
  const content = fs.readFileSync(file, 'utf8');
  check(!/\beval\s*\(/.test(content), `No eval() usage in ${path.basename(file)}`);
}

console.log(`\n==========================================`);
console.log(`🏁 VERIFICATION GATE: ${passedChecks}/${totalChecks} CHECKS PASSED`);
console.log(`==========================================\n`);
