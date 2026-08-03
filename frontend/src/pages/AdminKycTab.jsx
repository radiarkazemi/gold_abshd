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
  const [thumbs, setThumbs] = useState({});
  const [lightbox, setLightbox] = useState(null);
  const thumbUrlsRef = useRef([]);

  function revokeThumbs() {
    thumbUrlsRef.current.forEach((u) => {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* ignore */
      }
    });
    thumbUrlsRef.current = [];
  }

  async function loadThumbs(list) {
    revokeThumbs();
    const next = {};
    await Promise.all(
      list.flatMap((p) =>
        DOC_SLOTS.map(async (doc) => {
          if (!p[doc.hasKey]) return;
          try {
            const { url, contentType } = await fetchKycDocumentBlobUrlAsAdmin(p.user_id, doc.kind);
            thumbUrlsRef.current.push(url);
            next[`${p.user_id}:${doc.kind}`] = { url, contentType };
          } catch {
            /* missing doc */
          }
        })
      )
    );
    setThumbs(next);
  }

  function reload() {
    fetchAdminKycPending()
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setItems(list);
        const pendingCount = list.filter((row) => row.kyc_status !== "approved").length;
        onPendingChange?.(pendingCount);
        loadThumbs(list);
      })
      .catch(() => {
        setItems([]);
        onPendingChange?.(0);
      });
  }

  useEffect(() => {
    reload();
    return () => revokeThumbs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

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
        <div className="admin-kyc__list">
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

                <div className="admin-kyc__docs">
                  {DOC_SLOTS.map((doc) => {
                    const thumb = thumbs[`${p.user_id}:${doc.kind}`];
                    const isPdf = thumb?.contentType?.includes("pdf");
                    return (
                      <button
                        key={doc.kind}
                        type="button"
                        className="admin-kyc__doc"
                        disabled={!p[doc.hasKey]}
                        onClick={() => {
                          if (!thumb) return;
                          if (isPdf) {
                            window.open(thumb.url, "_blank");
                          } else {
                            setLightbox({ url: thumb.url, label: `${p.full_name || ""} — ${doc.label}` });
                          }
                        }}
                      >
                        <span className="admin-kyc__doc-label">{doc.label}</span>
                        {thumb && !isPdf ? (
                          <img className="admin-kyc__doc-thumb" src={thumb.url} alt={doc.label} />
                        ) : (
                          <span className="admin-kyc__doc-fallback">
                            {p[doc.hasKey] ? (isPdf ? "PDF" : "…") : "—"}
                          </span>
                        )}
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
        <div className="admin-kyc__lightbox" onClick={() => setLightbox(null)} role="presentation">
          <div className="admin-kyc__lightbox-inner" onClick={(e) => e.stopPropagation()} role="dialog">
            <p className="admin-kyc__lightbox-label">{lightbox.label}</p>
            <img src={lightbox.url} alt={lightbox.label} />
            <button type="button" className="admin-kyc__btn admin-kyc__btn--ghost" onClick={() => setLightbox(null)}>
              بستن
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
