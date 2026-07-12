import { useEffect, useRef, useState } from "react";
import {
  gregorianToJalali,
  jalaliToGregorian,
  JALALI_MONTH_NAMES,
  daysInJalaliMonth,
  todayJalali,
} from "../utils/jalali";

const WEEKDAY_HEADERS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

function toFa(n) {
  return n.toLocaleString("fa-IR");
}

// JS Date.getDay(): Sun=0..Sat=6. Jalali week index: Sat=0..Fri=6.
function firstDayOffset(jy, jm) {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, 1);
  const jsDay = new Date(gy, gm - 1, gd).getDay();
  return (jsDay + 1) % 7;
}

// value: "YYYY-MM-DD" Gregorian string (same shape a native date input
// uses), or "" for empty. onChange receives the same shape back.
export default function JalaliDateInput({ value, onChange, label }) {
  const [todayY, todayM, todayD] = todayJalali();
  const [open, setOpen] = useState(false);
  const [viewY, setViewY] = useState(todayY);
  const [viewM, setViewM] = useState(todayM);
  const wrapRef = useRef(null);

  let selectedY = null, selectedM = null, selectedD = null;
  if (value) {
    const [gy, gm, gd] = value.split("-").map(Number);
    [selectedY, selectedM, selectedD] = gregorianToJalali(gy, gm, gd);
  }

  useEffect(() => {
    if (selectedY) {
      setViewY(selectedY);
      setViewM(selectedM);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function pickDay(d) {
    const [gy, gm, gd] = jalaliToGregorian(viewY, viewM, d);
    const iso = `${gy}-${String(gm).padStart(2, "0")}-${String(gd).padStart(2, "0")}`;
    onChange(iso);
    setOpen(false);
  }

  function goPrevMonth() {
    if (viewM === 1) { setViewY(viewY - 1); setViewM(12); } else { setViewM(viewM - 1); }
  }
  function goNextMonth() {
    if (viewM === 12) { setViewY(viewY + 1); setViewM(1); } else { setViewM(viewM + 1); }
  }

  const dayCount = daysInJalaliMonth(viewY, viewM);
  const offset = firstDayOffset(viewY, viewM);
  const cells = [...Array(offset).fill(null), ...Array.from({ length: dayCount }, (_, i) => i + 1)];

  const displayText = selectedD
    ? `${toFa(selectedD)} ${JALALI_MONTH_NAMES[selectedM - 1]} ${toFa(selectedY)}`
    : "انتخاب تاریخ";

  return (
    <div className="jalali-cal" ref={wrapRef}>
      {label && <span className="date-filter__input-group-label">{label}</span>}
      <button type="button" className="jalali-cal__trigger" onClick={() => setOpen((o) => !o)}>
        {displayText}
      </button>

      {open && (
        <div className="jalali-cal__popup">
          <div className="jalali-cal__header">
            <button type="button" className="jalali-cal__nav" onClick={goPrevMonth}>›</button>
            <span className="jalali-cal__month-label">
              {JALALI_MONTH_NAMES[viewM - 1]} {toFa(viewY)}
            </span>
            <button type="button" className="jalali-cal__nav" onClick={goNextMonth}>‹</button>
          </div>

          <div className="jalali-cal__weekdays">
            {WEEKDAY_HEADERS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>

          <div className="jalali-cal__grid">
            {cells.map((d, i) =>
              d === null ? (
                <span key={`empty-${i}`} />
              ) : (
                <button
                  type="button"
                  key={d}
                  className={
                    "jalali-cal__day" +
                    (d === selectedD && viewM === selectedM && viewY === selectedY ? " is-selected" : "") +
                    (d === todayD && viewM === todayM && viewY === todayY ? " is-today" : "")
                  }
                  onClick={() => pickDay(d)}
                >
                  {toFa(d)}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}