/**
 * Automated Unit Test Suite for ChatGPT TabFlow
 */

import { isChatGptUrl } from '../service-worker.js';

let passed = 0;
let total = 0;

function assert(condition, description) {
  total++;
  if (condition) {
    console.log(`  ✅ [PASS] ${description}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${description}`);
    process.exitCode = 1;
  }
}

console.log('🧪 Starting ChatGPT TabFlow Unit Tests...\n');

// 1. URL Recognition Tests
assert(isChatGptUrl('https://chatgpt.com/c/678a-1234'), 'Identifies chatgpt.com conversation URL');
assert(isChatGptUrl('https://chatgpt.com/'), 'Identifies chatgpt.com root URL');
assert(isChatGptUrl('https://chat.openai.com/g/g-abc-custom-gpt'), 'Identifies legacy chat.openai.com URL');
assert(!isChatGptUrl('https://google.com/search?q=chatgpt'), 'Rejects Google search containing keyword chatgpt');
assert(!isChatGptUrl('https://fake-chatgpt.com/'), 'Rejects phishing or unrelated domain');
assert(!isChatGptUrl(''), 'Handles empty string gracefully');
assert(!isChatGptUrl(null), 'Handles null input gracefully');
assert(!isChatGptUrl(undefined), 'Handles undefined input gracefully');

// 2. RAM Calculation Formula Tests
const ESTIMATED_SAVINGS_PER_TAB_MB = 415;
function calculateSavings(discardedCount) {
  return discardedCount * ESTIMATED_SAVINGS_PER_TAB_MB;
}
assert(calculateSavings(0) === 0, '0 discarded tabs gives 0 MB saved');
assert(calculateSavings(4) === 1660, '4 discarded tabs gives 1660 MB (~1.66 GB) saved');
assert(calculateSavings(10) === 4150, '10 discarded tabs gives 4150 MB (~4.15 GB) saved');

// 3. Stashed Session Data Structure Test
function createStashedSession(sessionName, rawTabs) {
  const tabList = rawTabs.map(t => ({
    url: t.url,
    title: t.title || 'ChatGPT Conversation',
    pinned: t.pinned || false
  }));

  return {
    id: `session_${Date.now()}`,
    name: sessionName || 'Default Session',
    timestamp: Date.now(),
    tabCount: tabList.length,
    tabs: tabList
  };
}

const mockTabs = [
  { url: 'https://chatgpt.com/c/code-debug-1', title: 'Debug Python memory leak', pinned: true },
  { url: 'https://chatgpt.com/c/thesis-research-2', title: 'Thesis AI literature review', pinned: false },
  { url: 'https://chatgpt.com/c/sql-optimize-3', title: 'SQL query indexing tips', pinned: false }
];

const session = createStashedSession('Dự án Luận Văn & Code', mockTabs);
assert(session && session.tabCount === 3, 'Stashed session correctly records 3 tabs');
assert(session.tabs[0].pinned === true, 'Preserves pinned tab property');
assert(session.tabs[1].title === 'Thesis AI literature review', 'Preserves conversation titles');
assert(session.tabs[2].url === 'https://chatgpt.com/c/sql-optimize-3', 'Preserves conversation URLs');

// 4. Time formatting helper test
function formatMb(mb) {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${Math.round(mb)} MB`;
}

assert(formatMb(450) === '450 MB', 'Formats MB under 1024 correctly');
assert(formatMb(2048) === '2.0 GB', 'Formats GB above 1024 correctly');

// 5. Code Scratchpad Prompt Generator Test
function formatPromptWithCode(fileName, codeContent) {
  return `Dưới đây là code từ file \`${fileName}\`:\n\n\`\`\`\n${codeContent}\n\`\`\`\nHãy kiểm tra, tối ưu hoặc thực hiện theo yêu cầu.`;
}

const sampleCode = 'const x = 10;\nconsole.log(x);';
const promptOutput = formatPromptWithCode('app.js', sampleCode);
assert(promptOutput.includes('`app.js`'), 'Prompt includes correct file name tag');
assert(promptOutput.includes('const x = 10;'), 'Prompt preserves full code snippet');

// 6. Multi-Chat Layout Grid Constraints Test
function validateLayoutPanes(layout, paneCount) {
  if (layout === '2-col') return paneCount >= 2;
  if (layout === '3-col') return paneCount >= 3;
  if (layout === '4-grid') return paneCount >= 4;
  return false;
}

assert(validateLayoutPanes('2-col', 2) === true, '2-col layout validates 2 panes');
assert(validateLayoutPanes('3-col', 3) === true, '3-col layout validates 3 panes');
assert(validateLayoutPanes('4-grid', 4) === true, '4-grid layout validates 4 panes');
assert(validateLayoutPanes('3-col', 2) === false, 'Rejects insufficient panes for 3-col');

// 7. Bulletproof Conversation DAG Pruning Algorithm Test
function bulletproofPrune(data, limit) {
  if (!data || !data.mapping || !data.current_node) return data;
  const mapping = data.mapping;
  const currentNodeId = data.current_node;
  if (!mapping[currentNodeId]) return data;

  let rootNodeId = null;
  let systemNodeId = null;
  for (const [id, node] of Object.entries(mapping)) {
    if (!node.parent) {
      rootNodeId = id;
      break;
    }
  }
  if (!rootNodeId || !mapping[rootNodeId]) return data;

  for (const childId of (mapping[rootNodeId].children || [])) {
    const child = mapping[childId];
    if (child?.message?.author?.role === 'system') {
      systemNodeId = childId;
      break;
    }
  }

  const activePath = [];
  let curr = currentNodeId;
  const visited = new Set();
  while (curr && mapping[curr] && !visited.has(curr)) {
    visited.add(curr);
    activePath.push(curr);
    curr = mapping[curr].parent;
  }

  let turnCount = 0;
  let cutoffIndex = activePath.length - 1;

  for (let i = 0; i < activePath.length; i++) {
    const nodeId = activePath[i];
    const node = mapping[nodeId];
    const role = node.message?.author?.role;

    if (role === 'user') {
      turnCount++;
      if (turnCount >= limit) {
        cutoffIndex = i;
        break;
      }
    }
  }

  if (turnCount < limit && cutoffIndex === activePath.length - 1) {
    return data;
  }

  const keptNodeIds = new Set(activePath.slice(0, cutoffIndex + 1));
  const oldestKeptId = activePath[cutoffIndex];

  keptNodeIds.add(rootNodeId);
  if (systemNodeId && mapping[systemNodeId]) {
    keptNodeIds.add(systemNodeId);
  }

  const attachTargetId = (systemNodeId && mapping[systemNodeId]) ? systemNodeId : rootNodeId;

  const prunedMapping = {};
  for (const id of keptNodeIds) {
    const orig = mapping[id];
    prunedMapping[id] = {
      id: orig.id,
      message: orig.message,
      parent: orig.parent,
      children: Array.isArray(orig.children) ? [...orig.children] : []
    };
  }

  prunedMapping[oldestKeptId].parent = attachTargetId;
  prunedMapping[attachTargetId].children = [oldestKeptId];

  for (const [id, node] of Object.entries(prunedMapping)) {
    node.children = (node.children || []).filter(childId => keptNodeIds.has(childId));
  }

  return { ...data, mapping: prunedMapping };
}

// Build 25-turn conversation with system node and alternate branches
const complexMapping = {
  'root': { id: 'root', parent: null, children: ['sys'] },
  'sys': { id: 'sys', parent: 'root', children: ['u1'], message: { author: { role: 'system' } } }
};

let lastNode = 'sys';
for (let i = 1; i <= 25; i++) {
  const uId = `u${i}`;
  const aId = `a${i}`;
  const altAId = `a${i}_alt`;

  complexMapping[lastNode].children = [uId];
  complexMapping[uId] = {
    id: uId,
    parent: lastNode,
    children: [altAId, aId],
    message: { author: { role: 'user' }, content: { parts: [`User query ${i}`] } }
  };
  complexMapping[altAId] = {
    id: altAId,
    parent: uId,
    children: [],
    message: { author: { role: 'assistant' }, content: { parts: [`Abandoned branch ${i}`] } }
  };
  complexMapping[aId] = {
    id: aId,
    parent: uId,
    children: [],
    message: { author: { role: 'assistant' }, content: { parts: [`Active reply ${i}`] } }
  };
  lastNode = aId;
}

const complexData = { current_node: 'a25', mapping: JSON.parse(JSON.stringify(complexMapping)) };
const prunedComplex = bulletproofPrune(complexData, 5); // Keep last 5 turns

assert(prunedComplex.mapping['root'] !== undefined, 'Root node is always preserved');
assert(prunedComplex.mapping['sys'] !== undefined, 'System instructions node is preserved');
assert(prunedComplex.mapping['a25'] !== undefined, 'Latest assistant node is preserved');

// Check that the first message after system node is a USER message
const firstMsgId = prunedComplex.mapping['sys'].children[0];
assert(prunedComplex.mapping[firstMsgId]?.message?.author?.role === 'user', 'First message after system node is a USER prompt');
assert(firstMsgId === 'u21', '5 turns kept from 25 means starting at u21');

// Check that all dangling children were sanitized
let hasDanglingChild = false;
for (const [id, node] of Object.entries(prunedComplex.mapping)) {
  for (const c of (node.children || [])) {
    if (!prunedComplex.mapping[c]) {
      hasDanglingChild = true;
    }
  }
}
assert(!hasDanglingChild, 'Zero dangling children in pruned DAG (all branch orphans sanitized)');

// Check that older messages were removed
assert(prunedComplex.mapping['u5'] === undefined, 'Older messages (u5) removed from active tree');
assert(prunedComplex.mapping['a5'] === undefined, 'Older assistant messages (a5) removed');

// 8. Context Snapshot Distiller Test
function createRolloverPrimer(projectTitle, codeCount, lastTurnText) {
  return `### 🤖 BỐI CẢNH DỰ ÁN: ${projectTitle}\n- Đã code ${codeCount} file/module.\n- Việc dở dang: ${lastTurnText.slice(0, 50)}...\nTiếp tục công việc mà không giải thích lại.`;
}
const primer = createRolloverPrimer('OpenPronounce', 5, 'Sửa lỗi Web Audio buffer bị lệch pha');
assert(primer.includes('OpenPronounce'), 'Rollover primer contains project title');
assert(primer.includes('5 file/module'), 'Rollover primer records module count');
assert(primer.includes('Web Audio buffer'), 'Rollover primer captures pending task');

// 9. Language to Extension Mapping Test
const extMap = { javascript: 'js', typescript: 'ts', python: 'py', sql: 'sql' };
assert(extMap['python'] === 'py', 'Python maps to .py');
assert(extMap['typescript'] === 'ts', 'TypeScript maps to .ts');
assert(extMap['sql'] === 'sql', 'SQL maps to .sql');

// 10. Accurate Token Estimation Formula Tests
function estimateTokens(textChars, codeChars) {
  const textTokens = textChars / 4.0;
  const codeTokens = codeChars / 2.8;
  return Math.round(textTokens + codeTokens);
}
assert(estimateTokens(400, 0) === 100, '400 prose chars = 100 tokens');
assert(estimateTokens(0, 280) === 100, '280 code chars = 100 tokens');
assert(estimateTokens(400, 280) === 200, '400 prose + 280 code chars = 200 tokens');

// 11. Telemetry Domain Filter Test
const telemetryDomains = ['datadog', 'statsig', 'sentry', 'segment.io', 'segment.com'];
function isTelemetryUrl(url) {
  return telemetryDomains.some(d => url.includes(d));
}
assert(isTelemetryUrl('https://browser-http-intake.logs.datadoghq.com/v1/input') === true, 'Blocks Datadog telemetry');
assert(isTelemetryUrl('https://events.statsigapi.net/v1/rgstr') === true, 'Blocks Statsig telemetry');
assert(isTelemetryUrl('https://sentry.io/api/123/envelope/') === true, 'Blocks Sentry telemetry');
assert(isTelemetryUrl('https://chatgpt.com/backend-api/conversation') === false, 'Passes legitimate ChatGPT conversation request');

console.log(`\n==========================================`);
console.log(`🏁 TEST RESULTS: ${passed}/${total} TESTS PASSED`);
console.log(`==========================================\n`);
