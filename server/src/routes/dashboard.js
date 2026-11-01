import { Router } from 'express';
import { Invoice } from '../models/Invoice.js';
import { getSettings } from '../models/Settings.js';
import { badRequest } from '../utils/errors.js';

const router = Router();
const round2 = (n) => Math.round((n || 0) * 100) / 100;

router.get('/', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('Invalid year');

  const active = { paymentStatus: { $ne: 'Cancelled' } };
  const [totalsAgg, monthlyAgg, recent, yearsAgg, settings] = await Promise.all([
    Invoice.aggregate([
      { $match: active },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          amount: { $sum: '$grandTotal' },
          paid: { $sum: '$amountPaid' },
          paidCount: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'Paid'] }, 1, 0] } },
          pendingCount: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'Pending'] }, 1, 0] } },
          partialCount: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'Partially Paid'] }, 1, 0] } },
        },
      },
    ]),
    // Grouped by invoice date (the 1st of the month after the billing period).
    Invoice.aggregate([
      { $match: { ...active, invoiceDate: { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) } } },
      {
        $group: {
          _id: { $month: '$invoiceDate' },
          count: { $sum: 1 },
          amount: { $sum: '$grandTotal' },
          paid: { $sum: '$amountPaid' },
        },
      },
    ]),
    Invoice.find({}, { billingKeys: 0 }).sort({ createdAt: -1 }).limit(8).lean(),
    Invoice.aggregate([{ $group: { _id: { $year: '$invoiceDate' } } }, { $sort: { _id: 1 } }]),
    getSettings(),
  ]);

  const t = totalsAgg[0] || {};
  const byMonth = new Map(monthlyAgg.map((m) => [m._id, m]));
  res.json({
    currency: settings.currency,
    stats: {
      totalInvoices: t.count || 0,
      totalAmount: round2(t.amount),
      paidAmount: round2(t.paid),
      pendingAmount: round2((t.amount || 0) - (t.paid || 0)),
      paidInvoices: t.paidCount || 0,
      pendingInvoices: (t.pendingCount || 0) + (t.partialCount || 0),
      partiallyPaidInvoices: t.partialCount || 0,
    },
    monthly: {
      year,
      years: yearsAgg.map((y) => y._id).filter(Boolean),
      months: Array.from({ length: 12 }, (_, i) => {
        const m = byMonth.get(i + 1) || {};
        return { month: i + 1, count: m.count || 0, amount: round2(m.amount), paid: round2(m.paid) };
      }),
    },
    recent,
  });
});

export default router;
