const MAX_TEXT = 24000;
const MAX_LIST = 64;

function clipped(value, max = MAX_TEXT) {
  return String(value ?? '').trim().slice(0, max);
}

function uniqueStrings(values, max = MAX_LIST) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const text = clipped(value, 4000);
    if (!text) continue;
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeConversationNode(raw, conversationId = '') {
  if (!raw || raw.id == null) return null;
  const id = clipped(raw.id, 500);
  if (!id) return null;
  const role = raw.role === 'user' || raw.role === 'assistant' || raw.role === 'system'
    ? raw.role
    : 'unknown';
  return {
    id,
    conversationId: clipped(conversationId || raw.conversationId, 500),
    parentId: raw.parentId == null ? null : clipped(raw.parentId, 500),
    childrenIds: uniqueStrings(raw.childrenIds, 128).map(item => item.slice(0, 500)),
    role,
    text: clipped(raw.text),
    observedAt: Number.isFinite(Number(raw.observedAt)) ? Number(raw.observedAt) : 0,
    onActivePath: raw.onActivePath !== false
  };
}

export function buildConversationGraph(rawNodes, currentId = null) {
  const nodes = new Map();
  for (const raw of Array.isArray(rawNodes) ? rawNodes : []) {
    const node = normalizeConversationNode(raw, raw?.conversationId || '');
    if (node) nodes.set(node.id, node);
  }

  // Rebuild child links from parent links as a defensive repair pass. Explicit
  // children are retained too, but dangling ids are removed.
  for (const node of nodes.values()) {
    node.childrenIds = node.childrenIds.filter(id => nodes.has(id));
  }
  for (const node of nodes.values()) {
    if (!node.parentId || !nodes.has(node.parentId)) continue;
    const parent = nodes.get(node.parentId);
    if (!parent.childrenIds.includes(node.id)) parent.childrenIds.push(node.id);
  }

  const head = currentId != null && nodes.has(String(currentId)) ? String(currentId) : null;
  return { nodes, currentId: head };
}

export function activeBranchFromGraph(graph, { maxNodes = 2500 } = {}) {
  if (!graph?.nodes || !(graph.nodes instanceof Map) || !graph.currentId) return [];
  const newestFirst = [];
  const visited = new Set();
  let id = graph.currentId;
  while (id && graph.nodes.has(id) && !visited.has(id) && newestFirst.length < maxNodes) {
    visited.add(id);
    const node = graph.nodes.get(id);
    newestFirst.push(node);
    id = node.parentId;
  }
  return newestFirst.reverse();
}

export function createContinuityCheckpoint({
  projectId,
  conversationId,
  checkpointMessageId = null,
  summary = '',
  constraints = [],
  decisions = [],
  files = [],
  currentTask = '',
  unresolved = [],
  nextSteps = [],
  recentMessages = [],
  previousCheckpointId = null,
  createdAt = Date.now()
}) {
  const project = clipped(projectId, 200);
  const conversation = clipped(conversationId, 500);
  if (!project || !conversation) throw new Error('projectId and conversationId are required');

  const recentTail = (Array.isArray(recentMessages) ? recentMessages : [])
    .slice(-12)
    .map(item => ({
      id: clipped(item?.id, 500),
      role: item?.role === 'user' ? 'user' : 'assistant',
      text: clipped(item?.text, 6000),
      observedAt: Number.isFinite(Number(item?.observedAt)) ? Number(item.observedAt) : 0
    }))
    .filter(item => item.text);

  const timestamp = Number.isFinite(Number(createdAt)) ? Number(createdAt) : Date.now();
  const anchor = clipped(checkpointMessageId || recentTail.at(-1)?.id || 'head', 500);
  return {
    id: `${project}:checkpoint:${conversation}:${anchor}:${timestamp}`,
    schemaVersion: 1,
    projectId: project,
    conversationId: conversation,
    checkpointMessageId: anchor || null,
    previousCheckpointId: clipped(previousCheckpointId, 1000) || null,
    summary: clipped(summary, 20000),
    constraints: uniqueStrings(constraints, 32),
    decisions: uniqueStrings(decisions, 32),
    files: uniqueStrings(files, 64),
    currentTask: clipped(currentTask, 8000),
    unresolved: uniqueStrings(unresolved, 24),
    nextSteps: uniqueStrings(nextSteps, 24),
    recentTail,
    createdAt: timestamp
  };
}

export function formatContinuityCheckpoint(checkpoint) {
  if (!checkpoint) return '';
  const lines = ['## Continuity checkpoint'];
  if (checkpoint.summary) lines.push(`Summary: ${checkpoint.summary}`);
  if (checkpoint.currentTask) lines.push(`Current task: ${checkpoint.currentTask}`);
  if (checkpoint.constraints?.length) {
    lines.push('Constraints:');
    for (const item of checkpoint.constraints) lines.push(`- ${item}`);
  }
  if (checkpoint.decisions?.length) {
    lines.push('Decisions:');
    for (const item of checkpoint.decisions) lines.push(`- ${item}`);
  }
  if (checkpoint.files?.length) lines.push(`Relevant files: ${checkpoint.files.join(', ')}`);
  if (checkpoint.unresolved?.length) {
    lines.push('Unresolved:');
    for (const item of checkpoint.unresolved) lines.push(`- ${item}`);
  }
  if (checkpoint.nextSteps?.length) {
    lines.push('Next steps:');
    for (const item of checkpoint.nextSteps) lines.push(`- ${item}`);
  }
  if (checkpoint.recentTail?.length) {
    lines.push('Recent tail:');
    for (const item of checkpoint.recentTail) {
      lines.push(`- ${item.role === 'user' ? 'USER' : 'ASSISTANT'}: ${item.text}`);
    }
  }
  return lines.join('\n');
}
