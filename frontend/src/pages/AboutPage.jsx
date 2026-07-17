import { useNavigate } from "react-router-dom";

export default function AboutPage() {
  const navigate = useNavigate();

  return (
    <div className="app">
      <header className="app__header">
        <button className="placeholder-page__back" onClick={() => navigate(-1)}>‹ بازگشت</button>
        <h1 className="app__title">درباره ما</h1>
        <span />
      </header>

      <main className="app__main">
        <div className="static-page">
          <p className="static-page__line">
            آبشده قصر طلا، بستری برای خرید و فروش آنلاین طلای آبشده با قیمت لحظه‌ای است.
          </p>
          <div className="static-page__gap" />
          <p className="static-page__line">
            هدف ما ارائه تجربه‌ای سریع، شفاف و امن برای معاملات روزانه طلا است - از لحظه ثبت سفارش
            تا تسویه نهایی.
          </p>
          <div className="static-page__gap" />
          <p className="static-page__line">
            برای هرگونه سوال یا مشکل، از بخش «بیشتر» با پشتیبانی در تماس باشید.
          </p>
        </div>
      </main>
    </div>
  );
}