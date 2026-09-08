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
        <>
          <button type="button" className="admin-install-btn" onClick={handleInstall} disabled={busy}>
            {busy ? "در حال نصب…" : "نصب اپ پنل"}
          </button>
          <p className="admin-install-steps admin-install-steps--ok">
            یا منوی Chrome (⋮) را باز کنید و Install app را بزنید. Add shortcut را انتخاب نکنید.
          </p>
        </>
      )}
      {isAndroid() && !canInstall && (
        <p className="admin-install-steps">
          اگر فقط Add shortcut می‌بینید، لازم نیست اپ مشتری روی این گوشی باشد.
          Chrome گاهی یک میانبر قدیمی یا دادهٔ سایت را «نصب‌شده» حساب می‌کند.
          Chrome → Settings → Site settings → ghasrtala.ir → Clear & reset،
          میانبرهای این سایت را از صفحه اصلی پاک کنید، Chrome را کامل ببندید،
          بعد همین صفحه را دوباره باز کنید. باید Install app ظاهر شود.
        </p>
      )}
    </div>
  );
}
