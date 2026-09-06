import assert from 'node:assert/strict';
import {
  buildDisplayMediaOptions,
  chooseRecorderMime,
  containerFromMime,
  formatBytes,
  formatDuration,
  postSelectionConstraints,
  qualityLabel,
  recordingFilename,
  resolutionNotice,
  videoBitrateFor
} from '../recorder/core.js';

class FakeRecorder {
  static isTypeSupported(type) {
    return type === 'video/mp4' || type === 'video/webm;codecs=vp9,opus';
  }
}

assert.equal(chooseRecorderMime('auto', FakeRecorder), 'video/mp4');
assert.equal(chooseRecorderMime('mp4', FakeRecorder), 'video/mp4');
assert.equal(chooseRecorderMime('webm', FakeRecorder), 'video/webm;codecs=vp9,opus');
assert.equal(containerFromMime('video/mp4;codecs=avc1'), 'mp4');
assert.equal(containerFromMime('video/webm;codecs=vp9'), 'webm');

const capture4k = buildDisplayMediaOptions({ preset: '4k', fps: 60, systemAudio: true });
assert.equal(capture4k.video.width.ideal, 3840);
assert.equal(capture4k.video.height.ideal, 2160);
assert.equal(capture4k.video.frameRate.ideal, 60);
assert.equal(capture4k.audio, true);
assert.equal(capture4k.systemAudio, 'include');
assert.equal(capture4k.selfBrowserSurface, 'exclude');

const cap4k = postSelectionConstraints({ preset: '4k', fps: 60 });
assert.equal(cap4k.width.max, 3840);
assert.equal(cap4k.height.max, 2160);
assert.equal(cap4k.frameRate.max, 60);

const native = postSelectionConstraints({ preset: 'native', fps: 30 });
assert.equal('width' in native, false);
assert.equal('height' in native, false);
assert.equal(native.frameRate.max, 30);

const fourK30 = videoBitrateFor({ width: 3840, height: 2160, fps: 30 });
const fourK60 = videoBitrateFor({ width: 3840, height: 2160, fps: 60 });
assert.ok(fourK30 >= 19_000_000 && fourK30 <= 21_000_000);
assert.ok(fourK60 > fourK30);
assert.ok(fourK60 <= 42_000_000);

assert.equal(qualityLabel(3840, 2160), '4K UHD');
assert.equal(qualityLabel(2560, 1440), '1440p');
assert.equal(qualityLabel(1920, 1080), '1080p');
assert.match(resolutionNotice({ targetPreset: '4k', width: 1920, height: 1080 }), /không upscale giả/);
assert.match(resolutionNotice({ targetPreset: '4k', width: 3840, height: 2160 }), /đạt 4K UHD/);

const fixedDate = new Date(2026, 8, 6, 12, 3, 4);
assert.equal(
  recordingFilename({ mimeType: 'video/mp4', width: 3840, height: 2160, fps: 60, date: fixedDate }),
  'TabFlow-2026-09-06_12-03-04-3840x2160-60fps.mp4'
);
assert.equal(formatBytes(1024 ** 2), '1.0 MB');
assert.equal(formatDuration(65_000), '01:05');

console.log('recorder core tests passed');
