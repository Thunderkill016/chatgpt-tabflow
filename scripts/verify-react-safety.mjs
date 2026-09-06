import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const boosterPath = path.join(root, 'content-scripts', 'booster.js');
const booster = fs.readFileSync(boosterPath, 'utf8');
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

console.log('⚛️ Verifying React-owned DOM safety...');

check(!booster.includes('pre.parentNode'), 'code folding never mutates the parent of a React-owned <pre>');
check(!booster.includes('parentNode.insertBefore'), 'no fold control is inserted as a React child sibling');
check(!booster.includes('pre.appendChild'), 'no extension child is appended inside React-owned code blocks');
check(!booster.includes('pre.insertAdjacent'), 'no adjacent HTML is injected around React-owned code blocks');
check(booster.includes("if (!event.altKey) return"), 'folding requires an explicit Alt+click interaction');
check(booster.includes("pre.classList.toggle('tabflow-folded')"), 'folding is a class-only presentation mutation');
check(booster.includes('pre.dataset.tabflowFoldLines'), 'fold metadata stays on the target element without extra child nodes');
check(booster.includes("document.body.appendChild(drawer)"), 'Code Vault UI is mounted as extension-owned body sibling');
check(booster.includes("document.body.appendChild(hud)"), 'HUD UI is mounted as extension-owned body sibling');

check(!/\beval\s*\(/.test(booster), 'booster: no eval()');
check(!/\bnew\s+Function\s*\(/.test(booster), 'booster: no new Function()');
check(!/\bgetComputedStyle\s*\(/.test(booster), 'booster: no getComputedStyle');
check(!/getBoundingClientRect\s*\(/.test(booster), 'booster: no rect layout read');
check(!/\.offset(?:Height|Width|Top|Left|Parent)\b/.test(booster), 'booster: no offset layout read');

const syntax = spawnSync(process.execPath, ['--check', boosterPath], { encoding: 'utf8' });
check(syntax.status === 0, 'booster.js: node --check');
if (syntax.status !== 0) console.error(syntax.stderr || syntax.stdout);

console.log(`\n🏁 React DOM safety verification: ${passed}/${total} checks passed`);
if (passed !== total) process.exitCode = 1;
