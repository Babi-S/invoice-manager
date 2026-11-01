// Creates monthly invoices from the "Support Agent" work-record spreadsheet.
//
//   npm run import:sample -- <path-to.xlsx> [--from 2025-02] [--to 2026-12] [--dry-run yes] [--create-catalog yes]
//        [--rate 2500] [--customer "Customer Name"] [--service "Support Agent – Development & Support"]
//
// --from/--to are BILLING months. Each invoice is dated the 1st of the following
// month (Feb 2025 → 01 Mar 2025 … Dec 2026 → 01 Jan 2027). Each invoice carries
// that month's task list and hours from the spreadsheet. Safe to re-run: months
// already invoiced are skipped by the duplicate guard.
//
// The customer and service are looked up by name in the configured collections
// and referenced by id when found. When not found, the invoices carry a manual
// snapshot instead — unless --create-catalog yes is passed, which adds them once.
// Existing records are never modified.

import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { Invoice } from '../src/models/Invoice.js';
import { createInvoice } from '../src/services/invoiceService.js';
import { HttpError } from '../src/utils/errors.js';
import { readWorkbook, excelDate } from './lib/xlsx.js';
import { MONTHS_SHORT, invoiceDateFor, monthKey, monthLabel, monthRange } from '../../shared/billing.js';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}
const ym = (s) => {
  const m = /^(\d{4})-(\d{2})$/.exec(s || '');
  if (!m) throw new Error(`Expected YYYY-MM, got "${s}"`);
  return { year: Number(m[1]), month: Number(m[2]) };
};

const args = parseArgs(process.argv.slice(2));
const file = args._[0];
if (!file) {
  console.error('Usage: npm run import:sample -- <file.xlsx> [--from 2025-02] [--to 2026-12] [--rate 2500]');
  process.exit(1);
}
const from = ym(args.from || '2025-02');
const to = ym(args.to || '2026-12');
const rate = Number(args.rate || 2500);
const customerName = args.customer || 'Customer';
const serviceName = args.service || 'Support Agent – Development & Support';

// ── Parse the work log: one sheet per month named "Mon YYYY" ───────────────
const workLog = new Map();
for (const sheet of readWorkbook(readFileSync(file))) {
  const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(sheet.name);
  if (!m) continue;
  const month = MONTHS_SHORT.indexOf(m[1]) + 1;
  if (!month) continue;
  const tasks = [];
  for (const row of sheet.rows) {
    const [no, date, category, , description, hours] = row;
    if (typeof no !== 'number' || !description) continue;
    tasks.push({ date: typeof date === 'number' ? excelDate(date) : null, category, description, hours: Number(hours) || 0 });
  }
  workLog.set(monthKey({ month, year: Number(m[2]) }), tasks);
}
console.log(`Read ${workLog.size} monthly sheets from ${file}`);

if (args['dry-run'] === 'yes') {
  const months = monthRange(from, to);
  for (const m of months) {
    const tasks = workLog.get(monthKey(m)) || [];
    const date = invoiceDateFor([m]).toISOString().slice(0, 10);
    console.log(`  ${date}  ${monthLabel(m).padEnd(15)} ${rate}  ${tasks.length} tasks, ${tasks.reduce((s, t) => s + t.hours, 0)}h`);
  }
  console.log(`Dry run: ${months.length} invoices, total ${months.length * rate}. Nothing written.`);
  process.exit(0);
}

await connectDB();
await Invoice.init();
const db = mongoose.connection.db;

const createCatalog = args['create-catalog'] === 'yes';

async function ensureRecord(collection, doc) {
  const coll = db.collection(collection);
  const existing = await coll.findOne({ name: doc.name });
  if (existing) return existing;
  if (!createCatalog) {
    console.log(`"${doc.name}" not found in ${collection} — using a manual snapshot (pass --create-catalog yes to add it)`);
    return { _id: null, ...doc };
  }
  const { insertedId } = await coll.insertOne({ ...doc, createdAt: new Date(), updatedAt: new Date() });
  console.log(`Added ${collection} record "${doc.name}"`);
  return { _id: insertedId, ...doc };
}
const idOrNull = (id) => (id ? String(id) : null);

const customer = await ensureRecord(process.env.CUSTOMER_COLLECTION || 'customers', { name: customerName, email: '', phone: '', address: '' });
const service = await ensureRecord(process.env.SERVICE_COLLECTION || 'services', {
  name: serviceName,
  description: 'Monthly planning, development, integration, testing and support of the Support Agent system.',
  price: rate,
});

let created = 0;
let skipped = 0;
for (const month of monthRange(from, to)) {
  const tasks = workLog.get(monthKey(month)) || [];
  const hours = tasks.reduce((s, t) => s + t.hours, 0);
  const summary = tasks.length ? ` · ${tasks.length} tasks · ${hours} hours` : '';
  const notes = tasks.length
    ? `Work summary — ${monthLabel(month)}:\n` + tasks.map((t) => `• ${t.description} (${t.hours}h)`).join('\n')
    : '';
  try {
    const inv = await createInvoice(
      {
        customer: { customerId: idOrNull(customer._id), name: customer.name, email: customer.email, phone: customer.phone, address: customer.address },
        services: [
          {
            serviceId: idOrNull(service._id),
            name: service.name,
            description: `Services for ${monthLabel(month)}${summary}`,
            quantity: 1,
            unitPrice: rate,
          },
        ],
        billingMonths: [month],
        taxRate: 0,
        paymentStatus: 'Pending',
        notes,
      },
      { source: 'import' },
    );
    created++;
    console.log(`  ${inv.invoiceNumber}  ${inv.invoiceDate.toISOString().slice(0, 10)}  ${monthLabel(month).padEnd(15)} ${inv.grandTotal}`);
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) {
      skipped++;
      console.log(`  skipped ${monthLabel(month)}: ${err.message}`);
    } else throw err;
  }
}
console.log(`Done. Created ${created}, skipped ${skipped}.`);
await mongoose.disconnect();
