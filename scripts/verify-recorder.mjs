import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = path => fs.readFileSync(path, 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const html = read('recorder/index.html');
const core = read('recorder/core.js');
const recorder = read('recorder/recorder.js');
const sidepanel = read('v3/sidepanel.html');

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  ✅ ${message}`);
}

console.log('🎥 Verifying TabFlow Recorder...');

check(manifest.permissions.includes('downloads'), 'downloads permission declared for video/screenshot export');
check(sidepanel.includes('id="btn-open-recorder"'), 'Control Center exposes Recorder entry point');
check(html.includes('id="quality-select"') && html.includes('value="4k"'), 'Recorder UI exposes 4K preset');
check(html.includes('id="fps-select"') && html.includes('value="60"'), 'Recorder UI exposes 60 FPS option');
check(html.includes('id="system-audio-toggle"') && html.includes('id="mic-toggle"'), 'Recorder UI exposes system audio and microphone controls');
check(html.includes('id="btn-screenshot"') && html.includes('id="btn-download"'), 'Recorder exposes screenshot and video download actions');
check(core.includes('3840') && core.includes('2160'), '4K policy caps at 3840x2160');
check(core.includes('MediaRecorderCtor.isTypeSupported'), 'codec negotiation checks MediaRecorder support');
check(core.includes('video/mp4') && core.includes('video/webm'), 'codec policy supports MP4 and WebM fallback');
check(recorder.includes('getDisplayMedia'), 'capture uses browser screen picker');
check(recorder.includes('showSaveFilePicker'), '4K path can stream directly to a user-selected file');
check(recorder.includes('createWritable'), 'direct-save path writes MediaRecorder chunks to disk');
check(recorder.includes("recorder.start(1000)"), 'MediaRecorder emits bounded chunks instead of one giant final blob');
check(recorder.includes('ImageCapture') && recorder.includes('image/png'), 'screenshot path captures full-resolution PNG');
check(recorder.includes('chrome.downloads.download'), 'video and screenshot export use Chrome Downloads');
check(!/\bfetch\s*\(/.test(recorder), 'Recorder has no network upload path');
check(!/\beval\s*\(/.test(recorder) && !/\bnew\s+Function\s*\(/.test(recorder), 'Recorder avoids dynamic code execution');
check(!/\.innerHTML\s*=/.test(recorder), 'Recorder does not inject HTML strings');

for (const path of ['recorder/core.js', 'recorder/recorder.js', 'test/recorder-core.test.mjs']) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  check(result.status === 0, `${path}: node --check`);
  if (result.status !== 0) console.error(result.stderr || result.stdout);
}

const unit = spawnSync(process.execPath, ['test/recorder-core.test.mjs'], { encoding: 'utf8' });
check(unit.status === 0, 'recorder core unit tests pass');
if (unit.status !== 0) console.error(unit.stderr || unit.stdout);

console.log('🏁 Recorder verification passed');
