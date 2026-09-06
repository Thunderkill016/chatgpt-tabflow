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
    window.__tabflowRecorderPaint = setInterval(paint, 33);
    window.__tabflowRecorderCanvas = source;

    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async () => source.captureStream(30)
    });
  });
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
  assert.equal(await page.locator('#btn-screenshot').isEnabled(), true, 'standalone screenshot is available before recording');
  assert.match(await page.locator('#status-message').textContent(), /không upload video/i, 'recorder advertises local-only data flow');

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

  await page.locator('#btn-stop').click();
  await page.waitForFunction(() => document.getElementById('recorder-state-pill')?.textContent === 'Đã xong', null, { timeout: 20_000 });
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

  console.log('✅ Capture Studio record/pause/resume/stop + standalone screenshot Chromium E2E passed');
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
