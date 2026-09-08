/**
 * Android Chrome PWA install (the real "Install" prompt, not a shortcut).
 * Do NOT call preventDefault() on beforeinstallprompt — that replaces
 * Chrome's "Install app" menu item with "Add shortcut" / "Create shortcut".
 */

let deferredPrompt = null;
const LISTENERS = new Set();

function emit() {
  for (const fn of LISTENERS) {
    try {
      fn(Boolean(deferredPrompt));
    } catch {
      /* ignore */
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    deferredPrompt = event;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    emit();
  });
}

export function canPromptAdminInstall() {
  return Boolean(deferredPrompt);
}

export function onAdminInstallAvailable(fn) {
  LISTENERS.add(fn);
  fn(Boolean(deferredPrompt));
  return () => LISTENERS.delete(fn);
}

export async function promptAdminInstall() {
  if (!deferredPrompt) return false;
  const pending = deferredPrompt;
  deferredPrompt = null;
  emit();
  try {
    pending.prompt();
    const choice = await pending.userChoice;
    return choice?.outcome === "accepted";
  } catch {
    return false;
  }
}
