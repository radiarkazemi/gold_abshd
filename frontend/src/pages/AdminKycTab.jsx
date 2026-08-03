import { useEffect, useState, useRef } from "react";
import { formatTehranDateTime } from "../utils/tehranTime";
import { fetchAdminKycPending, reviewKyc, fetchKycDocumentBlobUrlAsAdmin } from "../api";

const DOC_SLOTS = [
  { kind: "id_front", label: "روی کارت ملی", hasKey: "has_id_front" },
  { kind: "id_back", label: "پشت کارت ملی", hasKey: "has_id_back" },
  { kind: "birth_cert", label: "شناسنامه", hasKey: "has_birth_cert" },
];

function formatDate(iso) {
  return formatTehranDateTime(iso);
}

function statusLabel(status) {
  if (status === "approved") return "تایید شده";
  return "در انتظار";
}

export default function AdminKycTab({ refreshSignal = 0, onPendingChange }) {
  const [items, setItems] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [lightbox, setLightbox] = useState(null);
  const [openingDoc, setOpeningDoc] = useState(null);
  const lightboxUrlRef = useRef(null);

  function revokeLightbox() {
    if (lightboxUrlRef.current) {
      try {
        URL.revokeObjectURL(lightboxUrlRef.current);
      } catch {
        /* ignore */
      }
      lightboxUrlRef.current = null;
    }
  }

  function reload() {
    fetchAdminKycPending()
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setItems(list);
        const pendingCount = list.filter((row) => row.kyc_status !== "approved").length;
        onPendingChange?.(pendingCount);
      })
      .catch(() => {
        setItems([]);
        onPendingChange?.(0);
      });
  }

  useEffect(() => {
    reload();
    return () => revokeLightbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  async function openDoc(userId, fullName, doc) {
    const key = `${userId}:${doc.kind}`;
    setOpeningDoc(key);
    try {
      const { url, contentType } = await fetchKycDocumentBlobUrlAsAdmin(userId, doc.kind);
      if (contentType?.includes("pdf")) {
        window.open(url, "_blank");
        // Keep blob alive briefly for the new tab; revoke later.
        setTimeout(() => {
          try {
            URL.revokeObjectURL(url);
          } catch {
            /* ignore */
          }
        }, 60_000);
        return;
      }
      revokeLightbox();
      lightboxUrlRef.current = url;
      setLightbox({ url, label: `${fullName || ""} — ${doc.label}` });
    } catch {
      alert("بارگذاری مدرک با خطا مواجه شد");
    } finally {
      setOpeningDoc(null);
    }
  }

  async function handleApprove(userId) {
    setBusyId(userId);
    try {
      await reviewKyc(userId, true);
      reload();
    } catch {
      alert("تایید با خطا مواجه شد");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(userId) {
    setBusyId(userId);
    try {
      await reviewKyc(userId, false, rejectReason);
      setRejectingId(null);
      setRejectReason("");
      reload();
    } catch {
      alert("رد درخواست با خطا مواجه شد");
    } finally {
      setBusyId(null);
    }
  }

  if (!items) return <p className="myorders__empty">در حال بارگذاری…</p>;

  const pendingCount = items.filter((row) => row.kyc_status !== "approved").length;

  return (
    <div className="admin-kyc">
      <div className="admin-kyc__header">
        <h3 className="dashboard__section-title">درخواست‌های احراز هویت</h3>
        {pendingCount > 0 && (
          <span className="admin-kyc__count">{pendingCount.toLocaleString("fa-IR")} در انتظار</span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="myorders__empty">درخواستی برای نمایش وجود ندارد.</p>
      ) : (
        <div className="admin-kyc__grid">
          {items.map((p) => {
            const isApproved = p.kyc_status === "approved";
            return (
              <article
                key={p.user_id}
                className={`admin-kyc__card${isApproved ? " admin-kyc__card--approved" : ""}`}
              >
                <header className="admin-kyc__card-head">
                  <div className="admin-kyc__identity">
                    <span className="admin-kyc__name">{p.full_name || "بدون نام"}</span>
                    <span className="admin-kyc__phone" dir="ltr">
                      {p.phone_number}
                    </span>
                  </div>
                  <div className="admin-kyc__head-meta">
                    <span
                      className={`admin-kyc__tag${isApproved ? " admin-kyc__tag--verified" : " admin-kyc__tag--pending"}`}
                    >
                      {statusLabel(p.kyc_status)}
                    </span>
                    <span className="admin-kyc__code">#{p.user_code}</span>
                  </div>
                </header>

                <p className="admin-kyc__meta">ارسال: {formatDate(p.kyc_submitted_at)}</p>
                {isApproved && p.kyc_reviewed_at && (
                  <p className="admin-kyc__meta">تایید: {formatDate(p.kyc_reviewed_at)}</p>
                )}

                <div className="admin-kyc__docs admin-kyc__docs--links">
                  {DOC_SLOTS.map((doc) => {
                    const key = `${p.user_id}:${doc.kind}`;
                    const available = p[doc.hasKey];
                    return (
                      <button
                        key={doc.kind}
                        type="button"
                        className="admin-kyc__doc-link"
                        disabled={!available || openingDoc === key}
                        onClick={() => openDoc(p.user_id, p.full_name, doc)}
                      >
                        {openingDoc === key ? "…" : doc.label}
                      </button>
                    );
                  })}
                </div>

                <div className="admin-kyc__actions">
                  {!isApproved && (
                    <button
                      type="button"
                      className="admin-kyc__btn admin-kyc__btn--approve"
                      disabled={busyId === p.user_id}
                      onClick={() => handleApprove(p.user_id)}
                    >
                      تایید هویت
                    </button>
                  )}
                  <button
                    type="button"
                    className="admin-kyc__btn admin-kyc__btn--reject"
                    onClick={() => setRejectingId(p.user_id)}
                  >
                    {isApproved ? "لغو تایید / رد" : "رد درخواست"}
                  </button>
                </div>

                {rejectingId === p.user_id && (
                  <div className="admin-kyc__reject-box">
                    <input
                      placeholder="دلیل رد (اختیاری)"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <button
                      type="button"
                      className="admin-kyc__btn admin-kyc__btn--reject"
                      disabled={busyId === p.user_id}
                      onClick={() => handleReject(p.user_id)}
                    >
                      ثبت رد
                    </button>
                    <button
                      type="button"
                      className="admin-kyc__btn admin-kyc__btn--ghost"
                      onClick={() => {
                        setRejectingId(null);
                        setRejectReason("");
                      }}
                    >
                      انصراف
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {lightbox && (
        <div
          className="admin-kyc__lightbox"
          onClick={() => {
            setLightbox(null);
            revokeLightbox();
          }}
          role="presentation"
        >
          <div className="admin-kyc__lightbox-inner" onClick={(e) => e.stopPropagation()} role="dialog">
            <p className="admin-kyc__lightbox-label">{lightbox.label}</p>
            <img src={lightbox.url} alt={lightbox.label} />
            <button
              type="button"
              className="admin-kyc__btn admin-kyc__btn--ghost"
              onClick={() => {
                setLightbox(null);
                revokeLightbox();
              }}
            >
              بستن
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
