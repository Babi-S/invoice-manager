// Invoice totals. All arithmetic is done in integer cents to avoid floating
// point drift; results are returned in currency units rounded to 2 decimals.
// The server always recalculates with this function — client totals are only
// used for live display.

const toCents = (v) => Math.round((Number(v) || 0) * 100);

export function computeTotals({ services = [], discountType = 'fixed', discountValue = 0, taxRate = 0 }) {
  const lines = services.map((s) => {
    const totalCents = Math.round((Number(s.quantity) || 0) * toCents(s.unitPrice));
    return { ...s, total: totalCents / 100, totalCents };
  });
  const subtotal = lines.reduce((sum, l) => sum + l.totalCents, 0);

  let discount =
    discountType === 'percent'
      ? Math.round((subtotal * Math.min(Math.max(Number(discountValue) || 0, 0), 100)) / 100)
      : toCents(discountValue);
  discount = Math.min(Math.max(discount, 0), subtotal);

  const taxable = subtotal - discount;
  const tax = Math.round((taxable * Math.max(Number(taxRate) || 0, 0)) / 100);

  return {
    lines: lines.map(({ totalCents, ...l }) => l),
    subtotal: subtotal / 100,
    discount: discount / 100,
    tax: tax / 100,
    grandTotal: (taxable + tax) / 100,
  };
}
