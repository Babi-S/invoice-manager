import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBillingPeriod, invoiceDateFor, monthRange, normalizeMonths } from '../../shared/billing.js';
import { computeTotals } from '../../shared/calc.js';
import { buildBillingKeys } from '../src/services/invoiceService.js';

const iso = (d) => d.toISOString().slice(0, 10);

test('invoice date is the 1st of the month after the billing month', () => {
  const cases = [
    [{ month: 2, year: 2025 }, '2025-03-01'],
    [{ month: 3, year: 2025 }, '2025-04-01'],
    [{ month: 12, year: 2025 }, '2026-01-01'],
    [{ month: 1, year: 2026 }, '2026-02-01'],
    [{ month: 11, year: 2026 }, '2026-12-01'],
    [{ month: 12, year: 2026 }, '2027-01-01'],
  ];
  for (const [month, expected] of cases) assert.equal(iso(invoiceDateFor([month])), expected);
});

test('multi-month invoice is dated after the latest billing month', () => {
  assert.equal(iso(invoiceDateFor([{ month: 3, year: 2026 }, { month: 1, year: 2026 }])), '2026-04-01');
});

test('bulk range Feb 2025 – Dec 2026 = 23 invoices, 01 Mar 2025 → 01 Jan 2027, $57,500', () => {
  const months = monthRange({ month: 2, year: 2025 }, { month: 12, year: 2026 });
  assert.equal(months.length, 23);
  assert.equal(iso(invoiceDateFor([months[0]])), '2025-03-01');
  assert.equal(iso(invoiceDateFor([months.at(-1)])), '2027-01-01');
  const total = months.reduce((s) => s + computeTotals({ services: [{ quantity: 1, unitPrice: 2500 }] }).grandTotal, 0);
  assert.equal(total, 57500);
});

test('totals: multiple lines, percent discount, tax, cents rounding', () => {
  const t = computeTotals({
    services: [
      { quantity: 3, unitPrice: 19.99 },
      { quantity: 1.5, unitPrice: 100 },
    ],
    discountType: 'percent',
    discountValue: 10,
    taxRate: 13,
  });
  assert.equal(t.subtotal, 209.97);
  assert.equal(t.discount, 21);
  assert.equal(t.tax, 24.57);
  assert.equal(t.grandTotal, 213.54);
  assert.deepEqual(t.lines.map((l) => l.total), [59.97, 150]);
});

test('fixed discount is capped at the subtotal', () => {
  const t = computeTotals({ services: [{ quantity: 1, unitPrice: 50 }], discountValue: 80 });
  assert.equal(t.discount, 50);
  assert.equal(t.grandTotal, 0);
});

test('billing period labels', () => {
  assert.equal(formatBillingPeriod([{ month: 2, year: 2025 }]), 'February 2025');
  assert.equal(formatBillingPeriod([{ month: 1, year: 2026 }, { month: 3, year: 2026 }, { month: 2, year: 2026 }]), 'Jan – Mar 2026');
  assert.equal(formatBillingPeriod([{ month: 11, year: 2025 }, { month: 1, year: 2026 }, { month: 12, year: 2025 }]), 'Nov 2025 – Jan 2026');
  assert.equal(formatBillingPeriod([{ month: 1, year: 2026 }, { month: 5, year: 2026 }]), 'Jan 2026, May 2026');
});

test('months are de-duplicated and sorted', () => {
  assert.deepEqual(normalizeMonths([{ month: 5, year: 2026 }, { month: 1, year: 2026 }, { month: 5, year: 2026 }]), [
    { month: 1, year: 2026 },
    { month: 5, year: 2026 },
  ]);
});

test('billing keys: one per service × month; manual entries keyed by normalised name', () => {
  const keys = buildBillingKeys(
    { customerId: null, name: '  Acme   Ltd ' },
    [{ serviceId: '64b000000000000000000001', name: 'Hosting' }, { serviceId: null, name: 'Setup' }],
    [{ month: 1, year: 2026 }, { month: 2, year: 2026 }],
  );
  assert.deepEqual([...keys.keys()].sort(), [
    'manual:acme ltd|64b000000000000000000001|2026-01',
    'manual:acme ltd|64b000000000000000000001|2026-02',
    'manual:acme ltd|manual:setup|2026-01',
    'manual:acme ltd|manual:setup|2026-02',
  ]);
});
