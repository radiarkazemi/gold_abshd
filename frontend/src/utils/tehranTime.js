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
