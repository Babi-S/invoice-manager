import mongoose from 'mongoose';

const { Schema } = mongoose;

export const PAYMENT_STATUSES = ['Pending', 'Partially Paid', 'Paid', 'Cancelled'];

const money = { type: Number, required: true, min: 0 };

// Customer and service details are stored as snapshots alongside their source
// ids, so an issued invoice never changes when the source record changes.
const CustomerSnapshot = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, default: null },
    name: { type: String, required: true, trim: true },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    address: { type: String, default: '' },
  },
  { _id: false },
);

const ServiceLine = new Schema(
  {
    serviceId: { type: Schema.Types.ObjectId, default: null },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: money,
    total: money,
  },
  { _id: false },
);

const BillingMonth = new Schema(
  {
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true, min: 2000, max: 2100 },
  },
  { _id: false },
);

const InvoiceSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true, match: /^INV-\d{6}$/ },
    invoiceDate: { type: Date, required: true },
    dueDate: { type: Date, default: null },
    customer: { type: CustomerSnapshot, required: true },
    services: { type: [ServiceLine], validate: (v) => v.length > 0 },
    billingMonths: { type: [BillingMonth], validate: (v) => v.length > 0 },
    // "<customer>|<service>|<yyyy-mm>" — one per service × billing month. A unique
    // multikey index guarantees the same customer/service/month is never billed
    // twice. Removed when an invoice is cancelled so the period can be re-issued.
    billingKeys: { type: [String], default: undefined },
    currency: { type: String, required: true, default: 'USD' },
    subtotal: money,
    discountType: { type: String, enum: ['fixed', 'percent'], default: 'fixed' },
    discountValue: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    taxRate: { type: Number, default: 0, min: 0, max: 100 },
    tax: { type: Number, default: 0, min: 0 },
    grandTotal: money,
    amountPaid: { type: Number, default: 0, min: 0 },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'Pending' },
    paymentMethod: { type: String, default: '' },
    notes: { type: String, default: '' },
    source: { type: String, enum: ['manual', 'bulk', 'import'], default: 'manual' },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'invoices' },
);

InvoiceSchema.index({ invoiceNumber: 1 }, { unique: true });
InvoiceSchema.index(
  { billingKeys: 1 },
  { unique: true, partialFilterExpression: { billingKeys: { $exists: true } } },
);
InvoiceSchema.index({ invoiceDate: -1 });
InvoiceSchema.index({ paymentStatus: 1 });
InvoiceSchema.index({ 'customer.customerId': 1 });

export const Invoice = mongoose.model('Invoice', InvoiceSchema);
