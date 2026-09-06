import assert from 'node:assert/strict';
import {
  X_WEB_LIMITS,
  chooseSocialMime,
  isH264AacMp4,
  parseBytesLabel,
  parseDurationLabel,
  socialProfile,
  xWebCompatibility
} from '../recorder/social-profile.js';

class SocialRecorder {
  static isTypeSupported(type) {
    return type === 'video/mp4;codecs=avc1.42E01E,mp4a.40.2';
  }
}

assert.equal(chooseSocialMime(SocialRecorder), 'video/mp4;codecs=avc1.42E01E,mp4a.40.2');
assert.equal(isH264AacMp4('video/mp4;codecs=avc1.42E01E,mp4a.40.2'), true);
assert.equal(isH264AacMp4('video/mp4'), false);
assert.equal(isH264AacMp4('video/webm;codecs=vp9,opus'), false);

assert.equal(socialProfile('social').quality, '1080p');
assert.equal(socialProfile('social').fps, 30);
assert.equal(socialProfile('social').format, 'mp4');
assert.equal(socialProfile('x-free').autoStopMs, 139_000);
assert.equal(X_WEB_LIMITS.freeDurationMs, 140_000);
assert.equal(X_WEB_LIMITS.freeMaxBytes, 512 * 1024 * 1024);
assert.equal(X_WEB_LIMITS.maxFps, 40);

assert.equal(parseDurationLabel('02:19'), 139_000);
assert.equal(parseDurationLabel('02:20'), 140_000);
assert.equal(parseDurationLabel('1:02:03'), 3_723_000);
assert.equal(parseBytesLabel('512 MB'), 512 * 1024 * 1024);
assert.equal(parseBytesLabel('1.5 GB'), Math.round(1.5 * 1024 ** 3));

const pass = xWebCompatibility({
  mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  width: 1920,
  height: 1080,
  fps: 30,
  durationMs: 139_000,
  sizeBytes: 150 * 1024 * 1024,
  videoBitrate: 5_000_000
});
assert.equal(pass.compatible, true);
assert.deepEqual(pass.reasons, []);

const fail = xWebCompatibility({
  mimeType: 'video/webm;codecs=vp9,opus',
  width: 3840,
  height: 2160,
  fps: 60,
  durationMs: 155_000,
  sizeBytes: 600 * 1024 * 1024,
  videoBitrate: 42_000_000
});
assert.equal(fail.compatible, false);
assert.ok(fail.reasons.some(reason => reason.includes('H.264')));
assert.ok(fail.reasons.some(reason => reason.includes('độ phân giải')));
assert.ok(fail.reasons.some(reason => reason.includes('FPS')));
assert.ok(fail.reasons.some(reason => reason.includes('140')));
assert.ok(fail.reasons.some(reason => reason.includes('512')));
assert.ok(fail.reasons.some(reason => reason.includes('25 Mbps')));

console.log('social profile tests passed');
