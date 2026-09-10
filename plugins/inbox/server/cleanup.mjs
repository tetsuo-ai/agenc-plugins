/**
 * Newsletter/notification archaeology: deterministic per-sender volume and
 * engagement from List-Unsubscribe presence and your actual reply
 * behavior. Produces the kill-list with evidence; the plugin never
 * unsubscribes by itself. Pure functions over analyzed records.
 */

export function cleanupRows(records, { minMessages = 3 } = {}) {
  const bySender = new Map();
  for (const record of records) {
    if (record.direction !== "in") continue;
    const entry = bySender.get(record.from) ?? {
      from: record.from,
      total: 0,
      withUnsubscribe: 0,
      unsubscribe: null,
      subjects: [],
      lastDate: null,
    };
    entry.total += 1;
    if (record.unsubscribe !== null) {
      entry.withUnsubscribe += 1;
      if (entry.unsubscribe === null || entry.withUnsubscribe === 1) entry.unsubscribe = record.unsubscribe;
    }
    if (entry.subjects.length < 3) entry.subjects.push(record.subject);
    if (record.date !== null && (entry.lastDate === null || record.date > entry.lastDate)) {
      entry.lastDate = record.date;
    }
    bySender.set(record.from, entry);
  }
  return [...bySender.values()]
    .filter((entry) => entry.total >= minMessages && entry.withUnsubscribe / entry.total >= 0.5)
    .map((entry) => ({
      ...entry,
      canUnsubscribe: entry.unsubscribe !== null,
      evidence: `${entry.total} messages, latest ${entry.lastDate ?? "?"}; e.g. "${entry.subjects[0] ?? ""}"`,
    }))
    .sort((a, b) => b.total - a.total);
}
