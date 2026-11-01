// End-to-end API checks against a running server (npm start), using throwaway
// invoices for a uniquely named manual customer that are removed at the end.
//   npm run test:api
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

const BASE = process.env.API_URL || `http://127.0.0.1:${process.env.PORT || 5050}/api`;
const CUSTOMER = `ZZ Smoke Test ${Date.now()}`;

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data };
}

const base = (overrides = {}) => ({
  customer: { name: CUSTOMER, email: 'billing@example.com' },
  services: [{ name: 'Consulting', description: 'Hourly consulting', quantity: 10, unitPrice: 120 }],
  billingMonths: [{ month: 1, year: 2031 }],
  paymentStatus: 'Pending',
  ...overrides,
});

after(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const { deletedCount } = await mongoose.connection.db.collection('invoices').deleteMany({ 'customer.name': CUSTOMER });
  console.log(`cleanup: removed ${deletedCount} test invoices`);
  await mongoose.disconnect();
});

let first;

test('creates an invoice with multiple services and months; totals recalculated server-side', async () => {
  const { status, data } = await api('POST', '/invoices', base({
    services: [
      { name: 'Consulting', quantity: 10, unitPrice: 120, total: 1 },
      { name: 'Hosting', quantity: 2, unitPrice: 49.99 },
    ],
    billingMonths: [{ month: 3, year: 2031 }, { month: 2, year: 2031 }],
    discountType: 'percent',
    discountValue: 5,
    taxRate: 13,
    grandTotal: 1, // must be ignored
    subtotal: 1,
  }));
  assert.equal(status, 201, JSON.stringify(data));
  first = data;
  assert.match(data.invoiceNumber, /^INV-\d{6}$/);
  assert.equal(data.subtotal, 1299.98);
  assert.equal(data.discount, 65);
  assert.equal(data.tax, 160.55);
  assert.equal(data.grandTotal, 1395.53);
  assert.deepEqual(data.services.map((s) => s.total), [1200, 99.98]);
  assert.equal(data.invoiceDate.slice(0, 10), '2031-04-01', 'dated 1st of month after latest billing month');
  assert.deepEqual(data.billingMonths, [{ month: 2, year: 2031 }, { month: 3, year: 2031 }]);
});

test('rejects billing the same customer + service + month twice', async () => {
  const { status, data } = await api('POST', '/invoices', base({ billingMonths: [{ month: 3, year: 2031 }] }));
  assert.equal(status, 409);
  assert.match(data.error, /March 2031.*already invoiced.*INV-\d{6}/);
});

test('validates input', async () => {
  const { status, data } = await api('POST', '/invoices', {
    customer: { customerId: 'not-an-id', name: '' , email: 'nope' },
    services: [{ name: 'X', quantity: -1, unitPrice: -5 }],
    billingMonths: [{ month: 13, year: 2031 }],
    paymentStatus: 'Cancelled',
  });
  assert.equal(status, 400);
  const paths = data.details.map((d) => d.path);
  for (const p of ['customer.customerId', 'customer.name', 'customer.email', 'services[0].quantity', 'services[0].unitPrice', 'billingMonths[0].month', 'paymentStatus']) {
    assert.ok(paths.includes(p), `expected error for ${p}: ${JSON.stringify(data.details)}`);
  }
  const unknownRef = await api('POST', '/invoices', base({ customer: { customerId: '0123456789abcdef01234567', name: CUSTOMER } }));
  assert.equal(unknownRef.status, 400);
  assert.equal((await api('GET', '/invoices/xyz')).status, 400);
});

test('invoice numbers are unique, even under concurrency and when a taken number is proposed', async () => {
  const results = await Promise.all(
    Array.from({ length: 24 }, (_, i) =>
      api('POST', '/invoices', base({ billingMonths: [{ month: (i % 12) + 1, year: 2033 + Math.floor(i / 12) }] })),
    ),
  );
  results.forEach((r) => assert.equal(r.status, 201, JSON.stringify(r.data)));
  const numbers = results.map((r) => r.data.invoiceNumber);
  assert.equal(new Set(numbers).size, numbers.length);

  const reused = await api('POST', '/invoices', base({ billingMonths: [{ month: 6, year: 2035 }], proposedNumber: first.invoiceNumber }));
  assert.equal(reused.status, 201);
  assert.notEqual(reused.data.invoiceNumber, first.invoiceNumber);

  const proposed = (await api('GET', '/invoices/next-number')).data.invoiceNumber;
  const kept = await api('POST', '/invoices', base({ billingMonths: [{ month: 7, year: 2035 }], proposedNumber: proposed }));
  assert.equal(kept.data.invoiceNumber, proposed);
});

test('generates PDFs from saved data and previews unsaved drafts', async () => {
  const pdf = await api('GET', `/invoices/${first._id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
  const preview = await api('POST', '/invoices/preview', base({ billingMonths: [{ month: 9, year: 2031 }] }));
  assert.equal(preview.status, 200);
  assert.equal(preview.data.subarray(0, 4).toString(), '%PDF');
});

test('edits an invoice and updates payment status', async () => {
  const edit = await api('PUT', `/invoices/${first._id}`, {
    ...base({ billingMonths: first.billingMonths }),
    services: [{ name: 'Consulting', quantity: 12, unitPrice: 100 }],
  });
  assert.equal(edit.status, 200, JSON.stringify(edit.data));
  assert.equal(edit.data.invoiceNumber, first.invoiceNumber, 'number never changes');
  assert.equal(edit.data.grandTotal, 1200);

  const partial = await api('PATCH', `/invoices/${first._id}/payment`, { paymentStatus: 'Partially Paid', amountPaid: 500 });
  assert.equal(partial.data.amountPaid, 500);
  const tooMuch = await api('PATCH', `/invoices/${first._id}/payment`, { paymentStatus: 'Partially Paid', amountPaid: 5000 });
  assert.equal(tooMuch.status, 400);
  const paid = await api('PATCH', `/invoices/${first._id}/payment`, { paymentStatus: 'Paid', paymentMethod: 'Bank transfer' });
  assert.equal(paid.data.amountPaid, 1200);
  assert.equal(paid.data.paymentMethod, 'Bank transfer');
});

test('paid invoices cannot be deleted; cancelling frees the billing period', async () => {
  assert.equal((await api('DELETE', `/invoices/${first._id}`)).status, 409);
  const cancelled = await api('POST', `/invoices/${first._id}/cancel`);
  assert.equal(cancelled.data.paymentStatus, 'Cancelled');
  assert.equal((await api('PUT', `/invoices/${first._id}`, base())).status, 409);
  const reissue = await api('POST', '/invoices', base({ billingMonths: [{ month: 3, year: 2031 }] }));
  assert.equal(reissue.status, 201);
  assert.equal((await api('DELETE', `/invoices/${reissue.data._id}`)).status, 204);
  assert.equal((await api('GET', `/invoices/${reissue.data._id}`)).status, 404);
});

test('bulk generation previews then creates one invoice per month and skips existing ones', async () => {
  const body = {
    customer: { name: CUSTOMER },
    services: [{ name: 'Retainer', quantity: 1, unitPrice: 2500 }],
    from: { month: 2, year: 2040 },
    to: { month: 12, year: 2041 },
  };
  const dry = await api('POST', '/invoices/bulk', body);
  assert.equal(dry.data.summary.toCreate, 23);
  assert.equal(dry.data.summary.total, 57500);
  assert.equal(dry.data.items[0].invoiceDate.slice(0, 10), '2040-03-01');
  assert.equal(dry.data.items.at(-1).invoiceDate.slice(0, 10), '2042-01-01');

  await api('POST', '/invoices', { ...base(), services: body.services, billingMonths: [{ month: 5, year: 2040 }] });
  const run = await api('POST', '/invoices/bulk?dryRun=false', body);
  assert.equal(run.status, 201);
  assert.equal(run.data.summary.toCreate, 22);
  assert.equal(run.data.summary.skipped, 1);
  assert.equal(run.data.items.find((i) => i.billingMonth.month === 5 && i.billingMonth.year === 2040).status, 'exists');
});

test('lists with filters', async () => {
  const { data } = await api('GET', `/invoices?customer=${encodeURIComponent(CUSTOMER)}&service=Retainer&month=5&year=2040`);
  assert.equal(data.total, 1);
  const byStatus = await api('GET', `/invoices?customer=${encodeURIComponent(CUSTOMER)}&status=Cancelled`);
  assert.equal(byStatus.data.total, 1);
  assert.equal((await api('GET', '/invoices?status=Bogus')).status, 400);
});
