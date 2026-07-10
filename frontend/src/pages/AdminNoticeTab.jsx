import { useEffect, useState } from "react";
import { fetchNotice, updateNotice } from "../api";

export default function AdminNoticeTab() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    fetchNotice()
      .then((res) => setText(res.text))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setSavedMessage("");
    try {
      await updateNotice(text);
      setSavedMessage("ذخیره شد ✓");
      setTimeout(() => setSavedMessage(""), 2500);
    } catch (e) {
      console.error(e);
      setSavedMessage("خطا در ذخیره‌سازی");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="myorders__empty">در حال بارگذاری…</p>;

  return (
    <div className="notice-editor">
      <p className="notice-editor__hint">
        هر خط یک آیتم جداگانه در کارت اطلاعیه‌ی صفحه اصلی نمایش داده می‌شود.
      </p>
      <textarea
        className="field__textarea notice-editor__textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder="هر خط یک اطلاعیه..."
      />
      <div className="notice-editor__actions">
        {savedMessage && <span className="notice-editor__saved">{savedMessage}</span>}
        <button
          className="modal-btn modal-btn--buy"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "در حال ذخیره…" : "ذخیره تغییرات"}
        </button>
      </div>
    </div>
  );
}