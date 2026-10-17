import { parseAmount } from "../lib/money";

/** Campo de importe con teclado decimal en el móvil. Acepta "12,50" y "12.50". */
export default function AmountInput({ value, onChange, placeholder = "0,00", ariaLabel, suffix = "€" }:
  { value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel: string; suffix?: string }) {
  const invalid = value.trim() !== "" && parseAmount(value) === null;
  return (
    <span className={`amount-input${invalid ? " invalid" : ""}`}>
      <input inputMode="decimal" autoComplete="off" placeholder={placeholder} aria-label={ariaLabel}
             aria-invalid={invalid} value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="suffix">{suffix}</span>
    </span>
  );
}
