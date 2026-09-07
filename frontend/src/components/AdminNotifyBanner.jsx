/**
 * Fixed top "notification card" for the admin panel.
 * Android Chrome often suppresses OS heads-up banners while the tab is
 * focused — this in-app card is the visible alert when the panel is open.
 */
export default function AdminNotifyBanner({ item, onClose, onOpen }) {
  if (!item) return null;
  const isKyc = item.kind === "kyc";
  return (
    <div
      className={`admin-notify-banner ${isKyc ? "admin-notify-banner--kyc" : "admin-notify-banner--order"}`}
      role="alert"
      aria-live="assertive"
    >
      <button type="button" className="admin-notify-banner__card" onClick={onOpen}>
        <span className="admin-notify-banner__eyebrow">
          {isKyc ? "احراز هویت جدید" : "سفارش جدید"}
        </span>
        <span className="admin-notify-banner__title">{item.title}</span>
        {item.body ? <span className="admin-notify-banner__body">{item.body}</span> : null}
      </button>
      <button
        type="button"
        className="admin-notify-banner__dismiss"
        onClick={onClose}
        aria-label="بستن"
      >
        ×
      </button>
    </div>
  );
}
