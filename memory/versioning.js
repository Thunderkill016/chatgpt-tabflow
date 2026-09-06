function finiteTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function newestObservedAt(records = []) {
  let newest = 0;
  for (const record of Array.isArray(records) ? records : []) {
    newest = Math.max(newest, finiteTimestamp(record?.updatedAt), finiteTimestamp(record?.observedAt));
  }
  return newest;
}

export function isStaleObservation(records, incomingObservedAt) {
  const incoming = finiteTimestamp(incomingObservedAt);
  if (!(incoming > 0)) return false;
  return newestObservedAt(records) > incoming;
}

export function monotonicObservedAt(existingObservedAt, incomingObservedAt, fallback = 0) {
  const existing = finiteTimestamp(existingObservedAt);
  const incoming = finiteTimestamp(incomingObservedAt);
  const backup = finiteTimestamp(fallback);
  return Math.max(existing, incoming, backup);
}
