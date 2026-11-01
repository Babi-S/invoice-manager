import { useState } from 'react';
import { MONTHS_SHORT, monthKey, monthLabel, normalizeMonths } from '@shared/billing.js';
import { Icon } from './Icons.jsx';

export function yearOptions(around = new Date().getFullYear()) {
  return Array.from({ length: 9 }, (_, i) => around - 5 + i);
}

/** Toggle months for a chosen year; selections across years are kept as chips. */
export function MonthPicker({ value, onChange, error }) {
  const latest = value.length ? normalizeMonths(value).at(-1).year : new Date().getFullYear();
  const [year, setYear] = useState(latest);
  const selected = new Set(value.map(monthKey));

  const toggle = (month) => {
    const key = monthKey({ month, year });
    onChange(
      selected.has(key) ? value.filter((m) => monthKey(m) !== key) : normalizeMonths([...value, { month, year }]),
    );
  };

  return (
    <div className="month-picker">
      <div className="month-picker-top">
        <span className="field-label">Billing year</span>
        <select className="input input-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {yearOptions().map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
      </div>
      <div className="month-grid">
        {MONTHS_SHORT.map((m, i) => {
          const on = selected.has(monthKey({ month: i + 1, year }));
          return (
            <button type="button" key={m} className={`month-btn ${on ? 'is-on' : ''}`} onClick={() => toggle(i + 1)} aria-pressed={on}>
              {m}
            </button>
          );
        })}
      </div>
      <div className="chips">
        {value.length === 0 && <span className={error ? 'field-error' : 'muted small'}>{error || 'No billing months selected'}</span>}
        {normalizeMonths(value).map((m) => (
          <span className="chip" key={monthKey(m)}>
            {monthLabel(m)}
            <button type="button" onClick={() => onChange(value.filter((x) => monthKey(x) !== monthKey(m)))} aria-label={`Remove ${monthLabel(m)}`}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
