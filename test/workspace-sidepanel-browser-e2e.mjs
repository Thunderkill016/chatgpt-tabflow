import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabflow-sidepanel-e2e-'));
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

async function clickSwitch(page, inputId, checked) {
  const input = page.locator(`#${inputId}`);
  if (await input.isChecked() === checked) return;
  await page.locator(`#${inputId} + span`).click();
  await page.waitForFunction(
    ({ id, expected }) => document.getElementById(id)?.checked === expected,
    { id: inputId, expected: checked }
  );
}

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1200, height: 800 },
    args: [
      `--disable-extensions-except=${root}`,
      `--load-extension=${root}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  const id = await extensionId(context);
  const control = await context.newPage();
  await control.goto(`chrome-extension://${id}/options/options.html`);

  const result = await control.evaluate(async () => {
    const defaultBefore = await chrome.sidePanel.getOptions({});
    const workspaceUrl = chrome.runtime.getURL('workspace/index.html');
    const workspaceTab = await chrome.tabs.create({ url: workspaceUrl, active: true });

    const deadline = Date.now() + 8_000;
    let workspaceOptions = null;
    while (Date.now() < deadline) {
      workspaceOptions = await chrome.sidePanel.getOptions({ tabId: workspaceTab.id });
      if (workspaceOptions.enabled === false) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const defaultAfter = await chrome.sidePanel.getOptions({});
    return {
      workspaceTabId: workspaceTab.id,
      workspaceEnabled: workspaceOptions?.enabled,
      defaultBeforeEnabled: defaultBefore.enabled,
      defaultAfterEnabled: defaultAfter.enabled,
      workspacePath: workspaceOptions?.path || ''
    };
  });

  assert.ok(Number.isInteger(result.workspaceTabId), 'workspace tab was created');
  assert.equal(result.workspaceEnabled, false, 'Workspace tab has the Chrome side panel disabled');
  assert.equal(
    result.defaultAfterEnabled,
    result.defaultBeforeEnabled,
    'Workspace policy does not disable the global/default side panel for normal tabs'
  );

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/v3/sidepanel.html`);
  await panel.waitForSelector('#control-current-chat');

  assert.equal(await panel.locator('#badge-version').textContent(), 'v3.2.0', 'Control Center version comes from manifest');
  assert.equal(await panel.locator('text=RAM TIẾT KIỆM').count(), 0, 'legacy estimated RAM metric is absent');
  assert.equal(await panel.locator('#btn-open-coding-hub').count(), 1, 'Unified Workspace remains the primary action');
  assert.equal(await panel.locator('#active-tabs-view').isVisible(), true, 'Chats view is visible by default');

  await panel.locator('#tab-nav-memory').click();
  await panel.waitForFunction(() => document.getElementById('memory-view')?.style.display === 'flex');
  assert.equal(await panel.locator('#memory-view').isVisible(), true, 'Memory view opens from Control Center nav');

  await panel.locator('#tab-nav-runtime').click();
  await panel.waitForFunction(() => document.getElementById('runtime-view')?.style.display === 'flex');
  assert.equal(await panel.locator('#runtime-view').isVisible(), true, 'Runtime view opens from Control Center nav');
  assert.equal(await panel.locator('text=Recommended budget').count(), 0, 'Runtime hides internal scheduler jargon');
  assert.equal(await panel.locator('.runtime-locked').textContent(), 'Luôn bật', 'productive-chat protection is visibly non-optional');

  await clickSwitch(panel, 'runtime-coop-toggle', false);
  await panel.waitForFunction(async () => {
    const data = await chrome.storage.local.get('tabflowRuntimeSettingsV3');
    return data.tabflowRuntimeSettingsV3?.cooperativeEnabled === false;
  });
  await clickSwitch(panel, 'runtime-coop-toggle', true);
  await panel.waitForFunction(async () => {
    const data = await chrome.storage.local.get('tabflowRuntimeSettingsV3');
    return data.tabflowRuntimeSettingsV3?.cooperativeEnabled === true;
  });

  await clickSwitch(panel, 'runtime-auto-sleep-toggle', false);
  await panel.waitForFunction(async () => {
    const data = await chrome.storage.local.get('settings');
    return data.settings?.autoDiscardEnabled === false;
  });
  await clickSwitch(panel, 'runtime-auto-sleep-toggle', true);
  await panel.waitForFunction(async () => {
    const data = await chrome.storage.local.get('settings');
    return data.settings?.autoDiscardEnabled === true;
  });

  await panel.locator('#runtime-idle-minutes').selectOption('10');
  await panel.waitForFunction(async () => {
    const data = await chrome.storage.local.get('settings');
    return Number(data.settings?.discardIdleMinutes) === 10;
  });
  await panel.locator('#runtime-idle-minutes').selectOption('5');

  await panel.locator('#runtime-parallel-select').selectOption('4');
  await panel.waitForFunction(async () => {
    const data = await chrome.storage.local.get('tabflowRuntimeSettingsV3');
    return Number(data.tabflowRuntimeSettingsV3?.maxParallelGenerators) === 4;
  });
  await panel.locator('#runtime-parallel-select').selectOption('2');

  await panel.locator('#runtime-optimize-btn').click();
  await panel.waitForFunction(() => document.getElementById('runtime-optimize-btn')?.disabled === false);
  assert.equal(await panel.locator('#runtime-optimize-btn').textContent(), 'Tối ưu chat nền ngay', 'optimize action returns to ready state');

  await panel.locator('.control-tools > summary').click();
  assert.equal(await panel.locator('#btn-open-recorder').isVisible(), true, 'Capture Studio action is visible in Control Center tools');
  const recorderPagePromise = context.waitForEvent('page', {
    timeout: 10_000,
    predicate: page => page.url().includes('/recorder/index.html')
  });
  await panel.locator('#btn-open-recorder').click();
  const recorderPage = await recorderPagePromise;
  await recorderPage.waitForLoadState('domcontentloaded');
  await recorderPage.waitForSelector('#btn-start');

  assert.equal(await recorderPage.locator('#quality-select').inputValue(), '4k', 'Capture Studio defaults to the real-4K target');
  assert.ok(await recorderPage.locator('#fps-select option[value="60"]').count(), 'Capture Studio exposes 60 FPS');
  assert.equal(await recorderPage.locator('#btn-screenshot').count(), 1, 'Capture Studio exposes full-resolution PNG capture');
  assert.equal(await recorderPage.locator('#btn-download').count(), 1, 'Capture Studio exposes video download');
  await recorderPage.waitForFunction(() => document.getElementById('codec-health')?.textContent !== 'Đang kiểm tra');

  const recorderEnvironment = await recorderPage.evaluate(() => ({
    downloadsPermission: chrome.runtime.getManifest().permissions.includes('downloads'),
    hasMediaRecorder: typeof MediaRecorder === 'function',
    hasDisplayCapture: typeof navigator.mediaDevices?.getDisplayMedia === 'function'
  }));
  assert.equal(recorderEnvironment.downloadsPermission, true, 'Capture Studio has Downloads API permission');
  assert.equal(recorderEnvironment.hasMediaRecorder, true, 'real Chromium exposes MediaRecorder to Capture Studio');
  assert.equal(recorderEnvironment.hasDisplayCapture, true, 'real Chromium exposes getDisplayMedia to Capture Studio');

  const syntheticRecording = await recorderPage.evaluate(async () => {
    const source = document.createElement('canvas');
    source.width = 640;
    source.height = 360;
    const ctx = source.getContext('2d');
    const stream = source.captureStream(30);
    const candidates = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const mimeType = candidates.find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) return { supported: false, size: 0 };

    const chunks = [];
    const mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_000_000 });
    mediaRecorder.addEventListener('dataavailable', event => {
      if (event.data?.size) chunks.push(event.data);
    });
    const stopped = new Promise((resolve, reject) => {
      mediaRecorder.addEventListener('stop', resolve, { once: true });
      mediaRecorder.addEventListener('error', event => reject(event.error || new Error('MediaRecorder error')), { once: true });
    });

    let frame = 0;
    const paint = setInterval(() => {
      frame += 1;
      ctx.fillStyle = frame % 2 ? '#10233d' : '#1dc69a';
      ctx.fillRect(0, 0, source.width, source.height);
      ctx.fillStyle = '#fff';
      ctx.font = '24px sans-serif';
      ctx.fillText(`TabFlow ${frame}`, 30, 50);
    }, 40);

    mediaRecorder.start(100);
    await new Promise(resolve => setTimeout(resolve, 450));
    mediaRecorder.stop();
    await stopped;
    clearInterval(paint);
    for (const track of stream.getTracks()) track.stop();
    return {
      supported: true,
      mimeType,
      chunks: chunks.length,
      size: chunks.reduce((total, chunk) => total + chunk.size, 0)
    };
  });
  assert.equal(syntheticRecording.supported, true, 'Chromium supports at least one Recorder container');
  assert.ok(syntheticRecording.chunks > 0, 'MediaRecorder emitted bounded chunks');
  assert.ok(syntheticRecording.size > 0, 'MediaRecorder produced non-empty video bytes');
  await recorderPage.close();

  const workspacePagesBefore = context.pages().filter(page => page.url().includes('/workspace/index.html')).length;
  await panel.locator('#btn-open-coding-hub').click();
  await panel.waitForFunction(
    async before => {
      const tabs = await chrome.tabs.query({});
      return tabs.filter(tab => String(tab.url || '').includes('/workspace/index.html')).length > before;
    },
    workspacePagesBefore
  );

  console.log('✅ Workspace + Control Center Runtime + Capture Studio Chromium E2E passed');
} finally {
  if (context) await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
