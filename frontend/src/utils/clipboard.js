/**
 * Copy text to clipboard. navigator.clipboard only works in a secure
 * context (HTTPS or localhost) - production is often hit over plain
 * HTTP via IP until the domain/SSL is live, so we fall back to a
 * hidden textarea + execCommand.
 */
export async function copyText(text) {
  const value = String(text ?? "");
  if (!value) throw new Error("nothing to copy");

  if (window.isSecureContext && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:0;padding:0;margin:0;";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
  if (!ok) throw new Error("copy failed");
}
