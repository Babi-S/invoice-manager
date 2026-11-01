// Display formatting shared by the PDF renderer and the UI.
// Dates are stored as UTC midnight, so they are always formatted in UTC.

const SYMBOL_CURRENCIES = new Set(['USD', 'EUR', 'GBP']);

export const CURRENCIES = ['USD', 'NPR', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'ILS'];

export function formatMoney(amount, currency = 'USD') {
  const value = Number(amount) || 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: SYMBOL_CURRENCIES.has(currency) ? 'symbol' : 'code',
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** yyyy-mm-dd in UTC, for <input type="date"> values. */
export function toDateInput(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
