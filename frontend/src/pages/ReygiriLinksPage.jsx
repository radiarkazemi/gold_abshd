import { useState } from "react";
import { useNavigate } from "react-router-dom";
import BottomTabBar from "../components/BottomTabBar";
import { useAuth } from "../context/AuthContext";
import { lookupReygiri } from "../api";

const EXTERNAL_LINKS = [
  {
    id: "national",
    label: "باز کردن سایت ریگیری کشوری",
    href: "https://reygiri.com/index.asp",
  },
  {
    id: "abhar",
    label: "باز کردن سایت ریگیری ابهر",
    href: "https://reygir.ir/",
  },
];

function toEnglishDigits(value) {
  return String(value || "")
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
}

function ResultField({ label, value }) {
  if (value == null || value === "") return null;
  return (
    <div className="reygiri-result__field">
      <span className="reygiri-result__label">{label}</span>
      <strong className="reygiri-result__value">{value}</strong>
    </div>
  );
}

function NationalCard({ item }) {
  const extraEntries = Object.entries(item.fields || {}).filter(([k]) => {
    const known = ["عیار", "نام ریگیری", "نام ری‌گیری", "نوع ثبت", "تاریخ و ساعت", "سری"];
    const kn = k.replace(/\u200c/g, "");
    return !known.some((n) => n.replace(/\u200c/g, "") === kn);
  });

  return (
    <article className="reygiri-result">
      {item.title && <h4 className="reygiri-result__title">{item.title}</h4>}
      <div className="reygiri-result__grid">
        <ResultField label="عیار" value={item.karat} />
        <ResultField label="نام ری‌گیری" value={item.lab_name} />
        <ResultField label="نوع ثبت" value={item.register_type} />
        <ResultField label="تاریخ و ساعت" value={item.datetime} />
        <ResultField label="سری" value={item.series} />
        {extraEntries.map(([k, v]) => (
          <ResultField key={k} label={k} value={v} />
        ))}
      </div>
    </article>
  );
}

function AbharCard({ item }) {
  return (
    <article className="reygiri-result">
      <div className="reygiri-result__grid">
        <ResultField label="عیار" value={item.karat} />
        <ResultField label="کد انگ" value={item.ang} />
        <ResultField label="دارنده" value={item.owner} />
        <ResultField label="آزمایشگاه" value={item.lab_name} />
      </div>
    </article>
  );
}

function SourceSection({ title, source }) {
  if (!source) return null;
  return (
    <section className="reygiri-source">
      <div className="reygiri-source__head">
        <h3 className="reygiri-source__title">{title}</h3>
        <span className="reygiri-source__badge">{source.source || ""}</span>
      </div>

      {!source.ok && source.error && (
        <p className="reygiri-source__error">{source.error}</p>
      )}

      {(source.warnings || []).map((w, i) => (
        <p key={i} className="reygiri-source__warn">
          {w}
        </p>
      ))}

      {source.ok && source.empty && (
        <p className="reygiri-source__empty">نتیجه‌ای در این سامانه پیدا نشد.</p>
      )}

      {source.ok && (source.items || []).length > 0 && (
        <div className="reygiri-source__list">
          {(source.items || []).map((item, idx) =>
            title.includes("ابهر") ? (
              <AbharCard key={item.id || idx} item={item} />
            ) : (
              <NationalCard key={idx} item={item} />
            )
          )}
        </div>
      )}
    </section>
  );
}

export default function ReygiriLinksPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [ang, setAng] = useState("");
  const [series, setSeries] = useState("");
  const [includeArchive, setIncludeArchive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function handleSearch(e) {
    e.preventDefault();
    setError("");
    const cleaned = toEnglishDigits(ang).replace(/[^\d]/g, "");
    if (!cleaned) {
      setError("شماره انگ / پاکت را وارد کنید");
      return;
    }
    setAng(cleaned);
    setLoading(true);
    setResult(null);
    try {
      const res = await lookupReygiri({
        ang: cleaned,
        series,
        includeArchive,
      });
      setResult(res);
    } catch (err) {
      setError(err.message || "جستجو با خطا مواجه شد");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <button type="button" className="placeholder-page__back" onClick={() => navigate(-1)}>
          ‹ بازگشت
        </button>
        <h1 className="app__title">سامانه‌های ریگیری</h1>
        <span />
      </header>

      <main className="app__main app__main--with-tabbar">
        <div className="reygiri-page">
          <p className="reygiri-page__hint">
            شماره انگ (پاکت) را وارد کنید تا نتیجه از سامانه کشوری و سامانه ابهر هم‌زمان دریافت شود.
          </p>

          <form className="reygiri-search" onSubmit={handleSearch}>
            <label className="field">
              <span className="field__label">شماره انگ / پاکت</span>
              <input
                className="field__input"
                type="text"
                inputMode="numeric"
                dir="ltr"
                placeholder="مثلاً ۲۵۰۰۰"
                value={ang}
                onChange={(e) => setAng(toEnglishDigits(e.target.value).replace(/[^\d]/g, ""))}
                maxLength={15}
                autoFocus
              />
            </label>

            <div className="reygiri-search__row">
              <label className="field">
                <span className="field__label">کد سری (کشوری)</span>
                <select
                  className="field__input"
                  value={series}
                  onChange={(e) => setSeries(e.target.value)}
                >
                  <option value="">پاکت سری ۱ تا ۹</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                  <option value="D">D</option>
                </select>
              </label>
            </div>

            <label className="reygiri-search__archive">
              <input
                type="checkbox"
                checked={includeArchive}
                onChange={(e) => setIncludeArchive(e.target.checked)}
              />
              <span>نمایش آرشیو سامانه کشوری (از سال ۱۳۸۸)</span>
            </label>

            {error && <p className="login__error">{error}</p>}

            <button type="submit" className="reygiri-search__btn" disabled={loading}>
              {loading ? "در حال جستجو…" : "جستجو"}
            </button>
          </form>

          {result && (
            <div className="reygiri-results">
              <SourceSection title="سامانه ریگیری کشوری" source={result.national} />
              <SourceSection title="سامانه ریگیری ابهر" source={result.abhar} />
            </div>
          )}

          <div className="reygiri-page__actions">
            <p className="reygiri-page__hint">در صورت نیاز می‌توانید سایت اصلی را هم باز کنید:</p>
            {EXTERNAL_LINKS.map((item) => (
              <a
                key={item.id}
                className="reygiri-page__btn"
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="reygiri-page__btn-label">{item.label}</span>
                <span className="reygiri-page__btn-url">{item.href.replace(/^https?:\/\//, "")}</span>
              </a>
            ))}
          </div>
        </div>
      </main>

      <BottomTabBar userPhone={user?.phone_number} onLogout={logout} />
    </div>
  );
}
