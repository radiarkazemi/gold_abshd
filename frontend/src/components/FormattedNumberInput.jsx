import { useState, useEffect } from "react";

function formatDisplay(raw) {
  if (raw === "" || raw == null) return "";
  const negative = String(raw).trim().startsWith("-");
  const cleaned = String(raw).replace(/^-/, "");
  const [intPart, decPart] = cleaned.split(".");
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const grouped = decPart !== undefined ? `${groupedInt}.${decPart}` : groupedInt;
  return negative ? `-${grouped}` : grouped;
}

function stripToRaw(display) {
  const negative = display.trim().startsWith("-");
  const digits = display.replace(/,/g, "").replace(/[^\d.]/g, "");
  return negative ? `-${digits}` : digits;
}

// A text input that shows live comma-grouped digits (e.g. "35,000,000")
// while the user types, but reports back a clean numeric string via
// onChange - a native <input type="number"> can't show separators at
// all, so this swaps to type="text" with digit-only input handling.
export default function FormattedNumberInput({ value, onChange, className, placeholder, autoFocus, required }) {
  const [display, setDisplay] = useState(formatDisplay(value));

  useEffect(() => {
    setDisplay(formatDisplay(value));
  }, [value]);

  function handleChange(e) {
    const raw = stripToRaw(e.target.value);
    setDisplay(formatDisplay(raw));
    onChange(raw);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      value={display}
      onChange={handleChange}
      placeholder={placeholder}
      autoFocus={autoFocus}
      required={required}
      dir="ltr"
    />
  );
}