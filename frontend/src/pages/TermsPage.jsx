import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchTerms } from "../api";

export default function TermsPage() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTerms()
      .then((res) => setText(res.text || ""))
      .catch(() => setText("بارگذاری قوانین با خطا مواجه شد."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="app">
      <header className="app__header">
        <button className="placeholder-page__back" onClick={() => navigate(-1)}>‹ بازگشت</button>
        <h1 className="app__title">شرایط و قوانین</h1>
        <span />
      </header>

      <main className="app__main">
        <div className="static-page">
          {loading ? (
            <p className="static-page__line">در حال بارگذاری…</p>
          ) : (
            text.split("\n").map((line, i) =>
              line.trim() ? <p key={i} className="static-page__line">{line}</p> : <div key={i} className="static-page__gap" />
            )
          )}
        </div>
      </main>
    </div>
  );
}
