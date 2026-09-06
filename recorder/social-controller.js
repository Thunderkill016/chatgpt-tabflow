import {
  chooseSocialMime,
  parseBytesLabel,
  parseDurationLabel,
  socialProfile,
  xWebCompatibility
} from './social-profile.js';

const $ = id => document.getElementById(id);
const profileSelect = $('publish-profile-select');
const profileNote = $('publish-profile-note');
const compatibility = $('social-compatibility');
const qualitySelect = $('quality-select');
const fpsSelect = $('fps-select');
const formatSelect = $('format-select');
const startButton = $('btn-start');
const stopButton = $('btn-stop');
const statePill = $('recorder-state-pill');
const statusMessage = $('status-message');
const resultCard = $('result-card');
const resultMeta = $('result-meta');
const actualFps = $('actual-fps');

let activeProfileId = profileSelect?.value || 'master';
let startedAt = 0;
let pausedAt = 0;
let pausedMs = 0;
let limitTimer = null;
let autoStopIssued = false;

function setStatus(message, tone = '') {
  if (!statusMessage) return;
  statusMessage.textContent = message;
  statusMessage.className = tone ? `status-${tone}` : '';
}

function setControlValue(control, value) {
  if (!control || String(control.value) === String(value)) return;
  control.value = String(value);
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

function stateName() {
  if (!statePill) return 'idle';
  for (const name of ['selecting', 'recording', 'paused', 'finalizing', 'ready']) {
    if (statePill.classList.contains(name)) return name;
  }
  return 'idle';
}

function applyControlLocks() {
  const profile = socialProfile(profileSelect?.value || 'master');
  const socialLocked = profile.id !== 'master';
  const busy = ['selecting', 'recording', 'paused', 'finalizing'].includes(stateName());
  if (profileSelect) profileSelect.disabled = busy;
  if (socialLocked) {
    qualitySelect.disabled = true;
    fpsSelect.disabled = true;
    formatSelect.disabled = true;
  } else if (!busy) {
    qualitySelect.disabled = false;
    fpsSelect.disabled = false;
    formatSelect.disabled = false;
  }
}

function applyProfile() {
  const profile = socialProfile(profileSelect?.value || 'master');
  activeProfileId = profile.id;
  if (profile.id === 'master') {
    profileNote.textContent = 'Master giữ toàn quyền 4K/60 FPS. Nếu đăng X/Facebook, dùng Social Ready để tránh codec/FPS/resolution khó xử lý.';
    compatibility.textContent = 'Social check sẽ xuất hiện sau khi quay.';
    compatibility.dataset.state = 'neutral';
    applyControlLocks();
    return;
  }

  setControlValue(qualitySelect, profile.quality);
  setControlValue(fpsSelect, profile.fps);
  setControlValue(formatSelect, profile.format);

  const socialMime = chooseSocialMime();
  if (profile.id === 'x-free') {
    profileNote.textContent = 'X Free: 1080p30 · MP4 H.264/AAC · tự dừng ở 2:19 để không vượt giới hạn 140 giây.';
  } else {
    profileNote.textContent = 'Social Ready: 1080p30 · MP4 H.264/AAC-LC · bitrate khoảng 5 Mbps, phù hợp để đăng Facebook và nằm dưới giới hạn kỹ thuật của X web.';
  }
  compatibility.textContent = socialMime
    ? `Codec sẵn sàng: ${socialMime}`
    : 'Chrome này chưa cung cấp MediaRecorder MP4 H.264/AAC-LC; Social Ready sẽ không bắt đầu để tránh tạo file khó upload.';
  compatibility.dataset.state = socialMime ? 'ok' : 'error';
  applyControlLocks();
}

function elapsedActiveMs(now = performance.now()) {
  if (!startedAt) return 0;
  const currentPause = pausedAt ? now - pausedAt : 0;
  return Math.max(0, now - startedAt - pausedMs - currentPause);
}

function stopLimitTimer() {
  if (limitTimer) clearInterval(limitTimer);
  limitTimer = null;
}

function ensureLimitTimer() {
  stopLimitTimer();
  const profile = socialProfile(activeProfileId);
  if (!profile.autoStopMs) return;
  limitTimer = setInterval(() => {
    if (autoStopIssued || stateName() !== 'recording') return;
    if (elapsedActiveMs() < profile.autoStopMs) return;
    autoStopIssued = true;
    setStatus('Đã đạt 2:19. TabFlow tự dừng để file không vượt giới hạn 140 giây của X non-Premium.', 'warn');
    stopButton?.click();
  }, 200);
}

function onStateChanged() {
  const next = stateName();
  const now = performance.now();
  if (next === 'recording') {
    if (!startedAt) {
      startedAt = now;
      pausedMs = 0;
      pausedAt = 0;
      autoStopIssued = false;
      ensureLimitTimer();
    } else if (pausedAt) {
      pausedMs += now - pausedAt;
      pausedAt = 0;
    }
  } else if (next === 'paused') {
    if (!pausedAt) pausedAt = now;
  } else if (next === 'ready' || next === 'idle') {
    stopLimitTimer();
  }
  applyControlLocks();
}

function parseResultMeta() {
  const text = resultMeta?.textContent || '';
  const parts = text.split('·').map(part => part.trim());
  const sizeBytes = parseBytesLabel(parts[0] || '');
  const durationMs = parseDurationLabel(parts[1] || '');
  const container = (parts[2] || '').toUpperCase();
  const dimensions = (parts[3] || '').match(/(\d+)×(\d+)/);
  const fps = Number((actualFps?.textContent || '').match(/[\d.]+/)?.[0] || 0);
  return {
    sizeBytes,
    durationMs,
    container,
    width: Number(dimensions?.[1] || 0),
    height: Number(dimensions?.[2] || 0),
    fps
  };
}

function renderCompatibility() {
  if (!resultCard || resultCard.hidden) return;
  const result = parseResultMeta();
  const socialMime = chooseSocialMime();
  const socialWasRequested = activeProfileId === 'social' || activeProfileId === 'x-free';
  const mimeType = socialWasRequested && result.container === 'MP4' && socialMime
    ? socialMime
    : result.container === 'MP4' ? 'video/mp4' : 'video/webm';
  const report = xWebCompatibility({
    mimeType,
    width: result.width,
    height: result.height,
    fps: result.fps,
    durationMs: result.durationMs,
    sizeBytes: result.sizeBytes,
    videoBitrate: socialWasRequested ? 5_000_000 : 0
  });

  if (report.compatible) {
    compatibility.textContent = socialWasRequested
      ? '✓ Social Ready · X non-Premium: đạt giới hạn upload kỹ thuật · Facebook: MP4 H.264/AAC 1080p30.'
      : '✓ X web: file hiện tại nằm trong các giới hạn kiểm tra được. Codec MP4 chỉ được xác nhận chắc khi quay bằng Social Ready.';
    compatibility.dataset.state = 'ok';
  } else {
    compatibility.textContent = `⚠ Chưa social-ready: ${report.reasons.join(' · ')}.`;
    compatibility.dataset.state = 'error';
  }
}

function preflightStart(event) {
  const profile = socialProfile(profileSelect?.value || 'master');
  activeProfileId = profile.id;
  if (profile.id === 'master') return;
  applyProfile();
  const socialMime = chooseSocialMime();
  if (socialMime) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  setStatus('Không bắt đầu Social Ready: Chrome hiện tại không expose MP4 H.264 + AAC-LC qua MediaRecorder. Hãy cập nhật Chrome hoặc dùng Master rồi transcode H.264/AAC.', 'error');
}

profileSelect?.addEventListener('change', applyProfile);
startButton?.addEventListener('click', preflightStart, { capture: true });

if (statePill) {
  new MutationObserver(onStateChanged).observe(statePill, { attributes: true, childList: true, subtree: true });
}
if (resultCard) {
  new MutationObserver(renderCompatibility).observe(resultCard, { attributes: true, attributeFilter: ['hidden'] });
}
if (resultMeta) {
  new MutationObserver(renderCompatibility).observe(resultMeta, { childList: true, subtree: true, characterData: true });
}

applyProfile();
onStateChanged();
