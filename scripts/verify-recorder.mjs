import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = path => fs.readFileSync(path, 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const html = read('recorder/index.html');
const core = read('recorder/core.js');
const recorder = read('recorder/recorder.js');
const screenshot = read('recorder/screenshot-controller.js');
const social = read('recorder/social-controller.js');
const socialPolicy = read('recorder/social-profile.js');
const sidepanel = read('v3/sidepanel.html');
const sidepanelController = read('v3/sidepanel-controller.js');

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  ✅ ${message}`);
}

console.log('🎥 Verifying TabFlow Recorder...');

check(manifest.permissions.includes('downloads'), 'downloads permission declared for video/screenshot export');
check(sidepanel.includes('id="btn-open-recorder"'), 'Control Center exposes Recorder entry point');
check(sidepanelController.includes("chrome.runtime.getURL('recorder/index.html')"), 'Control Center recorder action opens the extension Capture Studio');
check(html.includes('id="quality-select"') && html.includes('value="4k"'), 'Recorder UI exposes 4K preset');
check(html.includes('id="fps-select"') && html.includes('value="60"'), 'Recorder UI exposes 60 FPS option');
check(html.includes('id="system-audio-toggle"') && html.includes('id="mic-toggle"'), 'Recorder UI exposes system audio and microphone controls');
check(html.includes('id="btn-screenshot"') && html.includes('id="btn-download"'), 'Recorder exposes screenshot and video download actions');
check(html.includes('screenshot-controller.js'), 'standalone screenshot controller is loaded');
check(html.includes('id="publish-profile-select"') && html.includes('value="social"') && html.includes('value="x-free"'), 'Recorder exposes Social Ready and X Free presets');
check(html.includes('social-controller.js'), 'social compatibility controller is loaded');
check(core.includes('3840') && core.includes('2160'), '4K policy caps at 3840x2160');
check(core.includes('MediaRecorderCtor.isTypeSupported'), 'codec negotiation checks MediaRecorder support');
check(core.includes('video/mp4') && core.includes('video/webm'), 'codec policy supports MP4 and WebM fallback');
check(socialPolicy.includes('avc1.42E01E') && socialPolicy.includes('mp4a.40.2'), 'Social Ready requires explicit H.264 + AAC-LC MP4');
check(socialPolicy.includes('140_000') && socialPolicy.includes('512 * 1024 * 1024'), 'X non-Premium duration/file-size limits are encoded');
check(socialPolicy.includes('maxFps: 40') && socialPolicy.includes('maxBitrate: 25_000_000'), 'X web FPS/bitrate limits are encoded');
check(social.includes("quality: '1080p'") || socialPolicy.includes("quality: '1080p'"), 'Social Ready is capped at 1080p');
check(social.includes('chooseSocialMime'), 'Social Ready preflights strict social codec support');
check(recorder.includes('getDisplayMedia'), 'recording uses browser screen picker');
check(screenshot.includes('getDisplayMedia'), 'standalone screenshot uses browser screen picker');
check(recorder.includes('showSaveFilePicker'), '4K path can stream directly to a user-selected file');
check(recorder.includes('createWritable'), 'direct-save path writes MediaRecorder chunks to disk');
check(recorder.includes("recorder.start(1000)"), 'MediaRecorder emits bounded chunks instead of one giant final blob');
check(recorder.includes('directWriteFailure') && recorder.includes('writer.abort'), 'direct-write failure stops instead of pretending a partial file is complete');
check(recorder.includes('ImageCapture') && recorder.includes('image/png'), 'recording screenshot path captures full-resolution PNG');
check(screenshot.includes('ImageCapture') && screenshot.includes('image/png'), 'standalone screenshot path captures full-resolution PNG');
check(recorder.includes('chrome.downloads.download') && screenshot.includes('chrome.downloads.download'), 'video and screenshot export use Chrome Downloads');
check(recorder.includes('URL.revokeObjectURL') && screenshot.includes('URL.revokeObjectURL'), 'capture object URLs are released');
check(!/\bfetch\s*\(/.test(recorder) && !/\bfetch\s*\(/.test(screenshot) && !/\bfetch\s*\(/.test(social), 'Capture Studio has no network upload path');
check(!/\beval\s*\(/.test(recorder) && !/\bnew\s+Function\s*\(/.test(recorder), 'Recorder avoids dynamic code execution');
check(!/\.innerHTML\s*=/.test(recorder) && !/\.innerHTML\s*=/.test(screenshot) && !/\.innerHTML\s*=/.test(social), 'Capture Studio does not inject HTML strings');

for (const path of [
  'recorder/core.js',
  'recorder/recorder.js',
  'recorder/screenshot-controller.js',
  'recorder/social-profile.js',
  'recorder/social-controller.js',
  'test/recorder-core.test.mjs',
  'test/social-profile.test.mjs'
]) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  check(result.status === 0, `${path}: node --check`);
  if (result.status !== 0) console.error(result.stderr || result.stdout);
}

for (const path of ['test/recorder-core.test.mjs', 'test/social-profile.test.mjs']) {
  const unit = spawnSync(process.execPath, [path], { encoding: 'utf8' });
  check(unit.status === 0, `${path}: unit tests pass`);
  if (unit.status !== 0) console.error(unit.stderr || unit.stdout);
}

console.log('🏁 Recorder verification passed');
