/** Tehran-local display helpers for server timestamps (stored as UTC). */

export const TEHRAN_TZ = "Asia/Tehran";

/**
 * Parse a backend datetime as absolute UTC milliseconds.
 * Naive ISO strings (no Z / offset) are treated as UTC — matching how
 * the API stores datetime.utcnow() values.
 */
export function parseServerDate(iso) {
  if (iso == null || iso === "") return null;
  if (iso instanceof Date) {
    const ms = iso.getTime();
    return Number.isNaN(ms) ? null : iso;
  }
  let s = String(iso).trim();
  if (!s) return null;
  if (s.includes(" ") && !s.includes("T")) s = s.replace(" ", "T");
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s = `${s}Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function serverDateMs(iso) {
  const d = parseServerDate(iso);
  return d ? d.getTime() : 0;
}

export function formatTehranTime(iso, opts = {}) {
  const d = parseServerDate(iso);
  if (!d) return "—";
  return d.toLocaleTimeString("fa-IR", {
    timeZone: TEHRAN_TZ,
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  });
}

export function formatTehranDateTime(iso, opts = {}) {
  const d = parseServerDate(iso);
  if (!d) return "—";
  return d.toLocaleString("fa-IR", {
    timeZone: TEHRAN_TZ,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  });
}

/** Gregorian YYYY-MM-DD for an instant in Asia/Tehran. */
export function tehranDayKey(isoOrDate = new Date()) {
  const d = isoOrDate instanceof Date ? isoOrDate : parseServerDate(isoOrDate);
  if (!d) return null;
  return d.toLocaleDateString("en-CA", { timeZone: TEHRAN_TZ });
}

export function tehranTodayKey() {
  return tehranDayKey(new Date());
}

/** Gregorian YYYY-MM-DD for yesterday in Tehran. */
export function tehranYesterdayKey() {
  return tehranDayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

/** Add calendar days to a Gregorian YYYY-MM-DD key (Tehran date arithmetic). */
export function tehranAddDays(dayKey, delta) {
  if (!dayKey) return null;
  const [y, m, d] = dayKey.split("-").map(Number);
  // Noon UTC avoids DST edge cases when shifting calendar days.
  const utc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  utc.setUTCDate(utc.getUTCDate() + delta);
  return utc.toISOString().slice(0, 10);
}

/**
 * Saturday-start week range in Tehran, excluding today.
 * Returns { from, to } as YYYY-MM-DD (to = yesterday).
 * If today is Saturday, from may be after to (empty selection).
 */
export function tehranThisWeekExcludingToday() {
  const today = tehranTodayKey();
  const yesterday = tehranYesterdayKey();
  // weekday short in Tehran: Sat is start of Iranian business week
  const weekday = new Date().toLocaleDateString("en-US", {
    timeZone: TEHRAN_TZ,
    weekday: "short",
  });
  const offsetFromSaturday = { Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6 }[weekday] ?? 0;
  const weekStart = tehranAddDays(today, -offsetFromSaturday);
  return { from: weekStart, to: yesterday };
}
