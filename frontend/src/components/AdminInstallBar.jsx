import { useEffect, useState } from "react";
import { canPromptAdminInstall, onAdminInstallAvailable, promptAdminInstall } from "../utils/adminInstall";
import { isAdminStandalone } from "../utils/adminManifest";

function isAndroid() {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent || "");
}

export default function AdminInstallBar() {
  const [canInstall, setCanInstall] = useState(canPromptAdminInstall());
  const [busy, setBusy] = useState(false);

  useEffect(() => onAdminInstallAvailable(setCanInstall), []);

  if (isAdminStandalone()) return null;

  async function handleInstall() {
    setBusy(true);
    try {
      await promptAdminInstall();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-install-bar">
      {canInstall && (
        <button type="button" className="admin-install-btn" onClick={handleInstall} disabled={busy}>
          {busy ? "در حال نصب…" : "نصب اپ پنل"}
        </button>
      )}
      {isAndroid() && !canInstall && (
        <p className="admin-install-steps">
          Chrome الان Install ندارد چون اپ مشتری «آبشده قصر طلا» روی همین دامنه نصب است.
          آن را Uninstall کنید، میانبرها را پاک کنید، Chrome را کامل ببندید، بعد همین صفحه را دوباره باز کنید.
        </p>
      )}
    </div>
  );
}
