/** Shared countdown helpers for order pending windows. */

export function formatMMSS(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Prefer server-computed seconds_remaining so naive ISO deadlines
 * don't desync against the browser's local timezone interpretation.
 * Falls back to pending_deadline_at when seconds_remaining is absent.
 */
export function remainingFromOrder(order, nowMs = Date.now()) {
  if (!order || order.status !== "pending") return 0;
  if (order.seconds_remaining != null) {
    return Math.max(0, Math.floor(Number(order.seconds_remaining)));
  }
  if (!order.pending_deadline_at) return 0;
  const deadlineMs = Date.parse(order.pending_deadline_at);
  if (Number.isNaN(deadlineMs)) return 0;
  return Math.max(0, Math.floor((deadlineMs - nowMs) / 1000));
}

/**
 * Anchor a local end-time from a freshly fetched order so a 1s UI tick
 * stays smooth between polls without depending on absolute clock sync.
 */
export function localDeadlineMsFromOrder(order, nowMs = Date.now()) {
  const remaining = remainingFromOrder(order, nowMs);
  return nowMs + remaining * 1000;
}
