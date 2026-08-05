import { useEffect, useState } from "react";
import { fetchNotice, updateNotice, fetchTerms, updateTerms } from "../api";

export default function AdminNoticeTab() {
  const [text, setText] = useState("");
  const [termsText, setTermsText] = useState("");
  const [termsVersion, setTermsVersion] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingTerms, setSavingTerms] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [termsSavedMessage, setTermsSavedMessage] = useState("");

  useEffect(() => {
    Promise.all([fetchNotice(), fetchTerms()])
      .then(([notice, terms]) => {
        setText(notice.text);
        setTermsText(terms.text || "");
        setTermsVersion(terms.version || "");
      })
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

  async function handleSaveTerms() {
    setSavingTerms(true);
    setTermsSavedMessage("");
    try {
      const res = await updateTerms(termsText);
      setTermsText(res.text || termsText);
      setTermsVersion(res.version || "");
      setTermsSavedMessage("ذخیره شد ✓");
      setTimeout(() => setTermsSavedMessage(""), 2500);
    } catch (e) {
      console.error(e);
      setTermsSavedMessage("خطا در ذخیره‌سازی");
    } finally {
      setSavingTerms(false);
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

      <hr className="notice-editor__divider" />

      <h3 className="adjust-form__title">قوانین و مقررات</h3>
      <p className="notice-editor__hint">
        متنی که کاربر هنگام ورود باید بخواند و بپذیرد. با هر تغییر، نسخه افزایش می‌یابد
        {termsVersion ? ` (نسخه فعلی: ${termsVersion})` : ""}.
        پذیرش‌ها به‌صورت امضای دیجیتال دائمی ذخیره می‌شوند.
      </p>
      <textarea
        className="field__textarea notice-editor__textarea"
        value={termsText}
        onChange={(e) => setTermsText(e.target.value)}
        rows={12}
        placeholder="متن قوانین و مقررات..."
      />
      <div className="notice-editor__actions">
        {termsSavedMessage && <span className="notice-editor__saved">{termsSavedMessage}</span>}
        <button
          className="modal-btn modal-btn--buy"
          onClick={handleSaveTerms}
          disabled={savingTerms}
        >
          {savingTerms ? "در حال ذخیره…" : "ذخیره قوانین"}
        </button>
      </div>
    </div>
  );
}
