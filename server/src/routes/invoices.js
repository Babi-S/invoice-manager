import { Router } from 'express';
import { Invoice, PAYMENT_STATUSES } from '../models/Invoice.js';
import { getSettings } from '../models/Settings.js';
import { renderInvoicePdf } from '../services/pdf.js';
import {
  bulkGenerate,
  cancelInvoice,
  createInvoice,
  deleteInvoice,
  draftInvoice,
  generateInvoiceNumber,
  updateInvoice,
  updatePayment,
} from '../services/invoiceService.js';
import { escapeRegex, parseObjectId } from '../utils/validate.js';
import { badRequest, notFound } from '../utils/errors.js';

const router = Router();

const intParam = (v, { min, max }) => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`Invalid query parameter value: ${v}`);
  return n;
};
const textParam = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : '');

function sendPdf(res, buffer, filename, download) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': buffer.length,
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  res.end(buffer);
}

// GET /api/invoices?q=&customer=&invoiceNumber=&service=&month=&year=&status=&page=&limit=
router.get('/', async (req, res) => {
  const page = intParam(req.query.page, { min: 1, max: 100000 }) ?? 1;
  const limit = intParam(req.query.limit, { min: 1, max: 100 }) ?? 20;
  const month = intParam(req.query.month, { min: 1, max: 12 });
  const year = intParam(req.query.year, { min: 2000, max: 2100 });
  const status = textParam(req.query.status);
  if (status && !PAYMENT_STATUSES.includes(status)) throw badRequest('Invalid payment status');

  const and = [];
  const rx = (v) => new RegExp(escapeRegex(v), 'i');
  const q = textParam(req.query.q);
  if (q) and.push({ $or: [{ invoiceNumber: rx(q) }, { 'customer.name': rx(q) }, { 'services.name': rx(q) }] });
  if (textParam(req.query.customer)) and.push({ 'customer.name': rx(textParam(req.query.customer)) });
  if (textParam(req.query.invoiceNumber)) and.push({ invoiceNumber: rx(textParam(req.query.invoiceNumber)) });
  if (textParam(req.query.service)) and.push({ 'services.name': rx(textParam(req.query.service)) });
  if (month || year) {
    const em = {};
    if (month) em.month = month;
    if (year) em.year = year;
    and.push({ billingMonths: { $elemMatch: em } });
  }
  if (status) and.push({ paymentStatus: status });
  const filter = and.length ? { $and: and } : {};

  const [total, items] = await Promise.all([
    Invoice.countDocuments(filter),
    Invoice.find(filter, { billingKeys: 0 })
      .sort({ invoiceDate: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

router.get('/next-number', async (_req, res) => {
  res.json({ invoiceNumber: await generateInvoiceNumber() });
});

// Validates and calculates without saving; returns totals + any duplicate-period conflict.
router.post('/validate', async (req, res) => {
  const excludeId = req.query.exclude ? parseObjectId(req.query.exclude, 'invoice id') : undefined;
  const { invoice, conflict } = await draftInvoice(req.body, { excludeId });
  res.json({ invoice, conflict });
});

// Renders the real invoice layout for unsaved data.
router.post('/preview', async (req, res) => {
  const excludeId = req.query.exclude ? parseObjectId(req.query.exclude, 'invoice id') : undefined;
  const { invoice, settings } = await draftInvoice(req.body, { excludeId });
  sendPdf(res, await renderInvoicePdf(invoice, settings, { draft: true }), 'invoice-preview.pdf', false);
});

router.post('/bulk', async (req, res) => {
  const dryRun = req.query.dryRun !== 'false';
  const result = await bulkGenerate(req.body, { dryRun });
  res.status(dryRun ? 200 : 201).json(result);
});

router.post('/', async (req, res) => {
  const invoice = await createInvoice(req.body, { source: 'manual' });
  res.status(201).json(invoice);
});

router.get('/:id', async (req, res) => {
  const invoice = await Invoice.findById(parseObjectId(req.params.id, 'invoice id'), { billingKeys: 0 }).lean();
  if (!invoice) throw notFound('Invoice not found');
  res.json(invoice);
});

// PDF is always generated from the saved invoice document.
router.get('/:id/pdf', async (req, res) => {
  const invoice = await Invoice.findById(parseObjectId(req.params.id, 'invoice id')).lean();
  if (!invoice) throw notFound('Invoice not found');
  const pdf = await renderInvoicePdf(invoice, await getSettings());
  sendPdf(res, pdf, `${invoice.invoiceNumber}.pdf`, req.query.download === '1');
});

router.put('/:id', async (req, res) => {
  res.json(await updateInvoice(req.params.id, req.body));
});

router.patch('/:id/payment', async (req, res) => {
  res.json(await updatePayment(req.params.id, req.body));
});

router.post('/:id/cancel', async (req, res) => {
  res.json(await cancelInvoice(req.params.id));
});

router.delete('/:id', async (req, res) => {
  await deleteInvoice(req.params.id);
  res.status(204).end();
});

export default router;
