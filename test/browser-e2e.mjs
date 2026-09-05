import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = path.join(root, 'artifacts', 'browser-e2e');
fs.mkdirSync(artifactDir, { recursive: true });

const PROJECT_ID = 'tabflow-browser-e2e';
const GATE_MARKER = 'TF-GATE2-KAPPA-731';
const FILE_PATH = 'src/audio/gate2-clock.ts';
const LIVE_CODE = `// ${FILE_PATH}\nexport function parseAudioClock(value: string): bigint {\n  return BigInt(value); // LIVE\n}`;
const STALE_CODE = `// ${FILE_PATH}\nexport function parseAudioClock(value: string): number {\n  return Number(value); // STALE\n}`;

const submits = [];
let workspacePage = null;
let context = null;
let server = null;
let userDataDir = '';
let certDir = '';

function logGate(name, detail = '') {
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(artifactDir, name), JSON.stringify(value, null, 2));
}

function createCertificate() {
  certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabflow-cert-'));
  const key = path.join(certDir, 'key.pem');
  const cert = path.join(certDir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key,
    '-out', cert,
    '-days', '1',
    '-subj', '/CN=chatgpt.com',
    '-addext', 'subjectAltName=DNS:chatgpt.com,DNS:chat.openai.com,DNS:outside.test'
  ], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

function archivePayload(conversationId) {
  return {
    title: `Archive ${conversationId}`,
    current_node: 'm-live',
    mapping: {
      root: { id: 'root', parent: null, children: ['m-live'], message: null },
      'm-live': {
        id: 'm-live',
        parent: 'root',
        children: [],
        message: {
          author: { role: 'assistant' },
          create_time: 1,
          content: { parts: [`\`\`\`typescript\n${STALE_CODE}\n\`\`\``] }
        }
      }
    }
  };
}

function chatHtml(pathname) {
  const id = pathname.startsWith('/c/') ? pathname.slice(3) : 'new';
  const isA = id === 'a';
  const initialMessages = isA ? `
    <section id="messages">
      <article data-message-author-role="user" data-message-id="rule-a">
        Quy tắc kiến trúc mới: parseAudioClock bắt buộc trả về bigint. Không được convert sang number ở bất kỳ layer nào. Marker xác minh: ${GATE_MARKER}.
      </article>
      <article data-message-author-role="assistant" data-message-id="m-live">
        Implementation hiện tại.
        <div class="codewrap">
          <div><span>${FILE_PATH}</span></div>
          <pre><code class="language-typescript">${LIVE_CODE.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</code></pre>
        </div>
      </article>
    </section>` : '<section id="messages"></section>';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Conversation ${id.toUpperCase()} - ChatGPT</title>
  <style>
    body{font:14px system-ui;margin:24px;background:#212121;color:#eee} textarea{width:80%;height:80px} button{margin:8px;padding:6px 10px} pre{white-space:pre-wrap}.chunk{opacity:.7}
  </style>
</head>
<body>
  ${initialMessages}
  <form id="composer">
    <textarea id="prompt-textarea" aria-label="Prompt"></textarea>
    <button type="submit" data-testid="composer-submit" aria-label="Send">Send</button>
  </form>
  <div id="stream"></div>
  <script>
    (() => {
      const form = document.getElementById('composer');
      const textarea = document.getElementById('prompt-textarea');
      const stream = document.getElementById('stream');
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const prompt = textarea.value;
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.dataset.testid = 'stop-button';
        stop.setAttribute('aria-label', 'Stop generating');
        stop.textContent = 'Stop';
        form.appendChild(stop);
        try {
          const response = await fetch(location.origin + '/backend-api/conversation', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              client_context: location.pathname,
              messages: [{
                author: { role: 'user' },
                content: { parts: [prompt] }
              }]
            })
          });
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const span = document.createElement('span');
            span.className = 'chunk';
            span.textContent = decoder.decode(value, { stream: true });
            stream.appendChild(span);
          }
        } finally {
          stop.remove();
        }
      });
    })();
  </script>
</body>
</html>`;
}

function outsideHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Outside Host</title></head><body>
  <h1>Outside embedding host</h1>
  <iframe id="outside-frame" src="https://chatgpt.com/c/outside"></iframe>
  </body></html>`;
}

function startMockServer() {
  const tls = createCertificate();
  server = https.createServer(tls, (req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const url = new URL(req.url || '/', `https://${host || 'chatgpt.com'}`);

    if (host === 'outside.test') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(outsideHtml());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/backend-api/conversation') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch {}
        submits.push({ at: Date.now(), raw: body, body: parsed });
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        });
        let index = 0;
        const timer = setInterval(() => {
          index += 1;
          res.write(`data: chunk-${index}\n\n`);
          if (index >= 28) {
            clearInterval(timer);
            res.end();
          }
        }, 220);
      });
      return;
    }

    const archiveMatch = url.pathname.match(/^\/backend-api\/conversation\/([^/]+)$/);
    if (req.method === 'GET' && archiveMatch) {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      });
      res.end(JSON.stringify(archivePayload(archiveMatch[1])));
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
    });
    res.end(chatHtml(url.pathname));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(address.port);
    });
  });
}

async function waitForExtensionId(browserContext) {
  let workers = browserContext.serviceWorkers();
  let worker = workers.find(item => item.url().startsWith('chrome-extension://'));
  if (!worker) {
    worker = await browserContext.waitForEvent('serviceworker', {
      timeout: 20_000,
      predicate: item => item.url().startsWith('chrome-extension://')
    });
  }
  return new URL(worker.url()).host;
}

async function extensionRpc(page, type, payload) {
  return page.evaluate(({ type, payload }) => new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'TABFLOW_MEMORY_CLIENT' });
    const requestId = `e2e-${Date.now()}-${Math.random()}`;
    const timer = setTimeout(() => {
      try { port.disconnect(); } catch {}
      reject(new Error(`RPC timeout: ${type}`));
    }, 15_000);
    port.onMessage.addListener(message => {
      if (message?.requestId !== requestId) return;
      clearTimeout(timer);
      try { port.disconnect(); } catch {}
      if (message.ok) resolve(message.result);
      else reject(new Error(message.error?.message || `RPC failed: ${type}`));
    });
    port.postMessage({ requestId, type, payload });
  }), { type, payload });
}

async function getPaneByTitle(page, title) {
  const pane = page.locator('.chat-pane').filter({
    has: page.locator('.pane-title', { hasText: title })
  }).first();
  await pane.waitFor({ state: 'visible', timeout: 15_000 });
  return pane;
}

async function frameForPane(pane) {
  const handle = await pane.locator('iframe').elementHandle();
  assert.ok(handle, 'pane iframe exists');
  const frame = await handle.contentFrame();
  assert.ok(frame, 'pane iframe has a browsing context');
  return frame;
}

async function waitForMemoryReady(frame, expected = 'RAG ready') {
  await frame.waitForFunction(expectedText => {
    const host = document.getElementById('tabflow-memory-status-host');
    const text = host?.shadowRoot?.getElementById('text')?.textContent || '';
    return text.includes(expectedText);
  }, expected, { timeout: 15_000 });
}

async function waitForSubmit(clientContext, previousCount = 0) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const matches = submits.filter(item => item.body?.client_context === clientContext);
    if (matches.length > previousCount) return matches[matches.length - 1];
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for submit from ${clientContext}`);
}

function latestPrompt(submit) {
  return String(submit?.body?.messages?.at(-1)?.content?.parts?.at(-1) || '');
}

async function main() {
  const port = await startMockServer();
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabflow-browser-e2e-'));
  const hostRules = [
    `MAP chatgpt.com 127.0.0.1:${port}`,
    `MAP chat.openai.com 127.0.0.1:${port}`,
    `MAP outside.test 127.0.0.1:${port}`,
    'EXCLUDE localhost'
  ].join(',');

  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 960 },
    args: [
      `--disable-extensions-except=${root}`,
      `--load-extension=${root}`,
      `--host-resolver-rules=${hostRules}`,
      '--ignore-certificate-errors',
      '--disable-features=HttpsUpgrades',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  const extensionId = await waitForExtensionId(context);
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/options/options.html`);
  await control.evaluate(async ({ projectId }) => {
    await chrome.storage.local.set({
      tabflowRuntimeSettingsV3: {
        projectId,
        projectName: 'Browser E2E Project',
        desiredGeneratingTabs: 3
      },
      projectVault: [{
        id: projectId,
        name: 'Browser E2E Project',
        stack: 'TypeScript, Web Audio API',
        rules: 'parseAudioClock stays bigint. Never convert it to number.'
      }],
      settings: {
        autoDiscardEnabled: false,
        discardIdleMinutes: 60,
        groupTabsEnabled: false,
        groupName: 'E2E',
        groupColor: 'purple'
      }
    });
  }, { projectId: PROJECT_ID });

  const sourceA = await context.newPage();
  const sourceB = await context.newPage();
  const sourceD = await context.newPage();
  await Promise.all([
    sourceA.goto('https://chatgpt.com/c/a'),
    sourceB.goto('https://chatgpt.com/c/b'),
    sourceD.goto('https://chatgpt.com/c/d')
  ]);

  workspacePage = await context.newPage();
  await workspacePage.goto(`chrome-extension://${extensionId}/workspace/index.html`);
  await workspacePage.waitForFunction(() => document.querySelectorAll('.chat-pane').length >= 3, null, { timeout: 20_000 });
  await workspacePage.waitForFunction(() => {
    const panes = [...document.querySelectorAll('.chat-pane')];
    return panes.length >= 3 && panes.slice(0, 3).every(pane => Boolean(pane.dataset.tabflowDocumentToken));
  }, null, { timeout: 20_000 });
  logGate('Frame security: Workspace loads ChatGPT frames despite mock XFO/CSP');

  const paneA = await getPaneByTitle(workspacePage, 'Conversation A');
  const paneB = await getPaneByTitle(workspacePage, 'Conversation B');
  const frameA = await frameForPane(paneA);
  const frameB = await frameForPane(paneB);

  await frameA.waitForFunction(() => {
    const host = document.getElementById('tabflow-memory-status-host');
    return (host?.shadowRoot?.getElementById('text')?.textContent || '').includes('Browser E2E Project');
  }, null, { timeout: 15_000 });
  await new Promise(resolve => setTimeout(resolve, 2_200));

  const liveFile = await extensionRpc(control, 'GET_FILE', { projectId: PROJECT_ID, path: FILE_PATH });
  assert.ok(liveFile?.content?.includes('// LIVE'), 'live VFS file is ingested before archive test');

  const tokenBefore = await paneB.getAttribute('data-tabflow-document-token');
  assert.ok(tokenBefore, 'Pane B has document token before stability actions');

  const queryB = 'E2E-B-QUERY: In this project, what type must parseAudioClock return, may it convert to number, what is the marker, and what file path contains it?';
  await frameB.locator('#prompt-textarea').fill(queryB);
  await waitForMemoryReady(frameB, 'RAG ready');
  const bCountBefore = submits.filter(item => item.body?.client_context === '/c/b').length;
  await frameB.locator('[data-testid="composer-submit"]').click();
  await frameB.locator('[data-testid="stop-button"]').waitFor({ state: 'attached', timeout: 5_000 });

  await paneB.locator('.btn-focus').click();
  await workspacePage.keyboard.press('Escape');
  await workspacePage.locator('#btn-sync-tabs').click();
  await workspacePage.locator('#btn-sync-tabs').click();
  await paneA.locator('.btn-primary-pane').click();
  await paneB.locator('.btn-primary-pane').click();

  const splitter = workspacePage.locator('#spotlight-separator');
  if (await splitter.isVisible()) {
    const box = await splitter.boundingBox();
    if (box) {
      await workspacePage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await workspacePage.mouse.down();
      await workspacePage.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 6 });
      await workspacePage.mouse.up();
    }
  }

  await new Promise(resolve => setTimeout(resolve, 700));
  const tokenAfter = await paneB.getAttribute('data-tabflow-document-token');
  const remounts = Number(await paneB.getAttribute('data-tabflow-unexpected-remounts') || '0');
  assert.equal(tokenAfter, tokenBefore, 'Focus/Sync/resize preserves Pane B document');
  assert.equal(remounts, 0, 'Focus/Sync/resize produces zero unexpected remounts');
  logGate('Workspace stability', 'Focus/Sync/resize preserved the generating document');

  const submitB = await waitForSubmit('/c/b', bCountBefore);
  const promptB = latestPrompt(submitB);
  assert.match(promptB, /\[TABFLOW_LOCAL_MEMORY_V1\]/, 'Pane B submit contains local-memory capsule');
  assert.match(promptB, new RegExp(GATE_MARKER), 'Pane B RAG contains cross-pane marker');
  assert.match(promptB, /parseAudioClock/, 'Pane B RAG contains project symbol');
  assert.ok(promptB.includes(FILE_PATH), 'Pane B RAG contains VFS path');
  assert.match(promptB, /bigint/i, 'Pane B RAG preserves bigint authority');
  const authorityIndex = promptB.indexOf('User constraints / architecture decisions');
  const retrievalIndex = promptB.indexOf('Retrieved evidence');
  if (authorityIndex >= 0 && retrievalIndex >= 0) assert.ok(authorityIndex < retrievalIndex, 'authority appears before retrieval in browser payload');
  assert.equal(submits.filter(item => item.body?.client_context === '/c/b').length, bCountBefore + 1, 'one click emitted exactly one mutating POST');
  logGate('Cross-pane RAG + submit safety', 'Pane B received A evidence and emitted one POST');

  const paneCountBefore = await workspacePage.locator('.chat-pane').count();
  await workspacePage.locator('#btn-new-chat').click();
  await workspacePage.waitForFunction(count => document.querySelectorAll('.chat-pane').length === count + 1, paneCountBefore, { timeout: 10_000 });
  const paneC = workspacePage.locator('.chat-pane').last();
  await paneC.waitFor({ state: 'visible' });
  await workspacePage.waitForFunction(() => {
    const panes = document.querySelectorAll('.chat-pane');
    const last = panes[panes.length - 1];
    return Boolean(last?.dataset.tabflowDocumentToken);
  }, null, { timeout: 15_000 });
  const frameC = await frameForPane(paneC);
  await frameC.locator('#prompt-textarea').fill('E2E-C-REQUEST: recover the parseAudioClock marker and file path from the current project.');
  await waitForMemoryReady(frameC, 'RAG ready');
  const cCountBefore = submits.filter(item => item.body?.client_context === '/').length;
  await frameC.locator('[data-testid="composer-submit"]').click();
  const submitC = await waitForSubmit('/', cCountBefore);
  const promptC = latestPrompt(submitC);
  assert.match(promptC, new RegExp(GATE_MARKER), 'new workspace pane inherits project memory marker');
  assert.ok(promptC.includes(FILE_PATH), 'new workspace pane inherits project VFS path');
  logGate('New-chat project inheritance', 'workspace-only pane received common project memory');

  await frameA.evaluate(async () => {
    const response = await fetch(location.origin + '/backend-api/conversation/a');
    await response.json();
  });
  await new Promise(resolve => setTimeout(resolve, 2_000));
  const afterArchive = await extensionRpc(control, 'GET_FILE', { projectId: PROJECT_ID, path: FILE_PATH });
  assert.ok(afterArchive?.content?.includes('// LIVE'), 'stale archive did not overwrite live VFS');
  assert.ok(!afterArchive?.content?.includes('// STALE'), 'stale archive content is absent from live VFS file');
  logGate('Archive monotonicity', 'historical archive could not resurrect stale code');

  const protectedPage = await context.newPage();
  await protectedPage.goto('https://chatgpt.com/c/protected');
  await protectedPage.locator('#prompt-textarea').fill('E2E-PROTECTED-GENERATION');
  const protectedCountBefore = submits.filter(item => item.body?.client_context === '/c/protected').length;
  await protectedPage.locator('[data-testid="composer-submit"]').click();
  await protectedPage.locator('[data-testid="stop-button"]').waitFor({ state: 'attached', timeout: 5_000 });
  await new Promise(resolve => setTimeout(resolve, 500));
  const discardResult = await control.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(item => item.url === 'https://chatgpt.com/c/protected');
    if (!tab?.id) throw new Error('protected ChatGPT tab not found');
    const result = await chrome.runtime.sendMessage({ type: 'DISCARD_TAB', tabId: tab.id });
    const after = await chrome.tabs.get(tab.id);
    return { result, discarded: Boolean(after.discarded), tabId: tab.id };
  });
  assert.equal(discardResult.result?.success, false, 'productive tab discard request is rejected');
  assert.equal(discardResult.discarded, false, 'productive tab remains live');
  await waitForSubmit('/c/protected', protectedCountBefore);
  assert.equal(submits.filter(item => item.body?.client_context === '/c/protected').length, protectedCountBefore + 1, 'protected submit is not replayed');
  logGate('Runtime discard protection', 'live generating tab was not discarded');

  const outside = await context.newPage();
  await outside.goto('https://outside.test/');
  await new Promise(resolve => setTimeout(resolve, 1_200));
  const leakedFrame = outside.frames().some(frame => frame.url().includes('chatgpt.com/c/outside'));
  assert.equal(leakedFrame, false, 'outside tab cannot embed ChatGPT through Workspace DNR exception');
  logGate('Scoped DNR isolation', 'outside embedding remained blocked');

  const report = {
    ok: true,
    extensionId,
    gates: {
      workspaceStability: 'pass',
      crossPaneRag: 'pass',
      newChatInheritance: 'pass',
      submitSafety: 'pass',
      archiveMonotonicity: 'pass',
      discardProtection: 'pass',
      frameSecurity: 'pass'
    },
    submitCounts: Object.fromEntries([...new Set(submits.map(item => item.body?.client_context || 'unknown'))]
      .map(key => [key, submits.filter(item => (item.body?.client_context || 'unknown') === key).length]))
  };
  writeJson('report.json', report);
  await workspacePage.screenshot({ path: path.join(artifactDir, 'workspace-pass.png'), fullPage: true });
  console.log('\n🏁 TabFlow browser E2E: all self-test gates passed.');
}

try {
  await main();
} catch (error) {
  console.error('\n❌ TabFlow browser E2E failed:', error?.stack || error);
  writeJson('failure.json', {
    ok: false,
    message: error?.message || String(error),
    stack: error?.stack || '',
    submits
  });
  if (workspacePage) {
    try { await workspacePage.screenshot({ path: path.join(artifactDir, 'workspace-failure.png'), fullPage: true }); } catch {}
  }
  process.exitCode = 1;
} finally {
  if (context) {
    try { await context.close(); } catch {}
  }
  if (server) {
    await new Promise(resolve => server.close(() => resolve()));
  }
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  if (certDir) fs.rmSync(certDir, { recursive: true, force: true });
}
