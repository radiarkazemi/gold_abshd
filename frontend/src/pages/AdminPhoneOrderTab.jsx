import { useEffect, useState } from "react";
import { fetchAdminUsers, fetchPrice, createPhoneOrder } from "../api";
import FormattedNumberInput from "../components/FormattedNumberInput";

function fa(n, opts) {
  return Number(n).toLocaleString("fa-IR", opts);
}

export default function AdminPhoneOrderTab() {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);

  const [side, setSide] = useState("buy");
  const [amountType, setAmountType] = useState("weight");
  const [value, setValue] = useState("");
  const [mesghal17Price, setMesghal17Price] = useState("");
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetchPrice()
      .then((p) => setMesghal17Price(String(Math.round(side === "buy" ? p.buy_price : p.sell_price))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side]);

  useEffect(() => {
    if (!search || selectedUser) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      fetchAdminUsers(search).then(setResults).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [search, selectedUser]);

  function pickUser(u) {
    setSelectedUser(u);
    setSearch(`${u.full_name || "بدون نام"} #${u.user_code}`);
    setResults([]);
  }

  function clearUser() {
    setSelectedUser(null);
    setSearch("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!selectedUser) {
      setError("ابتدا یک مشتری انتخاب کنید");
      return;
    }
    const numericValue = parseFloat(value);
    const numericPrice = parseFloat(mesghal17Price);
    if (!numericValue || numericValue <= 0) {
      setError("مقدار وارد شده معتبر نیست");
      return;
    }
    if (!numericPrice || numericPrice <= 0) {
      setError("قیمت مثقال ۱۷ معتبر نیست");
      return;
    }
    setSubmitting(true);
    try {
      const order = await createPhoneOrder({
        userId: selectedUser.id,
        side,
        amountType,
        value: numericValue,
        mesghal17Price: numericPrice,
        description,
      });
      setResult(order);
    } catch (err) {
      setError(err.message || "خطا در ثبت سفارش");
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setResult(null);
    setValue("");
    setDescription("");
    clearUser();
  }

  if (result) {
    return (
      <div className="add-user-result">
        <h3 className="add-user-result__title">سفارش با موفقیت ثبت و تایید شد ✓</h3>
        <p className="add-user-result__phone">
          {result.customer_name} #{result.customer_code}
        </p>
        <div className="reg-key-box" style={{ textAlign: "center" }}>
          <span className="field__label">
            {result.side === "buy" ? "خرید" : "فروش"} —{" "}
            {fa(result.amount_type === "weight" ? result.value : result.value / result.price_at_submit, { maximumFractionDigits: 4 })}{" "}
            گرم۱۸
          </span>
          <p className="add-user-result__key" style={{ fontSize: 16, margin: "8px 0 0" }}>
            به قیمت {fa(Math.round(result.mesghal17_price_at_submit))} تومان (مثقال ۱۷)
          </p>
        </div>
        <button className="modal-btn modal-btn--buy" onClick={handleReset} style={{ marginTop: 16 }}>
          ثبت حواله دیگر
        </button>
      </div>
    );
  }

  return (
    <form className="add-user-form" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field__label">مشتری</span>
        <input
          type="text"
          className="field__input"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSelectedUser(null);
          }}
          placeholder="جستجو با نام، شماره یا کد کاربر…"
        />
        {selectedUser && (
          <span className="field__hint">
            انتخاب‌شده: {selectedUser.full_name} #{selectedUser.user_code} ·{" "}
            <button type="button" onClick={clearUser} style={{ color: "var(--sell-bright)", border: "none", background: "none", cursor: "pointer" }}>
              تغییر
            </button>
          </span>
        )}
      </label>

      {results.length > 0 && (
        <div className="role-list" style={{ marginBottom: 14 }}>
          {results.map((u) => (
            <button
              type="button"
              key={u.id}
              className="role-row"
              style={{ textAlign: "right", cursor: "pointer" }}
              onClick={() => pickUser(u)}
            >
              <span className="role-row__name" style={{ marginBottom: 0 }}>
                {u.full_name || "بدون نام"} #{u.user_code}
              </span>
              <span className="field__hint" dir="ltr">{u.phone_number}</span>
            </button>
          ))}
        </div>
      )}

      <div className="segmented" style={{ marginBottom: 14 }}>
        <button type="button" className={side === "buy" ? "segmented__opt is-active" : "segmented__opt"} onClick={() => setSide("buy")}>
          خرید
        </button>
        <button type="button" className={side === "sell" ? "segmented__opt is-active" : "segmented__opt"} onClick={() => setSide("sell")}>
          فروش
        </button>
      </div>

      <div className="segmented" style={{ marginBottom: 14 }}>
        <button type="button" className={amountType === "weight" ? "segmented__opt is-active" : "segmented__opt"} onClick={() => setAmountType("weight")}>
          وزن
        </button>
        <button type="button" className={amountType === "amount" ? "segmented__opt is-active" : "segmented__opt"} onClick={() => setAmountType("amount")}>
          مبلغ
        </button>
      </div>

      <label className="field">
        <span className="field__label">{amountType === "weight" ? "وزن (گرم ۱۸)" : "مبلغ (تومان)"}</span>
        {amountType === "amount" ? (
          <FormattedNumberInput value={value} onChange={setValue} className="field__input" />
        ) : (
          <input
            type="number"
            step="any"
            className="field__input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </label>

      <label className="field">
        <span className="field__label">قیمت مثقال ۱۷ (قابل ویرایش)</span>
        <FormattedNumberInput value={mesghal17Price} onChange={setMesghal17Price} className="field__input" />
        <span className="field__hint">با قیمت زنده پر شده، در صورت توافق دیگر با مشتری قابل تغییر است.</span>
      </label>

      <label className="field">
        <span className="field__label">توضیحات (اختیاری)</span>
        <textarea
          className="field__textarea"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="مثلا: تماس تلفنی ساعت ۱۴:۳۰"
        />
      </label>

      {error && <p className="field__error">{error}</p>}

      <button type="submit" className="modal-btn modal-btn--buy" disabled={submitting}>
        {submitting ? "در حال ثبت…" : "ثبت و تایید سفارش"}
      </button>
    </form>
  );
}