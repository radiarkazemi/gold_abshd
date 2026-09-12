export function formatTomanFa(n, opts) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("fa-IR", opts);
}
