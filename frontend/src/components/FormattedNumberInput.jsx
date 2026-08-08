import { useState, useEffect } from "react";

function normalizeMinus(value) {
  return String(value ?? "").replace(/[−–—]/g, "-");
}

function formatDisplay(raw) {
  if (raw === "" || raw == null) return "";
  const s = normalizeMinus(raw).trim();
  if (s === "-") return "-";
  const negative = s.startsWith("-");
  const cleaned = s.replace(/^-/, "");
  if (!cleaned) return negative ? "-" : "";
  const [intPart, ...decParts] = cleaned.split(".");
  const decPart = decParts.length ? decParts.join("") : undefined;
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const grouped = decPart !== undefined ? `${groupedInt}.${decPart}` : groupedInt;
  return negative ? `-${grouped}` : grouped;
}

function stripToRaw(display, allowNegative) {
  let s = normalizeMinus(display).trim();
  // iPhone / some locales type "," as the decimal separator. If the value
  // looks like a decimal (single comma, no period) convert it; otherwise
  // treat commas as thousand separators and strip them.
  const hasPeriod = s.includes(".");
  const commaCount = (s.match(/,/g) || []).length;
  if (!hasPeriod && commaCount === 1 && /^\s*-?\d+,\d+\s*$/.test(s.replace(/[−–—]/g, "-"))) {
    s = s.replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  s = s.replace(/٫/g, ".");
  let negative = false;
  if (allowNegative) {
    // Accept leading or trailing minus while typing (common on mobile / RTL).
    if (s.startsWith("-") || s.endsWith("-")) {
      negative = true;
    }
    s = s.replace(/-/g, "");
  } else {
    s = s.replace(/-/g, "");
  }
  s = s.replace(/[^\d.]/g, "");
  const parts = s.split(".");
  if (parts.length > 2) {
    s = `${parts[0]}.${parts.slice(1).join("")}`;
  }
  if (negative) {
    return s === "" ? "-" : `-${s}`;
  }
  return s;
}

function toggleSign(raw) {
  const s = normalizeMinus(raw).trim();
  if (!s || s === "-") return "-";
  if (s.startsWith("-")) return s.slice(1);
  return `-${s}`;
}

// A text input that shows live comma-grouped digits (e.g. "35,000,000")
// while the user types, but reports back a clean numeric string via
// onChange - a native <input type="number"> can't show separators at
// all, so this swaps to type="text" with digit-only input handling.
//
// allowNegative: balance adjustments need minus; most price fields do not.
// When enabled, a ± control is shown so mobile keyboards without "-" still work.
export default function FormattedNumberInput({
  value,
  onChange,
  className,
  placeholder,
  autoFocus,
  required,
  disabled,
  allowNegative = false,
}) {
  const [display, setDisplay] = useState(formatDisplay(value));

  useEffect(() => {
    setDisplay(formatDisplay(value));
  }, [value]);

  function handleChange(e) {
    const raw = stripToRaw(e.target.value, allowNegative);
    setDisplay(formatDisplay(raw));
    onChange(raw);
  }

  function handleToggleSign() {
    if (disabled) return;
    const next = toggleSign(value);
    setDisplay(formatDisplay(next));
    onChange(next);
  }

  const input = (
    <input
      type="text"
      // "decimal" pads often omit "-" on mobile; use text when negatives matter.
      inputMode={allowNegative ? "text" : "decimal"}
      className={className}
      value={display}
      onChange={handleChange}
      placeholder={placeholder}
      autoFocus={autoFocus}
      required={required}
      disabled={disabled}
      dir="ltr"
    />
  );

  if (!allowNegative) return input;

  return (
    <div className="formatted-number-input formatted-number-input--signed">
      {input}
      <button
        type="button"
        className="formatted-number-input__sign"
        onClick={handleToggleSign}
        disabled={disabled}
        title="مثبت / منفی"
        aria-label="تغییر علامت مثبت و منفی"
      >
        ±
      </button>
    </div>
  );
}
