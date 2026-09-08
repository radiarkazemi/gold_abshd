import { useEffect, useState } from "react";
import { canPromptAdminInstall, onAdminInstallAvailable, promptAdminInstall } from "../utils/adminInstall";
import { isAdminStandalone } from "../utils/adminManifest";

export default function AdminInstallBar() {
  const [canInstall, setCanInstall] = useState(canPromptAdminInstall());
  const [busy, setBusy] = useState(false);

  useEffect(() => onAdminInstallAvailable(setCanInstall), []);

  if (isAdminStandalone() || !canInstall) return null;

  async function handleInstall() {
    setBusy(true);
    try {
      await promptAdminInstall();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="admin-install-btn" onClick={handleInstall} disabled={busy}>
      {busy ? "در حال نصب…" : "نصب اپ پنل"}
    </button>
  );
}
