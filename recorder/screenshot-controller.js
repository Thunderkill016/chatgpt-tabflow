import {
  buildDisplayMediaOptions,
  postSelectionConstraints,
  screenshotFilename
} from './core.js';

const button = document.getElementById('btn-screenshot');
const preview = document.getElementById('preview');
const canvas = document.getElementById('capture-canvas');
const qualitySelect = document.getElementById('quality-select');
const fpsSelect = document.getElementById('fps-select');
const statusMessage = document.getElementById('status-message');
const statePill = document.getElementById('recorder-state-pill');

function setStatus(message, tone = '') {
  if (!statusMessage) return;
  statusMessage.textContent = message;
  statusMessage.className = tone ? `status-${tone}` : '';
}

function setState(label, className = 'idle') {
  if (!statePill) return;
  statePill.textContent = label;
  statePill.className = `state-pill ${className}`;
}

function hasExistingFrameSource() {
  const liveTracks = preview?.srcObject?.getVideoTracks?.() || [];
  return liveTracks.length > 0 || Boolean(preview?.videoWidth && preview?.videoHeight);
}

async function frameFromStream(stream) {
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error('Nguồn đã chọn không có video track.');

  try {
    await track.applyConstraints(postSelectionConstraints({
      preset: qualitySelect?.value || '4k',
      fps: Number(fpsSelect?.value || 30)
    }));
  } catch (error) {
    console.warn('[TabFlow Screenshot] capture constraints not fully applied:', error?.message || error);
  }

  if ('ImageCapture' in window) {
    const bitmap = await new ImageCapture(track).grabFrame();
    return {
      drawable: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close?.()
    };
  }

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth || !video.videoHeight) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Không đọc được kích thước nguồn chụp.')), 5000);
      video.addEventListener('loadedmetadata', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
  return {
    drawable: video,
    width: video.videoWidth,
    height: video.videoHeight,
    close: () => {
      video.pause();
      video.srcObject = null;
    }
  };
}

async function standaloneScreenshot() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setStatus('Screen Capture API không khả dụng trong Chrome này.', 'error');
    return;
  }

  let stream = null;
  let frame = null;
  let objectUrl = null;
  button.disabled = true;
  setState('Chọn nguồn chụp…', 'selecting');
  setStatus('Chọn màn hình, cửa sổ hoặc tab cần chụp trong hộp thoại của Chrome.');

  try {
    stream = await navigator.mediaDevices.getDisplayMedia(buildDisplayMediaOptions({
      preset: qualitySelect?.value || '4k',
      fps: Number(fpsSelect?.value || 30),
      systemAudio: false
    }));
    frame = await frameFromStream(stream);
    if (!frame.width || !frame.height) throw new Error('Nguồn chụp không có kích thước hợp lệ.');

    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Không tạo được canvas chụp ảnh.');
    context.drawImage(frame.drawable, 0, 0, frame.width, frame.height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('Không encode được PNG.')), 'image/png');
    });
    objectUrl = URL.createObjectURL(blob);
    const downloadId = await chrome.downloads.download({
      url: objectUrl,
      filename: `TabFlow Captures/${screenshotFilename()}`,
      saveAs: false,
      conflictAction: 'uniquify'
    });
    setStatus(`Đã chụp PNG ${frame.width}×${frame.height} (download #${downloadId}).`, 'ok');
    setState('Đã chụp', 'ready');
  } catch (error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') {
      setStatus('Bạn đã hủy chọn nguồn chụp.');
      setState('Sẵn sàng', 'idle');
    } else {
      setStatus(`Không chụp được ảnh: ${error?.message || error}`, 'error');
      setState('Lỗi chụp', 'idle');
    }
  } finally {
    frame?.close?.();
    for (const track of stream?.getTracks?.() || []) {
      try { track.stop(); } catch {}
    }
    if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    button.disabled = false;
  }
}

button?.addEventListener('click', event => {
  if (hasExistingFrameSource()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  standaloneScreenshot().catch(error => {
    console.error('[TabFlow Screenshot] standalone capture failed:', error);
    setStatus(`Không chụp được ảnh: ${error?.message || error}`, 'error');
    button.disabled = false;
  });
}, { capture: true });

// recorder.js disables screenshot while there is no active/recorded stream.
// Standalone screenshot is intentionally allowed from the idle studio state.
if (button && navigator.mediaDevices?.getDisplayMedia) button.disabled = false;
