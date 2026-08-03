import { useEffect, useState } from "react";
import { formatTehranDateTime } from "../utils/tehranTime";
import { fetchAdminKycPending, reviewKyc, fetchKycDocumentBlobUrlAsAdmin } from "../api";

const DOC_BUTTONS = [
  { kind: "id_front", label: "روی کارت ملی" },
  { kind: "id_back", label: "پشت کارت ملی" },
  { kind: "birth_cert", label: "شناسنامه" },
];

function formatDate(iso) {
  return formatTehranDateTime(iso);
}

export default function AdminKycTab() {
  const [pending, setPending] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  function reload() {
    fetchAdminKycPending().then(setPending).catch(() => setPending([]));
  }

  useEffect(() => {
    reload();
  }, []);

  async function viewDocument(userId, kind) {
    try {
      const { url } = await fetchKycDocumentBlobUrlAsAdmin(userId, kind);
      window.open(url, "_blank");
    } catch {
      alert("نمایش مدرک با خطا مواجه شد");
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

  if (!pending) return <p className="myorders__empty">در حال بارگذاری…</p>;

  return (
    <div className="admin-accounts">
      <h3 className="dashboard__section-title">درخواست‌های احراز هویت در انتظار بررسی</h3>
      {pending.length === 0 ? (
        <p className="myorders__empty">درخواستی در انتظار بررسی وجود ندارد.</p>
      ) : (
        <div className="admin-accounts__list">
          {pending.map((p) => (
            <div key={p.user_id} className="admin-accounts__card">
              <div className="admin-accounts__card-top">
                <div>
                  <span className="admin-accounts__name">{p.full_name || "بدون نام"}</span>
                  <span className="admin-accounts__username" dir="ltr">
                    {p.phone_number}
                  </span>
                </div>
                <span className="admin-accounts__status is-on">#{p.user_code}</span>
              </div>
              <div className="admin-accounts__meta">
                <span>ارسال شده: {formatDate(p.kyc_submitted_at)}</span>
              </div>
              <div className="admin-accounts__actions admin-accounts__actions--wrap">
                {DOC_BUTTONS.map((doc) => (
                  <button
                    key={doc.kind}
                    type="button"
                    className="dashboard__see-all"
                    onClick={() => viewDocument(p.user_id, doc.kind)}
                  >
                    {doc.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="order-limits-box__save"
                  disabled={busyId === p.user_id}
                  onClick={() => handleApprove(p.user_id)}
                >
                  تایید
                </button>
                <button type="button" className="admin-accounts__delete" onClick={() => setRejectingId(p.user_id)}>
                  رد
                </button>
              </div>
              {rejectingId === p.user_id && (
                <div className="admin-accounts__reject-box">
                  <input
                    placeholder="دلیل رد (اختیاری)"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <button
                    type="button"
                    className="admin-accounts__delete"
                    disabled={busyId === p.user_id}
                    onClick={() => handleReject(p.user_id)}
                  >
                    ثبت رد درخواست
                  </button>
                  <button
                    type="button"
                    className="dashboard__see-all"
                    onClick={() => {
                      setRejectingId(null);
                      setRejectReason("");
                    }}
                  >
                    انصراف
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
