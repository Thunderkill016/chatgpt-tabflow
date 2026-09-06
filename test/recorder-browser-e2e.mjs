import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabflow-recorder-e2e-'));
let context = null;

async function extensionId(browserContext) {
  let worker = browserContext.serviceWorkers().find(item => item.url().startsWith('chrome-extension://'));
  if (!worker) {
    worker = await browserContext.waitForEvent('serviceworker', {
      timeout: 20_000,
      predicate: item => item.url().startsWith('chrome-extension://')
    });
  }
  return new URL(worker.url()).host;
}

async function installSyntheticDisplayCapture(page) {
  await page.evaluate(() => {
    const source = document.createElement('canvas');
    source.width = 1280;
    source.height = 720;
    const ctx = source.getContext('2d');
    let frame = 0;
    const paint = () => {
      frame += 1;
      ctx.fillStyle = frame % 2 ? '#10233d' : '#13c998';
      ctx.fillRect(0, 0, source.width, source.height);
      ctx.fillStyle = '#fff';
      ctx.font = '32px sans-serif';
      ctx.fillText(`TabFlow Recorder E2E ${frame}`, 40, 70);
    };
    paint();
    if (window.__tabflowRecorderPaint) clearInterval(window.__tabflowRecorderPaint);
    window.__tabflowRecorderPaint = setInterval(paint, 33);
    window.__tabflowRecorderCanvas = source;

    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async () => source.captureStream(30)
    });
  });
}

async function stopAndWait(page) {
  await page.locator('#btn-stop').click();
  await page.waitForFunction(() => document.getElementById('recorder-state-pill')?.textContent === 'Đã xong', null, { timeout: 20_000 });
}

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${root}`,
      `--load-extension=${root}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  const id = await extensionId(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/recorder/index.html`);
  await page.waitForSelector('#btn-start');
  await page.waitForFunction(() => document.getElementById('codec-health')?.textContent !== 'Đang kiểm tra');

  assert.equal(await page.locator('#quality-select').inputValue(), '4k', 'real 4K target is the default');
  assert.equal(await page.locator('#publish-profile-select').inputValue(), 'master', 'Master remains the default capture profile');
  assert.equal(await page.locator('#btn-screenshot').isEnabled(), true, 'standalone screenshot is available before recording');
  assert.match(await page.locator('#status-message').textContent(), /không upload video/i, 'recorder advertises local-only data flow');

  // Social Ready must deterministically lock output to the conservative cross-platform profile.
  await page.locator('#publish-profile-select').selectOption('social');
  await page.waitForFunction(() => document.getElementById('quality-select')?.value === '1080p');
  assert.equal(await page.locator('#quality-select').inputValue(), '1080p', 'Social Ready caps capture at 1080p');
  assert.equal(await page.locator('#fps-select').inputValue(), '30', 'Social Ready caps capture at 30 FPS');
  assert.equal(await page.locator('#format-select').inputValue(), 'mp4', 'Social Ready requires MP4');
  assert.equal(await page.locator('#quality-select').isDisabled(), true, 'Social Ready locks resolution to its compatibility contract');
  assert.equal(await page.locator('#fps-select').isDisabled(), true, 'Social Ready locks FPS to its compatibility contract');
  assert.equal(await page.locator('#format-select').isDisabled(), true, 'Social Ready locks container to MP4');

  const socialCodecAvailable = await page.evaluate(() =>
    MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E,mp4a.40.2') ||
    MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.4D401F,mp4a.40.2')
  );

  if (socialCodecAvailable) {
    await installSyntheticDisplayCapture(page);
    await page.locator('#btn-start').click();
    await page.waitForFunction(() => document.getElementById('recorder-state-pill')?.textContent === 'Đang quay', null, { timeout: 15_000 });
    await page.waitForTimeout(900);
    await stopAndWait(page);
    assert.match(await page.locator('#result-meta').textContent(), /MP4/i, 'Social Ready records an MP4 container when strict social codec is available');
    assert.match(await page.locator('#social-compatibility').textContent(), /Social Ready|X non-Premium/i, 'Social Ready reports upload compatibility after recording');
  }

  await page.locator('#publish-profile-select').selectOption('master');
  await page.waitForFunction(() => document.getElementById('quality-select')?.disabled === false);

  await installSyntheticDisplayCapture(page);

  // Standalone screenshot: this must work without starting a recording first.
  await page.locator('#btn-screenshot').click();
  await page.waitForFunction(() => /Đã chụp PNG/.test(document.getElementById('status-message')?.textContent || ''), null, { timeout: 15_000 });
  assert.equal(await page.locator('#btn-screenshot').isEnabled(), true, 'standalone screenshot returns to ready state');

  // Reinstall because the screenshot flow stops its temporary capture track.
  await installSyntheticDisplayCapture(page);
  await page.locator('#format-select').selectOption('webm');
  await page.locator('#fps-select').selectOption('30');
  await page.locator('#btn-start').click();
  await page.waitForFunction(() => document.getElementById('recorder-state-pill')?.textContent === 'Đang quay', null, { timeout: 15_000 });
  assert.equal(await page.locator('#btn-stop').isEnabled(), true, 'stop is enabled while recording');
  assert.equal(await page.locator('#btn-pause').isEnabled(), true, 'pause is enabled while recording');

  await page.waitForTimeout(450);
  await page.locator('#btn-pause').click();
  await page.waitForFunction(() => document.getElementById('recorder-state-pill')?.textContent === 'Tạm dừng');
  await page.waitForTimeout(120);
  await page.locator('#btn-pause').click();
  await page.waitForFunction(() => document.getElementById('recorder-state-pill')?.textContent === 'Đang quay');
  await page.waitForTimeout(850);

  await stopAndWait(page);
  assert.equal(await page.locator('#result-card').isVisible(), true, 'completed recording exposes result card');
  assert.match(await page.locator('#result-meta').textContent(), /WEBM/i, 'selected WebM container is reported');
  assert.match(await page.locator('#result-meta').textContent(), /1280×720/, 'actual source resolution is reported instead of fake 4K');
  assert.match(await page.locator('#resolution-note').textContent(), /không upscale giả/i, 'sub-4K source is never mislabeled as 4K');

  const result = await page.evaluate(() => ({
    downloadPermission: chrome.runtime.getManifest().permissions.includes('downloads'),
    resultName: document.getElementById('result-name')?.textContent || '',
    resultMeta: document.getElementById('result-meta')?.textContent || ''
  }));
  assert.equal(result.downloadPermission, true, 'Downloads API permission is available in the real unpacked extension');
  assert.match(result.resultName, /\.webm$/i, 'completed recording has a WebM filename');
  assert.doesNotMatch(result.resultMeta, /^0 B/, 'completed recording contains bytes');

  console.log('✅ Capture Studio Social Ready + record/pause/resume/stop + standalone screenshot Chromium E2E passed');
} finally {
  if (context) {
    for (const page of context.pages()) {
      await page.evaluate(() => {
        if (window.__tabflowRecorderPaint) clearInterval(window.__tabflowRecorderPaint);
      }).catch(() => {});
    }
    await context.close();
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
