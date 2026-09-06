import {
  alternateRecorderMime,
  buildDisplayMediaOptions,
  chooseRecorderMime,
  containerFromMime,
  formatBytes,
  formatDuration,
  postSelectionConstraints,
  qualityLabel,
  recordingFilename,
  resolutionNotice,
  screenshotFilename,
  supportedRecorderMimes,
  videoBitrateFor
} from './core.js';

const $ = id => document.getElementById(id);
const preview = $('preview');
const previewEmpty = $('preview-empty');
const startButton = $('btn-start');
const pauseButton = $('btn-pause');
const stopButton = $('btn-stop');
const screenshotButton = $('btn-screenshot');
const pickFileButton = $('btn-pick-file');
const downloadButton = $('btn-download');
const showDownloadButton = $('btn-show-download');
const statePill = $('recorder-state-pill');
const recordingDot = $('recording-dot');
const timerLabel = $('recording-timer');
const sizeLabel = $('recording-size');
const qualitySelect = $('quality-select');
const fpsSelect = $('fps-select');
const formatSelect = $('format-select');
const systemAudioToggle = $('system-audio-toggle');
const micToggle = $('mic-toggle');
const codecHealth = $('codec-health');
const bitrateHint = $('bitrate-hint');
const saveTarget = $('save-target');
const resolutionNote = $('resolution-note');
const statusMessage = $('status-message');
const resultCard = $('result-card');
const resultName = $('result-name');
const resultMeta = $('result-meta');
const recentDownloads = $('recent-downloads');
const canvas = $('capture-canvas');

let displayStream = null;
let micStream = null;
let recordingStream = null;
let recorder = null;
let audioContext = null;
let selectedFileHandle = null;
let activeFileHandle = null;
let writerReady = Promise.resolve(null);
let writeChain = Promise.resolve();
let directWriteFailure = null;
let chunks = [];
let bytesRecorded = 0;
let activeMime = '';
let activeFilename = '';
let actualSettings = {};
let startedAt = 0;
let pausedAt = 0;
let totalPausedMs = 0;
let timerId = null;
let lastFile = null;
let lastDurationMs = 0;
let lastDownloadId = null;
let lastObjectUrl = null;
let state = 'idle';

function setStatus(message, tone = '') {
  statusMessage.textContent = message;
  statusMessage.className = tone ? `status-${tone}` : '';
}

function setState(next, label) {
  state = next;
  statePill.textContent = label;
  statePill.className = `state-pill ${next}`;
  recordingDot.className = `recording-dot ${next === 'recording' ? 'live' : next === 'paused' ? 'paused' : ''}`;
  updateControls();
}

function updateControls() {
  const active = state === 'recording' || state === 'paused' || state === 'finalizing';
  startButton.disabled = active;
  stopButton.disabled = !(state === 'recording' || state === 'paused');
  pauseButton.disabled = !(state === 'recording' || state === 'paused');
  pauseButton.textContent = state === 'paused' ? '▶ Tiếp tục' : 'Ⅱ Tạm dừng';
  screenshotButton.disabled = !displayStream && !lastFile;
  pickFileButton.disabled = active || !('showSaveFilePicker' in window);
  qualitySelect.disabled = active;
  fpsSelect.disabled = active;
  formatSelect.disabled = active;
  systemAudioToggle.disabled = active;
  micToggle.disabled = active;
}

function elapsedMs() {
  if (!startedAt) return 0;
  const now = performance.now();
  const currentPause = state === 'paused' && pausedAt ? now - pausedAt : 0;
  return Math.max(0, now - startedAt - totalPausedMs - currentPause);
}

function refreshTimer() {
  timerLabel.textContent = formatDuration(elapsedMs());
  sizeLabel.textContent = formatBytes(bytesRecorded);
}

function startTimer() {
  stopTimer();
  timerId = window.setInterval(refreshTimer, 250);
  refreshTimer();
}

function stopTimer() {
  if (timerId) window.clearInterval(timerId);
  timerId = null;
}

function clearObjectUrl() {
  if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
  lastObjectUrl = null;
}

function clearSelectedFile(reason = 'Chưa chọn · sau khi dừng có thể tải video từ trình duyệt.') {
  selectedFileHandle = null;
  saveTarget.textContent = reason;
}

function actualAudioLabel() {
  const displayAudio = displayStream?.getAudioTracks().length || 0;
  const micAudio = micStream?.getAudioTracks().length || 0;
  if (displayAudio && micAudio) return 'Hệ thống + mic';
  if (displayAudio) return 'Hệ thống';
  if (micAudio) return 'Microphone';
  return 'Không có';
}

function updateActualStats() {
  const width = Number(actualSettings.width || 0);
  const height = Number(actualSettings.height || 0);
  const fps = Number(actualSettings.frameRate || fpsSelect.value || 0);
  $('actual-resolution').textContent = width && height ? `${width}×${height} · ${qualityLabel(width, height)}` : '—';
  $('actual-fps').textContent = fps ? `${Math.round(fps)} FPS` : '—';
  $('actual-format').textContent = activeMime ? containerFromMime(activeMime).toUpperCase() : '—';
  $('actual-audio').textContent = actualAudioLabel();
  if (width && height) {
    resolutionNote.textContent = resolutionNotice({ targetPreset: qualitySelect.value, width, height });
    const bitrate = videoBitrateFor({ width, height, fps: Number(fpsSelect.value) || fps || 30 });
    bitrateHint.textContent = `Video bitrate mục tiêu ≈ ${(bitrate / 1_000_000).toFixed(1)} Mbps · audio tối đa 192 Kbps.`;
  }
}

async function applyCaptureConstraints(track) {
  if (!track?.applyConstraints) return;
  try {
    await track.applyConstraints(postSelectionConstraints({
      preset: qualitySelect.value,
      fps: Number(fpsSelect.value)
    }));
  } catch (error) {
    console.warn('[TabFlow Recorder] capture constraints not fully applied:', error?.message || error);
  }
}

async function mixAudio(display, microphone) {
  const videoTrack = display.getVideoTracks()[0];
  if (!videoTrack) throw new Error('Nguồn đã chọn không có video track.');
  const displayAudio = display.getAudioTracks();
  const micAudio = microphone?.getAudioTracks() || [];

  if (displayAudio.length > 0 && micAudio.length > 0) {
    audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    const systemSource = audioContext.createMediaStreamSource(new MediaStream(displayAudio));
    const micSource = audioContext.createMediaStreamSource(new MediaStream(micAudio));
    systemSource.connect(destination);
    micSource.connect(destination);
    return new MediaStream([videoTrack, ...destination.stream.getAudioTracks()]);
  }

  const audioTracks = micAudio.length > 0 ? micAudio : displayAudio;
  return new MediaStream([videoTrack, ...audioTracks]);
}

async function requestMicrophone() {
  if (!micToggle.checked) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
  } catch (error) {
    setStatus(`Microphone không khả dụng (${error?.name || 'permission'}); tiếp tục quay không mic.`, 'warn');
    return null;
  }
}

function recorderOptions(mimeType) {
  const width = Number(actualSettings.width || 1920);
  const height = Number(actualSettings.height || 1080);
  const fps = Number(fpsSelect.value || actualSettings.frameRate || 30);
  return {
    mimeType,
    videoBitsPerSecond: videoBitrateFor({ width, height, fps }),
    audioBitsPerSecond: 192_000
  };
}

function buildRecorder(stream, preference) {
  const primaryMime = chooseRecorderMime(preference);
  if (!primaryMime) throw new Error('Chrome này không có MediaRecorder MP4/WebM phù hợp.');
  try {
    return { instance: new MediaRecorder(stream, recorderOptions(primaryMime)), mimeType: primaryMime };
  } catch (primaryError) {
    const fallbackMime = alternateRecorderMime(primaryMime);
    if (!fallbackMime) throw primaryError;
    return { instance: new MediaRecorder(stream, recorderOptions(fallbackMime)), mimeType: fallbackMime };
  }
}

async function openDirectWriter(expectedMime) {
  const handle = selectedFileHandle;
  if (!handle) return null;
  const expectedExt = `.${containerFromMime(expectedMime)}`;
  if (!handle.name.toLowerCase().endsWith(expectedExt)) {
    clearSelectedFile(`File đã chọn không khớp ${expectedExt}; bản ghi này sẽ giữ tạm để tải sau.`);
    return null;
  }
  activeFileHandle = handle;
  try {
    return await handle.createWritable();
  } catch (error) {
    activeFileHandle = null;
    setStatus(`Không mở được file lưu trực tiếp; chuyển sang bộ nhớ tạm (${error?.message || error}).`, 'warn');
    return null;
  }
}

function installRecorderEvents(instance) {
  instance.addEventListener('dataavailable', event => {
    if (!event.data || event.data.size === 0) return;
    bytesRecorded += event.data.size;
    refreshTimer();
    writeChain = writeChain.then(async () => {
      if (directWriteFailure) return;
      const writer = await writerReady;
      if (writer) {
        try {
          await writer.write(event.data);
        } catch (error) {
          directWriteFailure = error;
          console.error('[TabFlow Recorder] direct chunk write failed:', error);
          setStatus('Lỗi ghi file trực tiếp. TabFlow đang dừng ngay để không báo nhầm một video bị thiếu chunk là hoàn chỉnh.', 'error');
          queueMicrotask(() => {
            if (state === 'recording' || state === 'paused') stopRecording('write-error');
          });
        }
      } else {
        chunks.push(event.data);
      }
    });
  });

  instance.addEventListener('error', event => {
    console.error('[TabFlow Recorder] MediaRecorder error:', event.error || event);
    setStatus(`Recorder lỗi: ${event.error?.message || 'không xác định'}`, 'error');
  });

  instance.addEventListener('stop', () => {
    finalizeRecording().catch(error => {
      console.error('[TabFlow Recorder] finalize failed:', error);
      setState('idle', 'Lỗi');
      setStatus(`Không hoàn tất được video: ${error.message}`, 'error');
      cleanupStreams();
    });
  });
}

async function startRecording() {
  if (state === 'recording' || state === 'paused' || state === 'finalizing') return;
  if (!navigator.mediaDevices?.getDisplayMedia || !globalThis.MediaRecorder) {
    setStatus('Chrome này không hỗ trợ Screen Capture + MediaRecorder cần thiết.', 'error');
    return;
  }

  setState('selecting', 'Chọn nguồn…');
  setStatus('Chrome đang chờ bạn chọn màn hình, cửa sổ hoặc tab cần quay.');
  resultCard.hidden = true;
  clearObjectUrl();
  lastFile = null;
  lastDownloadId = null;
  showDownloadButton.hidden = true;
  chunks = [];
  bytesRecorded = 0;
  directWriteFailure = null;
  activeFileHandle = null;
  writeChain = Promise.resolve();
  writerReady = Promise.resolve(null);

  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia(buildDisplayMediaOptions({
      preset: qualitySelect.value,
      fps: Number(fpsSelect.value),
      systemAudio: systemAudioToggle.checked
    }));

    const videoTrack = displayStream.getVideoTracks()[0];
    if (!videoTrack) throw new Error('Không nhận được video track từ nguồn đã chọn.');
    await applyCaptureConstraints(videoTrack);
    actualSettings = videoTrack.getSettings?.() || {};
    videoTrack.addEventListener('ended', () => {
      if (state === 'recording' || state === 'paused') stopRecording('source-ended');
    }, { once: true });

    micStream = await requestMicrophone();
    recordingStream = await mixAudio(displayStream, micStream);

    const built = buildRecorder(recordingStream, formatSelect.value);
    recorder = built.instance;
    activeMime = built.mimeType;
    actualSettings = videoTrack.getSettings?.() || actualSettings;
    activeFilename = recordingFilename({
      mimeType: activeMime,
      width: Number(actualSettings.width || 0),
      height: Number(actualSettings.height || 0),
      fps: Number(actualSettings.frameRate || fpsSelect.value || 30)
    });

    preview.srcObject = displayStream;
    preview.controls = false;
    preview.muted = true;
    previewEmpty.hidden = true;
    await preview.play().catch(() => {});
    updateActualStats();

    installRecorderEvents(recorder);
    startedAt = performance.now();
    pausedAt = 0;
    totalPausedMs = 0;

    try {
      recorder.start(1000);
    } catch (startError) {
      const fallbackMime = alternateRecorderMime(activeMime);
      if (!fallbackMime) throw startError;
      recorder = new MediaRecorder(recordingStream, recorderOptions(fallbackMime));
      activeMime = fallbackMime;
      activeFilename = recordingFilename({
        mimeType: activeMime,
        width: Number(actualSettings.width || 0),
        height: Number(actualSettings.height || 0),
        fps: Number(actualSettings.frameRate || fpsSelect.value || 30)
      });
      clearSelectedFile('MP4/WebM fallback đổi container; lưu trực tiếp tắt cho bản ghi này để tránh sai đuôi file.');
      activeFileHandle = null;
      installRecorderEvents(recorder);
      recorder.start(1000);
    }

    writerReady = openDirectWriter(activeMime);
    setState('recording', 'Đang quay');
    startTimer();
    updateActualStats();
    setStatus(selectedFileHandle
      ? 'Đang quay; chunk video được ghi theo luồng để giảm áp lực RAM.'
      : 'Đang quay trong bộ nhớ tạm. Với 4K dài, lần sau nên chọn file lưu trực tiếp.',
    selectedFileHandle ? 'ok' : 'warn');
  } catch (error) {
    cleanupStreams();
    setState('idle', error?.name === 'NotAllowedError' ? 'Đã hủy' : 'Lỗi');
    setStatus(error?.name === 'NotAllowedError'
      ? 'Bạn đã hủy chọn nguồn quay.'
      : `Không bắt đầu quay được: ${error?.message || error}`,
    error?.name === 'NotAllowedError' ? '' : 'error');
  }
}

function pauseOrResume() {
  if (!recorder) return;
  if (state === 'recording' && recorder.state === 'recording') {
    recorder.pause();
    pausedAt = performance.now();
    setState('paused', 'Tạm dừng');
    setStatus('Đã tạm dừng; nguồn capture vẫn được giữ để tiếp tục ngay.');
    return;
  }
  if (state === 'paused' && recorder.state === 'paused') {
    if (pausedAt) totalPausedMs += performance.now() - pausedAt;
    pausedAt = 0;
    recorder.resume();
    setState('recording', 'Đang quay');
    setStatus('Đã tiếp tục quay.', 'ok');
  }
}

function stopRecording(reason = 'user') {
  if (!recorder || !(state === 'recording' || state === 'paused')) return;
  if (state === 'paused' && pausedAt) {
    totalPausedMs += performance.now() - pausedAt;
    pausedAt = 0;
  }
  lastDurationMs = elapsedMs();
  setState('finalizing', 'Đang hoàn tất…');
  if (reason === 'source-ended') {
    setStatus('Nguồn share đã dừng; đang hoàn tất file…');
  } else if (reason === 'write-error') {
    setStatus('Đang đóng recorder sau lỗi ghi trực tiếp để bảo vệ tính toàn vẹn dữ liệu…', 'error');
  } else {
    setStatus('Đang ghi nốt chunk cuối và đóng file…');
  }
  stopTimer();
  try {
    recorder.stop();
  } catch (error) {
    setStatus(`Không dừng MediaRecorder đúng cách: ${error.message}`, 'error');
    cleanupStreams();
    setState('idle', 'Lỗi');
  }
}

async function finalizeRecording() {
  await writeChain;
  const writer = await writerReady.catch(error => {
    directWriteFailure ||= error;
    return null;
  });

  if (directWriteFailure) {
    if (writer) {
      try { await writer.abort(); } catch {}
    }
    const failedName = activeFileHandle?.name || activeFilename || 'video';
    activeFileHandle = null;
    selectedFileHandle = null;
    chunks = [];
    cleanupStreams();
    throw new Error(`Ghi trực tiếp vào ${failedName} thất bại; TabFlow đã dừng thay vì xuất một video thiếu chunk.`);
  }

  if (writer) await writer.close();

  const directFileHandle = activeFileHandle;
  if (directFileHandle) {
    lastFile = await directFileHandle.getFile();
  } else {
    lastFile = new File(chunks, activeFilename || recordingFilename({ mimeType: activeMime }), { type: activeMime });
  }

  cleanupStreams();
  clearObjectUrl();
  lastObjectUrl = URL.createObjectURL(lastFile);
  preview.srcObject = null;
  preview.src = lastObjectUrl;
  preview.controls = true;
  preview.muted = false;
  previewEmpty.hidden = true;
  screenshotButton.disabled = false;

  resultCard.hidden = false;
  resultName.textContent = lastFile.name || activeFilename || 'Video đã sẵn sàng';
  resultMeta.textContent = `${formatBytes(lastFile.size)} · ${formatDuration(lastDurationMs)} · ${containerFromMime(activeMime).toUpperCase()} · ${Number(actualSettings.width || 0)}×${Number(actualSettings.height || 0)}`;
  saveTarget.textContent = directFileHandle
    ? `Đã lưu trực tiếp: ${directFileHandle.name}`
    : 'Video đang ở bộ nhớ tạm của trang; bấm “Tải video” để lưu xuống máy.';

  if (directFileHandle) {
    setStatus(`Đã ghi xong ${directFileHandle.name}. Bạn có thể xem lại hoặc tải thêm một bản sao.`, 'ok');
  } else {
    setStatus('Video đã sẵn sàng. Hãy tải xuống trước khi đóng tab Recorder.', 'ok');
  }

  activeFileHandle = null;
  selectedFileHandle = null;
  chunks = [];
  directWriteFailure = null;
  setState('ready', 'Đã xong');
  await refreshRecentDownloads();
}

function cleanupStreams() {
  const tracks = new Map();
  for (const stream of [displayStream, micStream, recordingStream]) {
    for (const track of stream?.getTracks?.() || []) tracks.set(track.id, track);
  }
  for (const track of tracks.values()) {
    try { track.stop(); } catch {}
  }
  displayStream = null;
  micStream = null;
  recordingStream = null;
  recorder = null;
  if (audioContext) audioContext.close().catch(() => {});
  audioContext = null;
  writerReady = Promise.resolve(null);
  writeChain = Promise.resolve();
  stopTimer();
}

async function chooseDirectSaveFile() {
  if (!('showSaveFilePicker' in window)) {
    setStatus('Chrome này không có File System Access; TabFlow sẽ dùng tải file sau khi dừng.', 'warn');
    return;
  }
  const mime = chooseRecorderMime(formatSelect.value);
  if (!mime) {
    setStatus('Không tìm thấy định dạng MediaRecorder phù hợp.', 'error');
    return;
  }
  const ext = containerFromMime(mime);
  const suggested = recordingFilename({
    mimeType: mime,
    width: qualitySelect.value === '4k' ? 3840 : qualitySelect.value === '1440p' ? 2560 : qualitySelect.value === '1080p' ? 1920 : 0,
    height: qualitySelect.value === '4k' ? 2160 : qualitySelect.value === '1440p' ? 1440 : qualitySelect.value === '1080p' ? 1080 : 0,
    fps: Number(fpsSelect.value)
  });
  try {
    selectedFileHandle = await window.showSaveFilePicker({
      id: 'tabflow-recorder-video',
      suggestedName: suggested,
      startIn: 'videos',
      types: [{
        description: `${ext.toUpperCase()} video`,
        accept: { [containerFromMime(mime) === 'mp4' ? 'video/mp4' : 'video/webm']: [`.${ext}`] }
      }]
    });
    saveTarget.textContent = `Sẽ ghi trực tiếp: ${selectedFileHandle.name}`;
    setStatus('Đã chọn file. Khi bắt đầu quay, chunk sẽ được ghi tuần tự xuống file này.', 'ok');
  } catch (error) {
    if (error?.name !== 'AbortError') setStatus(`Không chọn được file: ${error.message}`, 'error');
  }
}

async function downloadBlob(blob, filename, { saveAs = true } = {}) {
  const url = URL.createObjectURL(blob);
  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: `TabFlow Recordings/${filename}`,
      saveAs,
      conflictAction: 'uniquify'
    });
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return downloadId;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function downloadRecording() {
  if (!lastFile) return;
  downloadButton.disabled = true;
  try {
    lastDownloadId = await downloadBlob(lastFile, lastFile.name || activeFilename, { saveAs: true });
    showDownloadButton.hidden = false;
    setStatus('Đã gửi video sang Chrome Downloads.', 'ok');
    await refreshRecentDownloads();
  } catch (error) {
    setStatus(`Không tải được video: ${error.message}`, 'error');
  } finally {
    downloadButton.disabled = false;
  }
}

async function captureScreenshot() {
  let screenshotUrl = null;
  try {
    let width = 0;
    let height = 0;
    let drawable = null;
    const liveTrack = displayStream?.getVideoTracks?.()[0] || null;

    if (liveTrack && 'ImageCapture' in window) {
      drawable = await new ImageCapture(liveTrack).grabFrame();
      width = drawable.width;
      height = drawable.height;
    } else if (preview.videoWidth && preview.videoHeight) {
      drawable = preview;
      width = preview.videoWidth;
      height = preview.videoHeight;
    }

    if (!drawable || !width || !height) throw new Error('Chưa có frame video để chụp.');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    context.drawImage(drawable, 0, 0, width, height);
    drawable.close?.();
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('Không encode được PNG')), 'image/png');
    });
    screenshotUrl = URL.createObjectURL(blob);
    const id = await chrome.downloads.download({
      url: screenshotUrl,
      filename: `TabFlow Captures/${screenshotFilename()}`,
      saveAs: false,
      conflictAction: 'uniquify'
    });
    window.setTimeout(() => {
      if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
    }, 60_000);
    setStatus(`Đã chụp PNG ${width}×${height} (download #${id}).`, 'ok');
  } catch (error) {
    if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
    setStatus(`Không chụp được ảnh: ${error.message}`, 'error');
  }
}

function baseName(path = '') {
  return String(path).split(/[\\/]/).pop() || path;
}

async function refreshRecentDownloads() {
  try {
    const items = await chrome.downloads.search({ limit: 50 });
    const filtered = items
      .filter(item => /TabFlow-.*\.(?:mp4|webm)$/i.test(baseName(item.filename || '')))
      .sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')))
      .slice(0, 8);
    recentDownloads.replaceChildren();
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'recent-empty';
      empty.textContent = 'Chưa có video tải gần đây.';
      recentDownloads.appendChild(empty);
      return;
    }

    for (const item of filtered) {
      const row = document.createElement('div');
      row.className = 'recent-item';
      const copy = document.createElement('div');
      copy.className = 'recent-copy';
      const title = document.createElement('strong');
      title.textContent = baseName(item.filename || `Download ${item.id}`);
      const meta = document.createElement('span');
      meta.textContent = `${formatBytes(item.fileSize || item.bytesReceived || 0)} · ${item.state || 'unknown'}`;
      copy.append(title, meta);
      const actions = document.createElement('div');
      actions.className = 'recent-actions';
      const open = document.createElement('button');
      open.className = 'icon-button';
      open.type = 'button';
      open.textContent = '▶';
      open.title = 'Mở video';
      open.addEventListener('click', () => {
        Promise.resolve(chrome.downloads.open(item.id)).catch(() => {});
      });
      const show = document.createElement('button');
      show.className = 'icon-button';
      show.type = 'button';
      show.textContent = '⌕';
      show.title = 'Hiện trong thư mục';
      show.addEventListener('click', () => chrome.downloads.show(item.id));
      actions.append(open, show);
      row.append(copy, actions);
      recentDownloads.appendChild(row);
    }
  } catch (error) {
    console.warn('[TabFlow Recorder] downloads history unavailable:', error?.message || error);
  }
}

function refreshCodecHealth() {
  const supported = supportedRecorderMimes();
  const mp4 = supported.some(type => type.includes('mp4'));
  const webm = supported.some(type => type.includes('webm'));
  codecHealth.textContent = mp4 && webm ? 'MP4 + WebM' : mp4 ? 'MP4' : webm ? 'WebM' : 'Không hỗ trợ';
  codecHealth.className = `mini-pill ${mp4 || webm ? 'status-ok' : 'status-error'}`;
  const mp4Option = [...formatSelect.options].find(option => option.value === 'mp4');
  if (mp4Option) mp4Option.disabled = !mp4;
  updateControls();
}

function installEvents() {
  startButton.addEventListener('click', startRecording);
  pauseButton.addEventListener('click', pauseOrResume);
  stopButton.addEventListener('click', () => stopRecording('user'));
  screenshotButton.addEventListener('click', captureScreenshot);
  pickFileButton.addEventListener('click', chooseDirectSaveFile);
  downloadButton.addEventListener('click', downloadRecording);
  showDownloadButton.addEventListener('click', () => {
    if (Number.isInteger(lastDownloadId)) chrome.downloads.show(lastDownloadId);
  });
  $('btn-refresh-downloads').addEventListener('click', refreshRecentDownloads);

  for (const control of [qualitySelect, fpsSelect, formatSelect]) {
    control.addEventListener('change', () => {
      if (selectedFileHandle) clearSelectedFile('Thiết lập video đã đổi; hãy chọn lại file lưu trực tiếp để khớp định dạng.');
      const width = Number(actualSettings.width || 0);
      const height = Number(actualSettings.height || 0);
      if (width && height) updateActualStats();
    });
  }

  window.addEventListener('beforeunload', event => {
    if (state === 'recording' || state === 'paused' || state === 'finalizing') {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

function init() {
  installEvents();
  refreshCodecHealth();
  refreshRecentDownloads();
  if (!('showSaveFilePicker' in window)) {
    pickFileButton.disabled = true;
    saveTarget.textContent = 'Lưu trực tiếp không khả dụng; video sẽ được giữ tạm rồi tải bằng Chrome Downloads.';
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    startButton.disabled = true;
    setStatus('Screen Capture API không khả dụng trong Chrome này.', 'error');
  }
  setState('idle', 'Sẵn sàng');
}

init();
