/** Shared countdown helpers for order pending windows. */

import { parseServerDate } from "./tehranTime";

export function formatMMSS(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Parse a server deadline as UTC milliseconds.
 * Naive ISO timestamps (no Z / offset) are treated as UTC so every
 * admin/client surface shares the same absolute end time.
 */
export function deadlineMsFromIso(iso) {
  const d = parseServerDate(iso);
  return d ? d.getTime() : null;
}

/**
 * Absolute remaining seconds from pending_deadline_at so dashboard and
 * Orders tab stay in sync. seconds_remaining is only a fallback.
 */
export function remainingFromOrder(order, nowMs = Date.now()) {
  if (!order || order.status !== "pending") return 0;
  const deadlineMs = deadlineMsFromIso(order.pending_deadline_at);
  if (deadlineMs != null) {
    return Math.max(0, Math.floor((deadlineMs - nowMs) / 1000));
  }
  if (order.seconds_remaining != null) {
    return Math.max(0, Math.floor(Number(order.seconds_remaining)));
  }
  return 0;
}

/**
 * Anchor a local end-time from the absolute server deadline so a 1s UI
 * tick stays smooth without re-anchoring on every poll of seconds_remaining.
 */
export function localDeadlineMsFromOrder(order, nowMs = Date.now()) {
  const deadlineMs = deadlineMsFromIso(order?.pending_deadline_at);
  if (deadlineMs != null) return deadlineMs;
  const remaining = remainingFromOrder(order, nowMs);
  return nowMs + remaining * 1000;
}

/** Default pending window length for circular progress (matches server default). */
export const DEFAULT_PENDING_SECONDS = 120;
