import "./StagingBanner.css";

const APP_ENV = import.meta.env.VITE_APP_ENV || "production";

/** Visible strip on staging builds so testers never confuse it with live. */
export default function StagingBanner() {
  if (APP_ENV !== "staging") return null;
  return (
    <div className="staging-banner" role="status">
      محیط آزمایشی (Staging) — داده‌ها و کاربران جدا از نسخه اصلی هستند
    </div>
  );
}

export function isStagingBuild() {
  return APP_ENV === "staging";
}
