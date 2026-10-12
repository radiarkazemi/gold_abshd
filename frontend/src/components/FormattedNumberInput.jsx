import { useState, useEffect } from "react";

function normalizeMinus(value) {
  return String(value ?? "").replace(/[−–—]/g, "-");
}

// fa-IR / Arabic keyboards often insert Eastern digits; \d only matches ASCII.
function toAsciiDigits(value) {
  return String(value ?? "")
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function formatDisplay(raw) {
  if (raw === "" || raw == null) return "";
  const s = normalizeMinus(toAsciiDigits(raw)).trim();
  if (s === "-") return "-";
  const negative = s.startsWith("-");
  const cleaned = s.replace(/^-/, "");
  if (!cleaned) return negative ? "-" : "";
  const [intPart, ...decParts] = cleaned.split(".");
  const decPart = decParts.length ? decParts.join("") : undefined;
  // ASCII comma — clear "3-digit separator" in the admin panel. inputMode is
  // forced to "text" below so mobile Chrome does not strip these commas.
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const grouped = decPart !== undefined ? `${groupedInt}.${decPart}` : groupedInt;
  return negative ? `-${grouped}` : grouped;
}

function stripToRaw(display, allowNegative) {
  let s = normalizeMinus(toAsciiDigits(display)).trim();
  // Commas / Persian thousands (٬) are separators from formatDisplay (and paste).
  // Never treat them as decimals here — that breaks toman amounts like
  // "2,167,000" mid-typing into "2.167000". Order weight fields that need
  // iPhone decimal-comma handling do it outside this component.
  s = s.replace(/[,٬]/g, "");
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
  "aria-label": ariaLabel,
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
      // Always "text": inputMode=decimal/numeric lets Chrome/Android strip
      // thousand separators from the visible value of controlled inputs.
      // We already filter to digits in handleChange.
      inputMode="text"
      className={className}
      value={display}
      onChange={handleChange}
      placeholder={placeholder}
      autoFocus={autoFocus}
      required={required}
      disabled={disabled}
      dir="ltr"
      aria-label={ariaLabel}
      autoComplete="off"
      data-formatted-number="1"
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
