import { isCurrency, stepFor, unitSuffix } from "../lib/format";
import type { Unit } from "../lib/types";

interface Props {
  label: string;
  unit: Unit;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
  id: string;
  /** Overrides the unit's own suffix, for fields whose unit is bare (a term in
   * years reads as "count" but should still say what it counts). */
  suffix?: string;
}

/**
 * One field per unit. Percents get a range slider — that is the drag loop the
 * whole architecture is built around, so it should feel like dragging.
 */
export function NumberField({ label, unit, value, onChange, hint, id, suffix: override }: Props) {
  if (unit === "percent") {
    return (
      <div className="field">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        <div className="field__range">
          <input
            id={id}
            type="range"
            min={0}
            max={100}
            step={0.5}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          <span className="field__value">{value.toFixed(1)}%</span>
        </div>
        {hint && <span className="field__hint">{hint}</span>}
      </div>
    );
  }

  const suffix = override ?? unitSuffix(unit);

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="field__input">
        {isCurrency(unit) && <span className="field__prefix">$</span>}
        <input
          id={id}
          type="number"
          min={0}
          step={stepFor(unit, value)}
          value={Number.isFinite(value) ? value : 0}
          onChange={(event) => {
            const next = Number(event.target.value);
            onChange(Number.isFinite(next) && next >= 0 ? next : 0);
          }}
        />
        {suffix && <span className="field__suffix">{suffix}</span>}
      </div>
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

interface TextProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id: string;
  placeholder?: string;
}

export function TextField({ label, value, onChange, id, placeholder }: TextProps) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="field__input">
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}
