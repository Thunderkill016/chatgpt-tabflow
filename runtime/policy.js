export const RUNTIME_STATES = Object.freeze({
  INTERACTIVE: 'interactive',
  TYPING: 'typing',
  GENERATING: 'generating',
  IDLE: 'idle'
});

export const EXECUTION_MODES = Object.freeze({
  INTERACTIVE: 'interactive',
  PRODUCER: 'producer',
  ECO: 'eco',
  STRAINED: 'strained'
});

// Content agent gửi heartbeat mỗi 15s khi typing/generating.
// Nếu quá 45s không còn heartbeat, state productive được xem là stale để
// tránh một tab đã crash/reload bị bảo vệ khỏi discard vĩnh viễn.
export const PRODUCTIVE_STATE_STALE_MS = 45_000;

export function classifyMemoryPressure(info) {
  const capacity = Number(info?.capacity || 0);
  const available = Number(info?.availableCapacity || 0);
  if (!(capacity > 0) || available < 0) {
    return { level: 'unknown', ratio: null };
  }
  const ratio = Math.max(0, Math.min(1, available / capacity));
  if (ratio < 0.12) return { level: 'critical', ratio };
  if (ratio < 0.20) return { level: 'high', ratio };
  if (ratio < 0.32) return { level: 'medium', ratio };
  return { level: 'normal', ratio };
}

export function recommendedParallelGenerators(pressureLevel, userLimit = 2) {
  const limit = Math.max(1, Math.min(2, Number(userLimit || 2)));
  if (pressureLevel === 'critical' || pressureLevel === 'high') return 1;
  return limit;
}

export function isProductiveStateFresh(entry, now = Date.now()) {
  if (!entry) return false;
  if (entry.state !== RUNTIME_STATES.GENERATING && entry.state !== RUNTIME_STATES.TYPING) return false;
  const updatedAt = Number(entry.updatedAt || entry.lastActivityAt || 0);
  if (!(updatedAt > 0)) return true;
  return now - updatedAt <= PRODUCTIVE_STATE_STALE_MS;
}

export function shouldProtectFromDiscard(entry, now = Date.now()) {
  if (!entry) return false;
  if (Number(entry.protectUntil || 0) > now) return true;
  return isProductiveStateFresh(entry, now);
}

export function deriveExecutionMode(entry, context = {}) {
  const state = entry?.state || RUNTIME_STATES.IDLE;
  const visible = Boolean(entry?.visible);
  const focused = Boolean(entry?.focused);
  const generatingCount = Math.max(0, Number(context.generatingCount || 0));
  const parallelBudget = Math.max(1, Number(context.parallelBudget || 1));

  if (state === RUNTIME_STATES.TYPING || focused || (visible && state !== RUNTIME_STATES.GENERATING)) {
    return EXECUTION_MODES.INTERACTIVE;
  }
  if (state === RUNTIME_STATES.GENERATING) {
    return generatingCount > parallelBudget ? EXECUTION_MODES.STRAINED : EXECUTION_MODES.PRODUCER;
  }
  return EXECUTION_MODES.ECO;
}

export function normalizeRole(role) {
  const value = String(role || '').toLowerCase();
  if (value === 'architect') return 'architect';
  if (value === 'implementer' || value === 'coder') return 'implementer';
  if (value === 'reviewer' || value === 'tester') return 'reviewer';
  return 'unassigned';
}
