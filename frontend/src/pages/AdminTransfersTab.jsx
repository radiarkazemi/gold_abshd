import { useEffect, useState } from "react";
import { fetchAdminTransfers, decideTransfer, fetchTransferReceiptBlobUrlAsAdmin } from "../api";

function fa(n) {
  return Number(n).toLocaleString("fa-IR");
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fa-IR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL = { pending: "در انتظار", accepted: "تایید شده", rejected: "رد شده" };

export default function AdminTransfersTab() {
  const [filter, setFilter] = useState("pending");
  const [transfers, setTransfers] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [noteDraft, setNoteDraft] = useState({});

  function reload() {
    fetchAdminTransfers(filter === "all" ? undefined : filter).then(setTransfers).catch(() => setTransfers([]));
  }

  useEffect(() => { reload(); }, [filter]);

  async function viewReceipt(transferId) {
    try {
      const { url } = await fetchTransferReceiptBlobUrlAsAdmin(transferId);
      window.open(url, "_blank");
    } catch {
      alert("نمایش فیش با خطا مواجه شد");
    }
  }

  async function handleDecide(transferId, accept) {
    setBusyId(transferId);
    try {
      await decideTransfer(transferId, accept, noteDraft[transferId] || "");
      reload();
    } catch {
      alert("عملیات با خطا مواجه شد");
    } finally {
      setBusyId(null);
    }
  }

  if (!transfers) return <p className="myorders__empty">در حال بارگذاری…</p>;

  return (
    <div className="admin-accounts">
      <div className="admin-accounts__tabs">
        {["pending", "accepted", "rejected", "all"].map((f) => (
          <button
            key={f}
            className={filter === f ? "admin-accounts__tab is-active" : "admin-accounts__tab"}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "همه" : STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      {transfers.length === 0 ? (
        <p className="myorders__empty">حواله‌ای یافت نشد.</p>
      ) : (
        <div className="admin-accounts__list">
          {transfers.map((t) => (
            <div key={t.id} className="admin-accounts__card">
              <div className="admin-accounts__card-top">
                <div>
                  <span className="admin-accounts__name">{fa(Math.round(t.amount))} تومان</span>
                  <span className="admin-accounts__username" dir="ltr">
                    {t.customer_name || "—"} #{t.user_code}
                  </span>
                </div>
                <span className={`register-transfer__status register-transfer__status--${t.status}`}>
                  {STATUS_LABEL[t.status]}
                </span>
              </div>

              <div className="admin-accounts__meta">
                {t.bank_reference && <span>کد پیگیری: {t.bank_reference}</span>}
                {t.transfer_date && <span>تاریخ واریز: {t.transfer_date}</span>}
                <span>ثبت شده: {formatDate(t.created_at)}</span>
                {t.description && <span>توضیحات: {t.description}</span>}
              </div>

              {t.has_receipt && (
                <button className="dashboard__see-all" onClick={() => viewReceipt(t.id)}>مشاهده فیش</button>
              )}

              {t.status === "pending" && (
                <>
                  <input
                    className="admin-accounts__note-input"
                    placeholder="یادداشت (اختیاری)"
                    value={noteDraft[t.id] || ""}
                    onChange={(e) => setNoteDraft({ ...noteDraft, [t.id]: e.target.value })}
                  />
                  <div className="admin-accounts__actions">
                    <button className="order-limits-box__save" disabled={busyId === t.id} onClick={() => handleDecide(t.id, true)}>
                      تایید و واریز به حساب
                    </button>
                    <button className="admin-accounts__delete" disabled={busyId === t.id} onClick={() => handleDecide(t.id, false)}>
                      رد
                    </button>
                  </div>
                </>
              )}
              {t.admin_note && t.status !== "pending" && (
                <span className="admin-accounts__meta">یادداشت: {t.admin_note}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}