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

  console.log('✅ Workspace side-panel Chromium E2E passed');
} finally {
  if (context) await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
