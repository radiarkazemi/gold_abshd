import { useEffect, useState } from "react";
import { fetchHolidays, addHoliday, deleteHoliday, fetchSettlementLabel } from "../api";

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("fa-IR");
}

export default function AdminCalendarTab() {
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newDate, setNewDate] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [error, setError] = useState("");
  const [settlement, setSettlement] = useState(null);

  function reload() {
    fetchHolidays().then(setHolidays).catch(console.error).finally(() => setLoading(false));
    fetchSettlementLabel().then(setSettlement).catch(() => {});
  }

  useEffect(reload, []);

  async function handleAdd(e) {
    e.preventDefault();
    setError("");
    if (!newDate) {
      setError("تاریخ الزامی است");
      return;
    }
    try {
      await addHoliday(newDate, newDesc);
      setNewDate("");
      setNewDesc("");
      reload();
    } catch (err) {
      setError(err.message || "خطا در ثبت تعطیلی");
    }
  }

  async function handleDelete(id) {
    if (!confirm("این تعطیلی حذف شود؟")) return;
    try {
      await deleteHoliday(id);
      reload();
    } catch (err) {
      alert(err.message || "خطا در حذف");
    }
  }

  return (
    <div>
      {settlement && (
        <div className="reg-key-box">
          <span className="field__label">تسویه فعلی (نقد)</span>
          <p className="add-user-result__key" style={{ fontSize: 18, margin: "6px 0 0" }}>
            {settlement.label}
          </p>
          <span className="reg-key-box__meta">
            {settlement.jalali_date} (میلادی: {settlement.date})
          </span>
        </div>
      )}

      <h3 className="notice-editor__hint">تعطیلات ثبت‌شده</h3>
      {loading ? (
        <p className="myorders__empty">در حال بارگذاری…</p>
      ) : holidays.length === 0 ? (
        <p className="myorders__empty">تعطیلی‌ای ثبت نشده (فقط جمعه‌ها تعطیل در نظر گرفته می‌شود).</p>
      ) : (
        <div className="role-list">
          {holidays.map((h) => (
            <div key={h.id} className="role-row">
              <div className="role-row__controls" style={{ justifyContent: "space-between" }}>
                <div>
                  <span className="role-row__name" style={{ marginBottom: 0 }}>{formatDate(h.date)}</span>
                  {h.description && <span className="field__hint">{h.description}</span>}
                </div>
                <button className="user-detail__block-btn is-blocked" onClick={() => handleDelete(h.id)}>
                  حذف
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="notice-editor__hint" style={{ marginTop: 24 }}>افزودن تعطیلی جدید</h3>
      <form className="add-user-form" onSubmit={handleAdd}>
        <label className="field">
          <span className="field__label">تاریخ (میلادی)</span>
          <input type="date" className="field__input" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">توضیح (اختیاری)</span>
          <input
            type="text"
            className="field__input"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="مثلا: تعطیل رسمی - عید نوروز"
          />
        </label>
        {error && <p className="field__error">{error}</p>}
        <button type="submit" className="modal-btn modal-btn--buy">افزودن تعطیلی</button>
      </form>
    </div>
  );
}