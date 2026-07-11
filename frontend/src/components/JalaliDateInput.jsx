import { gregorianToJalali, jalaliToGregorian, JALALI_MONTH_NAMES, daysInJalaliMonth, todayJalali } from "../utils/jalali";

function toFa(n) {
  return n.toLocaleString("en-US");
}

// value: "YYYY-MM-DD" Gregorian string (same shape a native date input
// uses), or "" for empty. onChange receives the same shape back.
export default function JalaliDateInput({ value, onChange, label }) {
  const [defaultY, defaultM] = todayJalali();

  let jy = defaultY;
  let jm = defaultM;
  let jd = "";

  if (value) {
    const [gy, gm, gd] = value.split("-").map(Number);
    const [py, pm, pd] = gregorianToJalali(gy, gm, gd);
    jy = py;
    jm = pm;
    jd = pd;
  }

  function emit(newY, newM, newD) {
    if (!newD) {
      onChange("");
      return;
    }
    const maxDay = daysInJalaliMonth(newY, newM);
    const safeDay = Math.min(newD, maxDay);
    const [gy, gm, gd] = jalaliToGregorian(newY, newM, safeDay);
    const iso = `${gy}-${String(gm).padStart(2, "0")}-${String(gd).padStart(2, "0")}`;
    onChange(iso);
  }

  const dayCount = daysInJalaliMonth(jy, jm);
  const years = Array.from({ length: 6 }, (_, i) => defaultY - 4 + i);

  return (
    <div className="jalali-input">
      {label && <span className="date-filter__input-group-label">{label}</span>}
      <div className="jalali-input__row">
        <select
          className="field__input jalali-input__select"
          value={jd || ""}
          onChange={(e) => emit(jy, jm, Number(e.target.value))}
        >
          <option value="">روز</option>
          {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>{toFa(d)}</option>
          ))}
        </select>
        <select
          className="field__input jalali-input__select"
          value={jm}
          onChange={(e) => emit(jy, Number(e.target.value), jd || 1)}
        >
          {JALALI_MONTH_NAMES.map((name, i) => (
            <option key={name} value={i + 1}>{name}</option>
          ))}
        </select>
        <select
          className="field__input jalali-input__select"
          value={jy}
          onChange={(e) => emit(Number(e.target.value), jm, jd || 1)}
        >
          {years.map((y) => (
            <option key={y} value={y}>{toFa(y)}</option>
          ))}
        </select>
      </div>
    </div>
  );
}