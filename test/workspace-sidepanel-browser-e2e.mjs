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

  await panel.locator('#runtime-coop-toggle').uncheck();
  await panel.waitForFunction(async () => {
    const data = await chrome.storage.local.get('tabflowRuntimeSettingsV3');
    return data.tabflowRuntimeSettingsV3?.cooperativeEnabled === false;
  });
  await panel.locator('#runtime-coop-toggle').check();
  await panel.waitForFunction(async () => {
    const data = await chrome.storage.local.get('tabflowRuntimeSettingsV3');
    return data.tabflowRuntimeSettingsV3?.cooperativeEnabled === true;
  });

  await panel.locator('#runtime-auto-sleep-toggle').uncheck();
  await panel.waitForFunction(async () => {
    const data = await chrome.storage.local.get('settings');
    return data.settings?.autoDiscardEnabled === false;
  });
  assert.equal(await panel.locator('#runtime-idle-minutes').isDisabled(), true, 'idle threshold disables when auto-sleep is off');
  await panel.locator('#runtime-auto-sleep-toggle').check();
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

  const workspacePagesBefore = context.pages().filter(page => page.url().includes('/workspace/index.html')).length;
  await panel.locator('#btn-open-coding-hub').click();
  await panel.waitForFunction(
    async before => {
      const tabs = await chrome.tabs.query({});
      return tabs.filter(tab => String(tab.url || '').includes('/workspace/index.html')).length > before;
    },
    workspacePagesBefore
  );

  console.log('✅ Workspace side-panel policy + Control Center Runtime Chromium E2E passed');
} finally {
  if (context) await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
