// Billing-period rules shared by the server and the client.
//
// Business rule: an invoice is always dated the 1st day of the month that
// follows the (latest) billing month. Services for February 2025 are invoiced
// on 01 March 2025; services for December 2026 on 01 January 2027.

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

const ordinal = ({ month, year }) => year * 12 + (month - 1);
const fromOrdinal = (n) => ({ year: Math.floor(n / 12), month: (n % 12) + 1 });

export function monthKey({ month, year }) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function monthLabel({ month, year }, short = false) {
  return `${(short ? MONTHS_SHORT : MONTHS)[month - 1]} ${year}`;
}

/** De-duplicates and sorts billing months chronologically. */
export function normalizeMonths(list = []) {
  const seen = new Map();
  for (const m of list) seen.set(monthKey(m), { month: m.month, year: m.year });
  return [...seen.values()].sort((a, b) => ordinal(a) - ordinal(b));
}

/** Invoice date (UTC midnight) = 1st of the month after the latest billing month. */
export function invoiceDateFor(months) {
  const sorted = normalizeMonths(months);
  if (!sorted.length) return null;
  const last = sorted[sorted.length - 1];
  // `month` is 1-based, so using it as a 0-based index yields the next month.
  return new Date(Date.UTC(last.year, last.month, 1));
}

/** The billing month an invoice dated in (year, month) covers. */
export function billingMonthForInvoiceMonth({ month, year }) {
  return fromOrdinal(ordinal({ month, year }) - 1);
}

/** Inclusive list of months between two billing months. */
export function monthRange(from, to) {
  const out = [];
  for (let n = ordinal(from); n <= ordinal(to); n++) out.push(fromOrdinal(n));
  return out;
}

/** Human readable period: "February 2025", "Jan – Mar 2026", "Nov 2025 – Feb 2026, Apr 2026". */
export function formatBillingPeriod(months) {
  const sorted = normalizeMonths(months);
  if (!sorted.length) return '—';
  if (sorted.length === 1) return monthLabel(sorted[0]);

  const runs = [];
  for (const m of sorted) {
    const run = runs[runs.length - 1];
    if (run && ordinal(m) === ordinal(run[run.length - 1]) + 1) run.push(m);
    else runs.push([m]);
  }
  return runs
    .map((run) => {
      const a = run[0];
      const b = run[run.length - 1];
      if (run.length === 1) return monthLabel(a, true);
      if (a.year === b.year) return `${MONTHS_SHORT[a.month - 1]} – ${MONTHS_SHORT[b.month - 1]} ${a.year}`;
      return `${monthLabel(a, true)} – ${monthLabel(b, true)}`;
    })
    .join(', ');
}

export function billingYears(months) {
  return [...new Set(normalizeMonths(months).map((m) => m.year))];
}
