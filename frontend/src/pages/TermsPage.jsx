import { useNavigate } from "react-router-dom";

const TERMS_TEXT = `
با ثبت‌نام و استفاده از این برنامه، شما شرایط زیر را می‌پذیرید:

۱. کلیه معاملات بر اساس قیمت لحظه‌ای اعلام‌شده در برنامه انجام می‌شود و پس از تایید مدیریت قطعی است.
۲. مسئولیت صحت اطلاعات واریزی (فیش، شماره پیگیری) بر عهده کاربر است.
۳. تسویه ریالی معاملات، طبق تقویم تسویه اعلام‌شده در برنامه انجام می‌گیرد.
۴. حساب کاربری صرفا برای یک دستگاه فعال می‌شود و در صورت تغییر دستگاه، نیاز به هماهنگی با پشتیبانی است.
۵. مدیریت حق دارد در صورت مغایرت اطلاعات یا مشکوک بودن تراکنش، سفارش را رد یا حساب را مسدود کند.
۶. اطلاعات هویتی کاربران صرفا برای احراز هویت و مطابق قوانین نگهداری می‌شود.
`.trim();

export default function TermsPage() {
  const navigate = useNavigate();

  return (
    <div className="app">
      <header className="app__header">
        <button className="placeholder-page__back" onClick={() => navigate(-1)}>‹ بازگشت</button>
        <h1 className="app__title">شرایط و قوانین</h1>
        <span />
      </header>

      <main className="app__main">
        <div className="static-page">
          {TERMS_TEXT.split("\n").map((line, i) =>
            line.trim() ? <p key={i} className="static-page__line">{line}</p> : <div key={i} className="static-page__gap" />
          )}
        </div>
      </main>
    </div>
  );
}