import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const version = manifest.version;
const distRoot = path.join(root, 'dist');
const stage = path.join(distRoot, `tabflow-v${version}`);
const zipPath = path.join(distRoot, `tabflow-v${version}.zip`);

const runtimeEntries = [
  'manifest.json',
  'LICENSE',
  'service-worker.js',
  'icons',
  'popup',
  'options',
  'content-scripts',
  'v3',
  'workspace',
  'memory',
  'runtime',
  'offscreen',
  'workers',
  'recorder'
];

fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(zipPath, { force: true });
fs.mkdirSync(stage, { recursive: true });

for (const rel of runtimeEntries) {
  const source = path.join(root, rel);
  if (!fs.existsSync(source)) throw new Error(`Missing runtime release entry: ${rel}`);
  const target = path.join(stage, rel);
  fs.cpSync(source, target, { recursive: true });
}

const stagedManifest = JSON.parse(fs.readFileSync(path.join(stage, 'manifest.json'), 'utf8'));
if (stagedManifest.version !== version) throw new Error('Staged manifest version mismatch');
if (!fs.existsSync(path.join(stage, 'LICENSE'))) throw new Error('LICENSE missing from release package');
if (fs.existsSync(path.join(stage, 'rules', 'rules.json'))) throw new Error('Legacy static DNR rules leaked into release package');

const zip = spawnSync('zip', ['-qr', zipPath, '.'], { cwd: stage, encoding: 'utf8' });
if (zip.status !== 0) {
  throw new Error(`zip failed: ${zip.stderr || zip.stdout || `exit ${zip.status}`}`);
}

const stat = fs.statSync(zipPath);
if (!(stat.size > 0)) throw new Error('Release ZIP is empty');

console.log(`📦 Built ${path.relative(root, zipPath)} (${stat.size} bytes)`);
console.log(`📁 Unpacked staging: ${path.relative(root, stage)}`);
