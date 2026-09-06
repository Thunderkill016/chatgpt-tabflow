export const QUALITY_PRESETS = Object.freeze({
  native: Object.freeze({ id: 'native', label: 'Native', width: null, height: null }),
  '4k': Object.freeze({ id: '4k', label: '4K UHD', width: 3840, height: 2160 }),
  '1440p': Object.freeze({ id: '1440p', label: '1440p', width: 2560, height: 1440 }),
  '1080p': Object.freeze({ id: '1080p', label: '1080p', width: 1920, height: 1080 })
});

export const MIME_CANDIDATES = Object.freeze({
  mp4: Object.freeze([
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4'
  ]),
  webm: Object.freeze([
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ])
});

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function containerFromMime(mimeType = '') {
  return String(mimeType).toLowerCase().includes('mp4') ? 'mp4' : 'webm';
}

export function extensionFromMime(mimeType = '') {
  return containerFromMime(mimeType);
}

export function supportedRecorderMimes(MediaRecorderCtor = globalThis.MediaRecorder) {
  if (!MediaRecorderCtor?.isTypeSupported) return [];
  return [...MIME_CANDIDATES.mp4, ...MIME_CANDIDATES.webm]
    .filter(type => MediaRecorderCtor.isTypeSupported(type));
}

export function chooseRecorderMime(preference = 'auto', MediaRecorderCtor = globalThis.MediaRecorder) {
  if (!MediaRecorderCtor?.isTypeSupported) return null;
  const order = preference === 'webm'
    ? [...MIME_CANDIDATES.webm, ...MIME_CANDIDATES.mp4]
    : [...MIME_CANDIDATES.mp4, ...MIME_CANDIDATES.webm];
  return order.find(type => MediaRecorderCtor.isTypeSupported(type)) || null;
}

export function alternateRecorderMime(currentMime, MediaRecorderCtor = globalThis.MediaRecorder) {
  const currentContainer = containerFromMime(currentMime);
  const candidates = currentContainer === 'mp4' ? MIME_CANDIDATES.webm : MIME_CANDIDATES.mp4;
  return candidates.find(type => MediaRecorderCtor?.isTypeSupported?.(type)) || null;
}

export function buildDisplayMediaOptions({ preset = '4k', fps = 30, systemAudio = true } = {}) {
  const profile = QUALITY_PRESETS[preset] || QUALITY_PRESETS['4k'];
  const frameRate = clamp(Number(fps) || 30, 15, 60);
  const video = {
    frameRate: { ideal: frameRate }
  };
  if (profile.width && profile.height) {
    video.width = { ideal: profile.width };
    video.height = { ideal: profile.height };
  }
  return {
    video,
    audio: Boolean(systemAudio),
    preferCurrentTab: false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    systemAudio: systemAudio ? 'include' : 'exclude',
    monitorTypeSurfaces: 'include',
    windowAudio: systemAudio ? 'system' : 'exclude'
  };
}

export function postSelectionConstraints({ preset = '4k', fps = 30 } = {}) {
  const profile = QUALITY_PRESETS[preset] || QUALITY_PRESETS['4k'];
  const frameRate = clamp(Number(fps) || 30, 15, 60);
  const constraints = { frameRate: { max: frameRate } };
  if (profile.width && profile.height) {
    constraints.width = { max: profile.width };
    constraints.height = { max: profile.height };
  }
  return constraints;
}

export function videoBitrateFor({ width = 1920, height = 1080, fps = 30 } = {}) {
  const w = clamp(Number(width) || 1920, 320, 7680);
  const h = clamp(Number(height) || 1080, 240, 4320);
  const rate = clamp(Number(fps) || 30, 15, 60);
  const bitsPerPixelFrame = 0.08;
  return Math.round(clamp(w * h * rate * bitsPerPixelFrame, 5_000_000, 42_000_000));
}

export function qualityLabel(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w >= 3840 && h >= 2160) return '4K UHD';
  if (w >= 2560 && h >= 1440) return '1440p';
  if (w >= 1920 && h >= 1080) return '1080p';
  if (w > 0 && h > 0) return `${w}×${h}`;
  return 'Không rõ';
}

export function resolutionNotice({ targetPreset = '4k', width = 0, height = 0 } = {}) {
  const target = QUALITY_PRESETS[targetPreset] || QUALITY_PRESETS['4k'];
  if (!target.width || !target.height) return `Nguồn thực tế: ${width}×${height}`;
  if (width >= target.width && height >= target.height) {
    return `Nguồn thực tế đạt ${qualityLabel(width, height)} (${width}×${height}).`;
  }
  return `Nguồn thực tế ${width}×${height}; TabFlow không upscale giả lên ${target.label}.`;
}

export function safeTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export function recordingFilename({ mimeType = 'video/webm', width = 0, height = 0, fps = 30, date = new Date() } = {}) {
  const ext = extensionFromMime(mimeType);
  const resolution = width && height ? `${width}x${height}` : 'capture';
  return `TabFlow-${safeTimestamp(date)}-${resolution}-${Math.round(Number(fps) || 30)}fps.${ext}`;
}

export function screenshotFilename(date = new Date()) {
  return `TabFlow-Capture-${safeTimestamp(date)}.png`;
}

export function formatBytes(bytes = 0) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDuration(milliseconds = 0) {
  const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = value => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
