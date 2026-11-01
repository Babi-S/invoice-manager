import { randomInt } from 'node:crypto';
import { Invoice } from '../models/Invoice.js';
import { getSettings } from '../models/Settings.js';
import { customersSource, servicesSource } from '../sources/catalog.js';
import { createValidator, parseObjectId } from '../utils/validate.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { computeTotals } from '../../../shared/calc.js';
import { invoiceDateFor, monthKey, monthLabel, monthRange, normalizeMonths } from '../../../shared/billing.js';

const EDITABLE_STATUSES = ['Pending', 'Partially Paid', 'Paid'];
const MAX_NUMBER_ATTEMPTS = 25;

const normKey = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * One key per (customer, service, billing month). Manually entered customers or
 * services (without a source id) are keyed by their normalised name.
 */
export function buildBillingKeys(customer, services, months) {
  const c = customer.customerId ? String(customer.customerId) : `manual:${normKey(customer.name)}`;
  const keys = new Map();
  for (const s of services) {
    const sk = s.serviceId ? String(s.serviceId) : `manual:${normKey(s.name)}`;
    for (const m of months) {
      keys.set(`${c}|${sk}|${monthKey(m)}`, { serviceName: s.name, month: m });
    }
  }
  return keys;
}

/** Validates raw input and produces a fully recalculated invoice document body. */
export async function buildInvoiceData(body, { settings, existing } = {}) {
  if (!body || typeof body !== 'object') throw badRequest('Request body must be an object');
  const v = createValidator();

  const c = body.customer && typeof body.customer === 'object' ? body.customer : {};
  const customer = {
    customerId: v.oid(c.customerId, 'customer.customerId'),
    name: v.str(c.name, 'customer.name', { required: true, max: 200 }),
    email: v.email(c.email, 'customer.email'),
    phone: v.str(c.phone, 'customer.phone', { max: 50 }),
    address: v.str(c.address, 'customer.address', { max: 500 }),
  };

  const services = v.array(body.services, 'services', { min: 1, max: 50 }).map((s, i) => {
    const p = `services[${i}]`;
    s = s && typeof s === 'object' ? s : {};
    return {
      serviceId: v.oid(s.serviceId, `${p}.serviceId`),
      name: v.str(s.name, `${p}.name`, { required: true, max: 200 }),
      description: v.str(s.description, `${p}.description`, { max: 2000 }),
      quantity: v.num(s.quantity, `${p}.quantity`, { positive: true, max: 1e6 }),
      unitPrice: v.num(s.unitPrice, `${p}.unitPrice`, { min: 0, max: 1e9 }),
    };
  });

  const billingMonths = normalizeMonths(
    v.array(body.billingMonths, 'billingMonths', { min: 1, max: 36 }).map((m, i) => ({
      month: v.num(m?.month, `billingMonths[${i}].month`, { min: 1, max: 12, int: true }),
      year: v.num(m?.year, `billingMonths[${i}].year`, { min: 2000, max: 2100, int: true }),
    })),
  );

  const dueDate = v.date(body.dueDate, 'dueDate');
  const discountType = v.oneOf(body.discountType, 'discountType', ['fixed', 'percent'], 'fixed');
  const discountValue =
    v.num(body.discountValue, 'discountValue', { required: false, min: 0, max: discountType === 'percent' ? 100 : 1e9 }) ?? 0;
  const taxRate = v.num(body.taxRate, 'taxRate', { required: false, min: 0, max: 100 }) ?? settings.taxRate ?? 0;
  const paymentStatus = v.oneOf(body.paymentStatus, 'paymentStatus', EDITABLE_STATUSES, 'Pending');
  const amountPaidInput = v.num(body.amountPaid, 'amountPaid', { required: false, min: 0, max: 1e12 });
  const paymentMethod = v.str(body.paymentMethod, 'paymentMethod', { max: 100 });
  const notes = v.str(body.notes, 'notes', { max: 5000 });

  v.throwIfErrors();

  // Referenced records must exist in the source collections (read-only lookups).
  // When editing, references already on the invoice are kept even if the source
  // record was removed later — the snapshot remains the historical truth.
  const keepCustomer = existing?.customer?.customerId && String(existing.customer.customerId) === String(customer.customerId);
  if (customer.customerId && !keepCustomer && !(await customersSource.findById(customer.customerId))) {
    v.fail('customer.customerId', 'was not found in the customers collection');
  }
  const existingServiceIds = new Set((existing?.services || []).map((s) => String(s.serviceId)));
  for (const [i, s] of services.entries()) {
    if (s.serviceId && !existingServiceIds.has(String(s.serviceId)) && !(await servicesSource.findById(s.serviceId))) {
      v.fail(`services[${i}].serviceId`, 'was not found in the services collection');
    }
  }

  const totals = computeTotals({ services, discountType, discountValue, taxRate });
  const invoiceDate = invoiceDateFor(billingMonths);
  if (dueDate && dueDate < invoiceDate) v.fail('dueDate', 'cannot be before the invoice date');

  let amountPaid = 0;
  if (paymentStatus === 'Paid') amountPaid = totals.grandTotal;
  if (paymentStatus === 'Partially Paid') {
    if (amountPaidInput === undefined) v.fail('amountPaid', 'is required for a partially paid invoice');
    else if (amountPaidInput <= 0 || amountPaidInput >= totals.grandTotal)
      v.fail('amountPaid', 'must be greater than 0 and less than the grand total');
    else amountPaid = round2(amountPaidInput);
  }
  v.throwIfErrors();

  const keyInfo = buildBillingKeys(customer, services, billingMonths);
  return {
    data: {
      invoiceDate,
      dueDate,
      customer,
      services: totals.lines,
      billingMonths,
      billingKeys: [...keyInfo.keys()],
      subtotal: totals.subtotal,
      discountType,
      discountValue,
      discount: totals.discount,
      taxRate,
      tax: totals.tax,
      grandTotal: totals.grandTotal,
      amountPaid,
      paymentStatus,
      paymentMethod,
      notes,
    },
    keyInfo,
  };
}

async function findBillingConflict(keyInfo, excludeId) {
  const keys = [...keyInfo.keys()];
  const filter = { billingKeys: { $in: keys } };
  if (excludeId) filter._id = { $ne: excludeId };
  const clash = await Invoice.findOne(filter, { invoiceNumber: 1, billingKeys: 1 }).lean();
  if (!clash) return null;
  const key = clash.billingKeys.find((k) => keyInfo.has(k));
  const { serviceName, month } = keyInfo.get(key);
  return {
    message: `${monthLabel(month)} for "${serviceName}" is already invoiced to this customer on ${clash.invoiceNumber}.`,
    invoiceId: String(clash._id),
    invoiceNumber: clash.invoiceNumber,
  };
}

async function assertNoBillingConflict(keyInfo, excludeId) {
  const clash = await findBillingConflict(keyInfo, excludeId);
  if (clash) throw conflict(clash.message, clash);
}

/** Random INV-XXXXXX that is not used by any existing invoice. */
export async function generateInvoiceNumber() {
  for (let i = 0; i < MAX_NUMBER_ATTEMPTS; i++) {
    const candidate = `INV-${randomInt(100000, 1000000)}`;
    if (!(await Invoice.exists({ invoiceNumber: candidate }))) return candidate;
  }
  throw new Error('Could not generate a unique invoice number');
}

const isDup = (err, field) => err?.code === 11000 && Object.keys(err.keyPattern || {}).includes(field);

/**
 * Inserts with a unique number. The unique index is the final authority: if a
 * concurrent insert takes the same number, a new one is generated and retried.
 */
async function insertWithUniqueNumber(data, proposedNumber, keyInfo) {
  let number =
    /^INV-\d{6}$/.test(proposedNumber || '') && !(await Invoice.exists({ invoiceNumber: proposedNumber }))
      ? proposedNumber
      : await generateInvoiceNumber();

  for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
    try {
      return await Invoice.create({ ...data, invoiceNumber: number });
    } catch (err) {
      if (isDup(err, 'invoiceNumber')) {
        number = await generateInvoiceNumber();
        continue;
      }
      if (isDup(err, 'billingKeys')) {
        const clash = await findBillingConflict(keyInfo);
        throw conflict(clash?.message || 'This customer, service and billing month is already invoiced.', clash);
      }
      throw err;
    }
  }
  throw new Error('Could not generate a unique invoice number');
}

export async function createInvoice(body, { source = 'manual' } = {}) {
  const settings = await getSettings();
  const { data, keyInfo } = await buildInvoiceData(body, { settings });
  await assertNoBillingConflict(keyInfo);
  return insertWithUniqueNumber({ ...data, currency: settings.currency, source }, body.proposedNumber, keyInfo);
}

/** Builds an unsaved invoice for previews (same validation and calculation as saving). */
export async function draftInvoice(body, { excludeId } = {}) {
  const settings = await getSettings();
  const existing = excludeId ? await Invoice.findById(excludeId).lean() : null;
  const { data, keyInfo } = await buildInvoiceData(body, { settings, existing });
  const clash = await findBillingConflict(keyInfo, excludeId);
  return {
    invoice: {
      ...data,
      invoiceNumber: existing?.invoiceNumber || body.proposedNumber || 'INV-DRAFT',
      currency: existing?.currency || settings.currency,
    },
    settings,
    conflict: clash,
  };
}

async function loadInvoice(id) {
  const invoice = await Invoice.findById(parseObjectId(id, 'invoice id'));
  if (!invoice) throw notFound('Invoice not found');
  return invoice;
}

export async function updateInvoice(id, body) {
  const invoice = await loadInvoice(id);
  if (invoice.paymentStatus === 'Cancelled') throw conflict('Cancelled invoices cannot be edited.');

  const settings = await getSettings();
  const { data, keyInfo } = await buildInvoiceData(body, { settings, existing: invoice.toObject() });
  await assertNoBillingConflict(keyInfo, invoice._id);
  invoice.set(data);
  try {
    return await invoice.save();
  } catch (err) {
    if (isDup(err, 'billingKeys')) {
      const clash = await findBillingConflict(keyInfo, invoice._id);
      throw conflict(clash?.message || 'This customer, service and billing month is already invoiced.', clash);
    }
    throw err;
  }
}

export async function updatePayment(id, body = {}) {
  const invoice = await loadInvoice(id);
  if (invoice.paymentStatus === 'Cancelled') throw conflict('Cancelled invoices cannot change payment status.');

  const v = createValidator();
  const status = v.oneOf(body.paymentStatus, 'paymentStatus', EDITABLE_STATUSES, undefined);
  if (!status) v.fail('paymentStatus', 'is required');
  const amount = v.num(body.amountPaid, 'amountPaid', { required: false, min: 0, max: 1e12 });
  const method = body.paymentMethod === undefined ? undefined : v.str(body.paymentMethod, 'paymentMethod', { max: 100 });
  v.throwIfErrors();

  if (status === 'Paid') invoice.amountPaid = invoice.grandTotal;
  if (status === 'Pending') invoice.amountPaid = 0;
  if (status === 'Partially Paid') {
    if (amount === undefined || amount <= 0 || amount >= invoice.grandTotal) {
      throw badRequest('Validation failed', [
        { path: 'amountPaid', message: 'must be greater than 0 and less than the grand total' },
      ]);
    }
    invoice.amountPaid = round2(amount);
  }
  invoice.paymentStatus = status;
  if (method !== undefined) invoice.paymentMethod = method;
  return invoice.save();
}

/** Cancelling keeps the record for history and frees its billing period. */
export async function cancelInvoice(id) {
  const invoice = await loadInvoice(id);
  if (invoice.paymentStatus === 'Cancelled') return invoice;
  await Invoice.updateOne(
    { _id: invoice._id },
    { $set: { paymentStatus: 'Cancelled', cancelledAt: new Date() }, $unset: { billingKeys: 1 } },
  );
  return Invoice.findById(invoice._id);
}

/** Only unpaid, pending invoices may be deleted; anything else must be cancelled. */
export async function deleteInvoice(id) {
  const invoice = await loadInvoice(id);
  if (invoice.paymentStatus !== 'Pending' || invoice.amountPaid > 0) {
    throw conflict('Only pending, unpaid invoices can be deleted. Cancel this invoice instead to keep its record.');
  }
  await invoice.deleteOne();
}

/**
 * One invoice per billing month between `from` and `to` (inclusive). Each is
 * dated the 1st of the following month. Months already invoiced are skipped.
 */
export async function bulkGenerate(body = {}, { dryRun = true } = {}) {
  const v = createValidator();
  const ym = (o, p) => ({
    month: v.num(o?.month, `${p}.month`, { min: 1, max: 12, int: true }),
    year: v.num(o?.year, `${p}.year`, { min: 2000, max: 2100, int: true }),
  });
  const from = ym(body.from, 'from');
  const to = ym(body.to, 'to');
  const dueDays = v.num(body.dueDays, 'dueDays', { required: false, min: 0, max: 365, int: true });
  const status = v.oneOf(body.paymentStatus, 'paymentStatus', ['Pending', 'Paid'], 'Pending');
  v.throwIfErrors();

  const months = monthRange(from, to);
  if (!months.length) throw badRequest('Validation failed', [{ path: 'to', message: 'must be on or after the start month' }]);
  if (months.length > 60) throw badRequest('Validation failed', [{ path: 'to', message: 'range is limited to 60 months' }]);

  const settings = await getSettings();
  const items = [];
  for (const month of months) {
    const invoiceDate = invoiceDateFor([month]);
    const input = {
      customer: body.customer,
      services: body.services,
      billingMonths: [month],
      discountType: body.discountType,
      discountValue: body.discountValue,
      taxRate: body.taxRate,
      paymentStatus: status,
      paymentMethod: body.paymentMethod,
      notes: body.notes,
      dueDate: dueDays != null ? new Date(invoiceDate.getTime() + dueDays * 86_400_000) : undefined,
    };
    const { data, keyInfo } = await buildInvoiceData(input, { settings });
    const clash = await findBillingConflict(keyInfo);
    const item = { billingMonth: month, invoiceDate, grandTotal: data.grandTotal };

    if (clash) items.push({ ...item, status: 'exists', invoiceNumber: clash.invoiceNumber, invoiceId: clash.invoiceId });
    else if (dryRun) items.push({ ...item, status: 'new' });
    else {
      const created = await insertWithUniqueNumber({ ...data, currency: settings.currency, source: 'bulk' }, null, keyInfo);
      items.push({ ...item, status: 'created', invoiceNumber: created.invoiceNumber, invoiceId: String(created._id) });
    }
  }

  const fresh = items.filter((i) => i.status !== 'exists');
  return {
    dryRun,
    currency: settings.currency,
    items,
    summary: {
      months: items.length,
      toCreate: fresh.length,
      skipped: items.length - fresh.length,
      total: round2(fresh.reduce((s, i) => s + i.grandTotal, 0)),
    },
  };
}
