export const SOCIAL_MIME_CANDIDATES = Object.freeze([
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.4D401F,mp4a.40.2'
]);

export const X_WEB_LIMITS = Object.freeze({
  freeDurationMs: 140_000,
  freeMaxBytes: 512 * 1024 * 1024,
  landscapeMaxWidth: 1920,
  landscapeMaxHeight: 1200,
  portraitMaxWidth: 1200,
  portraitMaxHeight: 1900,
  maxFps: 40,
  maxBitrate: 25_000_000,
  minAspectRatio: 1 / 2.39,
  maxAspectRatio: 2.39
});

export const SOCIAL_PROFILES = Object.freeze({
  master: Object.freeze({
    id: 'master',
    label: 'Master',
    quality: null,
    fps: null,
    format: null,
    autoStopMs: null
  }),
  social: Object.freeze({
    id: 'social',
    label: 'Social Ready',
    quality: '1080p',
    fps: 30,
    format: 'mp4',
    autoStopMs: null
  }),
  'x-free': Object.freeze({
    id: 'x-free',
    label: 'X Free',
    quality: '1080p',
    fps: 30,
    format: 'mp4',
    // X documents a 140-second limit for non-Premium uploads. Stop one second
    // early so recorder/finalization jitter cannot push a capture over the edge.
    autoStopMs: 139_000
  })
});

export function socialProfile(id = 'master') {
  return SOCIAL_PROFILES[id] || SOCIAL_PROFILES.master;
}

export function chooseSocialMime(MediaRecorderCtor = globalThis.MediaRecorder) {
  if (!MediaRecorderCtor?.isTypeSupported) return null;
  return SOCIAL_MIME_CANDIDATES.find(type => MediaRecorderCtor.isTypeSupported(type)) || null;
}

export function isH264AacMp4(mimeType = '') {
  const value = String(mimeType).toLowerCase();
  return value.startsWith('video/mp4') && value.includes('avc1') && value.includes('mp4a.40.2');
}

export function parseDurationLabel(label = '') {
  const parts = String(label).trim().split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some(value => !Number.isFinite(value) || value < 0)) return 0;
  const seconds = parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
  return seconds * 1000;
}

export function parseBytesLabel(label = '') {
  const match = String(label).trim().match(/^([\d.]+)\s*(B|KB|MB|GB)$/i);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) return 0;
  const unit = match[2].toUpperCase();
  const power = unit === 'GB' ? 3 : unit === 'MB' ? 2 : unit === 'KB' ? 1 : 0;
  return Math.round(value * (1024 ** power));
}

export function xWebCompatibility({
  mimeType = '',
  width = 0,
  height = 0,
  fps = 0,
  durationMs = 0,
  sizeBytes = 0,
  videoBitrate = 0
} = {}) {
  const reasons = [];
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const rate = Number(fps) || 0;
  const duration = Number(durationMs) || 0;
  const size = Number(sizeBytes) || 0;
  const bitrate = Number(videoBitrate) || 0;

  if (!isH264AacMp4(mimeType)) reasons.push('cần MP4 H.264 + AAC-LC');

  if (w > 0 && h > 0) {
    const landscape = w >= h;
    const dimensionsOk = landscape
      ? w <= X_WEB_LIMITS.landscapeMaxWidth && h <= X_WEB_LIMITS.landscapeMaxHeight
      : w <= X_WEB_LIMITS.portraitMaxWidth && h <= X_WEB_LIMITS.portraitMaxHeight;
    if (!dimensionsOk) reasons.push('độ phân giải vượt giới hạn X web');
    const ratio = w / h;
    if (ratio < X_WEB_LIMITS.minAspectRatio || ratio > X_WEB_LIMITS.maxAspectRatio) {
      reasons.push('tỷ lệ khung hình ngoài phạm vi X web');
    }
  }

  if (rate > X_WEB_LIMITS.maxFps) reasons.push(`FPS vượt ${X_WEB_LIMITS.maxFps}`);
  if (bitrate > X_WEB_LIMITS.maxBitrate) reasons.push('bitrate vượt 25 Mbps');
  if (duration > X_WEB_LIMITS.freeDurationMs) reasons.push('dài hơn 140 giây cho X non-Premium');
  if (size > X_WEB_LIMITS.freeMaxBytes) reasons.push('lớn hơn 512 MB cho X non-Premium');

  return {
    compatible: reasons.length === 0,
    reasons,
    limits: X_WEB_LIMITS
  };
}
