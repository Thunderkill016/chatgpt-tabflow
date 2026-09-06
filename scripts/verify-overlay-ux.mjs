import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const boosterCss = fs.readFileSync(path.join(root, 'content-scripts', 'booster.css'), 'utf8');
const memoryCss = fs.readFileSync(path.join(root, 'content-scripts', 'memory-status.css'), 'utf8');

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

console.log('🧭 Verifying non-obstructive in-page overlays...');

const memoryEntry = manifest.content_scripts.find(entry =>
  Array.isArray(entry.js) && entry.js.includes('content-scripts/memory-client.js')
);

check(Boolean(memoryEntry), 'memory client manifest entry exists');
check(memoryEntry?.all_frames === true, 'memory status policy applies to every ChatGPT frame');
check(memoryEntry?.css?.includes('content-scripts/memory-status.css'), 'memory client loads dedicated status CSS');
check(/#tabflow-memory-status-host\s*\{[^}]*display:\s*none\s*!important/s.test(memoryCss), 'standalone memory pill never occupies the working canvas');

check(/#tabflow-hud\s*\{[^}]*right:\s*0/s.test(boosterCss), 'HUD is docked to the viewport edge');
check(/#tabflow-hud\s*\{[^}]*width:\s*30px/s.test(boosterCss), 'collapsed HUD footprint is only 30px wide');
check(boosterCss.includes('#tabflow-hud:hover'), 'HUD expands on explicit hover');
check(boosterCss.includes('#tabflow-hud:focus-within'), 'HUD expands for keyboard focus');
check(boosterCss.includes('body.tabflow-typing-active #tabflow-hud:not(:hover):not(:focus-within)'), 'HUD recedes further while the user types');
check(boosterCss.includes('#hud-meter-text'), 'collapsed mode hides verbose token text');
check(boosterCss.includes('.hud-btn'), 'collapsed mode hides action buttons until expansion');

console.log(`\n🏁 Overlay UX verification: ${passed}/${total} checks passed`);
if (passed !== total) process.exitCode = 1;
