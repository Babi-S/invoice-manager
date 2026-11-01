import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useDebounced } from '../lib/useAsync.js';
import { Card, ErrorBanner, Field, Modal, PageHeader, PageLoader, Spinner } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import { SearchSelect } from '../components/SearchSelect.jsx';
import { MonthPicker } from '../components/MonthPicker.jsx';
import { useToast } from '../components/feedback.jsx';
import { computeTotals } from '@shared/calc.js';
import { billingYears, formatBillingPeriod, invoiceDateFor, normalizeMonths } from '@shared/billing.js';
import { formatDate, formatMoney, toDateInput } from '@shared/format.js';

let lineSeq = 0;
const newLine = (over = {}) => ({ key: ++lineSeq, serviceId: null, name: '', description: '', quantity: '1', unitPrice: '', ...over });
const emptyCustomer = { customerId: null, name: '', email: '', phone: '', address: '' };

function nextMonth(months) {
  const last = normalizeMonths(months).at(-1);
  if (!last) return [];
  return [last.month === 12 ? { month: 1, year: last.year + 1 } : { month: last.month + 1, year: last.year }];
}

function fromInvoice(inv, { duplicate }) {
  return {
    proposedNumber: duplicate ? '' : inv.invoiceNumber,
    customer: { ...emptyCustomer, ...inv.customer, customerId: inv.customer.customerId || null },
    customerMode: inv.customer.customerId ? 'linked' : 'manual',
    services: inv.services.map((s) =>
      newLine({ serviceId: s.serviceId || null, name: s.name, description: s.description || '', quantity: String(s.quantity), unitPrice: String(s.unitPrice) }),
    ),
    billingMonths: duplicate ? nextMonth(inv.billingMonths) : inv.billingMonths,
    dueDate: duplicate ? '' : toDateInput(inv.dueDate),
    discountType: inv.discountType || 'fixed',
    discountValue: inv.discountValue ? String(inv.discountValue) : '',
    taxRate: String(inv.taxRate ?? ''),
    paymentStatus: duplicate ? 'Pending' : inv.paymentStatus,
    amountPaid: !duplicate && inv.paymentStatus === 'Partially Paid' ? String(inv.amountPaid) : '',
    paymentMethod: inv.paymentMethod || '',
    notes: inv.notes || '',
  };
}

function toPayload(f) {
  return {
    proposedNumber: f.proposedNumber || undefined,
    customer: f.customer,
    services: f.services.map(({ key, ...s }) => s),
    billingMonths: f.billingMonths,
    dueDate: f.dueDate || null,
    discountType: f.discountType,
    discountValue: f.discountValue || 0,
    taxRate: f.taxRate === '' ? 0 : f.taxRate,
    paymentStatus: f.paymentStatus,
    amountPaid: f.paymentStatus === 'Partially Paid' ? f.amountPaid : undefined,
    paymentMethod: f.paymentMethod,
    notes: f.notes,
  };
}

const show = (v) => v !== undefined && v !== null && v !== '';

export function InvoiceForm() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const duplicateOf = search.get('from');
  const navigate = useNavigate();
  const toast = useToast();
  const isEdit = Boolean(id);

  const [form, setForm] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null);
  const previewUrl = useRef(null);

  useEffect(() => {
    let stale = false;
    (async () => {
      try {
        const [s, source, next] = await Promise.all([
          api.settings(),
          id || duplicateOf ? api.invoice(id || duplicateOf) : null,
          isEdit ? null : api.nextNumber(),
        ]);
        if (stale) return;
        setSettings(s);
        if (source) {
          if (isEdit && source.paymentStatus === 'Cancelled') throw new Error('Cancelled invoices cannot be edited.');
          const f = fromInvoice(source, { duplicate: !isEdit });
          if (!isEdit) f.proposedNumber = next.invoiceNumber;
          setForm(f);
        } else {
          setForm({
            proposedNumber: next.invoiceNumber,
            customer: emptyCustomer,
            customerMode: 'search',
            services: [],
            billingMonths: [],
            dueDate: '',
            discountType: 'fixed',
            discountValue: '',
            taxRate: String(s.taxRate ?? 0),
            paymentStatus: 'Pending',
            amountPaid: '',
            paymentMethod: '',
            notes: '',
          });
        }
      } catch (e) {
        if (!stale) setLoadError(e);
      }
    })();
    return () => {
      stale = true;
    };
  }, [id, duplicateOf, isEdit]);

  useEffect(() => () => previewUrl.current && URL.revokeObjectURL(previewUrl.current), []);

  const update = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setCustomer = (patch) => setForm((f) => ({ ...f, customer: { ...f.customer, ...patch } }));
  const setLine = (key, patch) => setForm((f) => ({ ...f, services: f.services.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  const fetchCustomers = useCallback((q) => api.customers({ q, limit: 20 }), []);
  const fetchServices = useCallback((q) => api.services({ q, limit: 20 }), []);

  const fieldErrors = useMemo(() => Object.fromEntries((error?.details || []).map((d) => [d.path, d.message])), [error]);
  const fe = (path) => fieldErrors[path];

  const currency = settings?.currency || 'USD';
  const money = (v) => formatMoney(v, currency);
  const totals = form ? computeTotals({ ...form, services: form.services, taxRate: form.taxRate }) : null;
  const invoiceDate = form ? invoiceDateFor(form.billingMonths) : null;

  // Live duplicate-period check against existing invoices.
  const checkKey = useDebounced(
    form ? JSON.stringify([form.customer.customerId, form.customer.name, form.services.map((s) => [s.serviceId, s.name]), form.billingMonths]) : '',
    450,
  );
  useEffect(() => {
    if (!form || !form.customer.name || !form.services.some((s) => s.name) || !form.billingMonths.length) {
      setConflict(null);
      return;
    }
    let stale = false;
    api
      .validateInvoice({ ...toPayload(form), services: form.services.map(({ key, ...s }) => ({ ...s, quantity: s.quantity || 1, unitPrice: s.unitPrice || 0 })) }, id)
      .then((r) => !stale && setConflict(r.conflict))
      .catch(() => !stale && setConflict(null));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);

  if (loadError) return <ErrorBanner error={loadError} />;
  if (!form) return <PageLoader />;

  const openPreview = async () => {
    setBusy('preview');
    setError(null);
    try {
      const blob = await api.previewPdf(toPayload(form), id);
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = URL.createObjectURL(blob);
      setPreview(previewUrl.current);
    } catch (e) {
      setError(e);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      const saved = isEdit ? await api.updateInvoice(id, toPayload(form)) : await api.createInvoice(toPayload(form));
      toast(isEdit ? `${saved.invoiceNumber} updated` : `${saved.invoiceNumber} created`);
      navigate(`/invoices/${saved._id}`);
    } catch (e) {
      setPreview(null);
      setError(e);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(null);
    }
  };

  const linked = form.customerMode === 'linked';

  return (
    <>
      <PageHeader
        back={
          <Link to={isEdit ? `/invoices/${id}` : '/invoices'} className="back-link">
            <Icon name="arrowLeft" size={14} /> {isEdit ? 'Back to invoice' : 'All invoices'}
          </Link>
        }
        title={isEdit ? `Edit ${form.proposedNumber}` : duplicateOf ? 'Duplicate invoice' : 'Create invoice'}
        subtitle={isEdit ? 'Changes recalculate totals; the invoice number never changes.' : 'Select a customer, add services and choose the billing month(s).'}
      />
      <ErrorBanner error={error && !error.details ? error : error?.details ? { message: 'Please fix the highlighted fields.', details: error.details } : null} />

      <div className="form-layout">
        <div className="form-main">
          {/* A. Invoice details */}
          <Card title="Invoice details">
            <div className="grid-3">
              <Field label="Invoice number" hint={isEdit ? 'Fixed' : 'Auto-generated, checked for uniqueness on save'}>
                <input className="input mono" value={form.proposedNumber} readOnly />
              </Field>
              <Field label="Invoice date" hint="1st of the month after the billing period">
                <input className="input" value={invoiceDate ? formatDate(invoiceDate) : 'Select billing month(s)'} readOnly />
              </Field>
              <Field label="Due date (optional)" error={fe('dueDate')}>
                <input className="input" type="date" value={form.dueDate} min={invoiceDate ? toDateInput(invoiceDate) : undefined} onChange={(e) => update({ dueDate: e.target.value })} />
              </Field>
            </div>
          </Card>

          {/* B. Customer */}
          <Card
            title="Customer"
            actions={
              form.customerMode !== 'search' && (
                <button className="btn btn-sm btn-ghost" onClick={() => update({ customerMode: 'search', customer: emptyCustomer })}>
                  Change customer
                </button>
              )
            }
          >
            {form.customerMode === 'search' ? (
              <div className="stack">
                <SearchSelect
                  fetchItems={fetchCustomers}
                  placeholder="Search customers by name or email…"
                  emptyText="No customers match"
                  onSelect={(c) =>
                    update({
                      customerMode: 'linked',
                      customer: { customerId: c._id, name: c.name, email: c.email || '', phone: c.phone || '', address: c.address || '' },
                    })
                  }
                  renderItem={(c) => (
                    <div>
                      <div className="ss-title">{c.name}</div>
                      <div className="ss-sub">{[c.email, c.phone].filter(show).join(' · ') || <span className="mono">{c._id}</span>}</div>
                    </div>
                  )}
                />
                {fe('customer.name') && <span className="field-error">Customer is required</span>}
                <div className="muted small">
                  Not in the database?{' '}
                  <button className="link-btn" onClick={() => update({ customerMode: 'manual', customer: emptyCustomer })}>
                    Enter customer manually
                  </button>{' '}
                  (only saved on this invoice).
                </div>
              </div>
            ) : (
              <div className="stack">
                {linked ? (
                  <div className="linked-note">
                    <Icon name="database" size={14} /> Linked to customer <span className="mono">{form.customer.customerId}</span> — details below are saved as
                    a snapshot on the invoice.
                  </div>
                ) : (
                  <div className="linked-note">
                    <Icon name="edit" size={14} /> Manual customer — stored on this invoice only.
                  </div>
                )}
                <div className="grid-2">
                  <Field label="Name" error={fe('customer.name')}>
                    <input className="input" value={form.customer.name} onChange={(e) => setCustomer({ name: e.target.value })} autoFocus={!linked} />
                  </Field>
                  <Field label="Email" error={fe('customer.email')}>
                    <input className="input" value={form.customer.email} onChange={(e) => setCustomer({ email: e.target.value })} />
                  </Field>
                  <Field label="Phone" error={fe('customer.phone')}>
                    <input className="input" value={form.customer.phone} onChange={(e) => setCustomer({ phone: e.target.value })} />
                  </Field>
                  <Field label="Address" error={fe('customer.address')}>
                    <input className="input" value={form.customer.address} onChange={(e) => setCustomer({ address: e.target.value })} />
                  </Field>
                </div>
              </div>
            )}
          </Card>

          {/* C. Services */}
          <Card
            title="Services"
            actions={
              <button className="btn btn-sm" onClick={() => update({ services: [...form.services, newLine()] })}>
                <Icon name="plus" /> Manual line
              </button>
            }
          >
            <div className="stack">
              <SearchSelect
                fetchItems={fetchServices}
                placeholder="Search services to add…"
                emptyText="No services match"
                onSelect={(s) =>
                  update({
                    services: [
                      ...form.services,
                      newLine({ serviceId: s._id, name: s.name, description: s.description || '', unitPrice: s.price != null ? String(s.price) : '' }),
                    ],
                  })
                }
                renderItem={(s) => (
                  <div className="ss-row">
                    <div>
                      <div className="ss-title">{s.name}</div>
                      {show(s.description) && <div className="ss-sub truncate">{s.description}</div>}
                    </div>
                    <span className="ss-price">{s.price != null ? money(s.price) : 'No price'}</span>
                  </div>
                )}
              />
              {fe('services') && <span className="field-error">Add at least one service</span>}
              {form.services.length > 0 && (
                <div className="lines">
                  <div className="line line-head">
                    <span>Service</span>
                    <span className="num">Qty</span>
                    <span className="num">Unit price</span>
                    <span className="num">Amount</span>
                    <span />
                  </div>
                  {form.services.map((l, i) => {
                    const total = totals.lines[i]?.total || 0;
                    return (
                      <div className="line" key={l.key}>
                        <div className="stack-xs">
                          <input className={`input ${fe(`services[${i}].name`) ? 'is-invalid' : ''}`} placeholder="Service name" value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} />
                          <textarea className="input" rows={1} placeholder="Description (optional)" value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} />
                          {l.serviceId && <span className="muted tiny">From database · {l.serviceId}</span>}
                        </div>
                        <input className={`input num ${fe(`services[${i}].quantity`) ? 'is-invalid' : ''}`} type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} title={fe(`services[${i}].quantity`)} />
                        <input className={`input num ${fe(`services[${i}].unitPrice`) ? 'is-invalid' : ''}`} type="number" min="0" step="0.01" placeholder="Enter price" value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} title={fe(`services[${i}].unitPrice`)} />
                        <span className="num line-total">{money(total)}</span>
                        <button className="icon-btn" onClick={() => update({ services: form.services.filter((x) => x.key !== l.key) })} aria-label="Remove line">
                          <Icon name="trash" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          {/* D. Billing period */}
          <Card title="Billing period">
            <MonthPicker value={form.billingMonths} onChange={(billingMonths) => update({ billingMonths })} error={fe('billingMonths')} />
            {conflict && (
              <div className="banner banner-warn">
                <Icon name="alert" />
                <div className="banner-body">
                  {conflict.message}{' '}
                  <Link to={`/invoices/${conflict.invoiceId}`} className="link">
                    Open {conflict.invoiceNumber}
                  </Link>
                </div>
              </div>
            )}
          </Card>

          {/* E. Pricing */}
          <Card title="Discount & tax">
            <div className="grid-3">
              <Field label="Discount type">
                <select className="input" value={form.discountType} onChange={(e) => update({ discountType: e.target.value })}>
                  <option value="fixed">Fixed amount ({currency})</option>
                  <option value="percent">Percentage (%)</option>
                </select>
              </Field>
              <Field label="Discount (optional)" error={fe('discountValue')}>
                <input className="input" type="number" min="0" step="0.01" value={form.discountValue} placeholder="0" onChange={(e) => update({ discountValue: e.target.value })} />
              </Field>
              <Field label="Tax rate % (optional)" error={fe('taxRate')}>
                <input className="input" type="number" min="0" max="100" step="0.01" value={form.taxRate} onChange={(e) => update({ taxRate: e.target.value })} />
              </Field>
            </div>
          </Card>

          {/* F. Additional information */}
          <Card title="Payment & notes">
            <div className="grid-3">
              <Field label="Payment status" error={fe('paymentStatus')}>
                <select className="input" value={form.paymentStatus} onChange={(e) => update({ paymentStatus: e.target.value })}>
                  <option>Pending</option>
                  <option>Partially Paid</option>
                  <option>Paid</option>
                </select>
              </Field>
              {form.paymentStatus === 'Partially Paid' && (
                <Field label="Amount paid" error={fe('amountPaid')}>
                  <input className="input" type="number" min="0" step="0.01" value={form.amountPaid} onChange={(e) => update({ amountPaid: e.target.value })} />
                </Field>
              )}
              <Field label="Payment method (optional)">
                <input className="input" value={form.paymentMethod} placeholder="Bank transfer, card…" onChange={(e) => update({ paymentMethod: e.target.value })} />
              </Field>
            </div>
            <Field label="Notes (optional)" error={fe('notes')}>
              <textarea className="input" rows={4} value={form.notes} onChange={(e) => update({ notes: e.target.value })} />
            </Field>
          </Card>
        </div>

        <aside className="form-side">
          <div className="summary card">
            <div className="summary-head">
              <div className="muted small">Invoice</div>
              <div className="mono summary-number">{form.proposedNumber}</div>
            </div>
            <dl className="summary-list">
              <div>
                <dt>Customer</dt>
                <dd>{form.customer.name || '—'}</dd>
              </div>
              <div>
                <dt>Billing period</dt>
                <dd>{formatBillingPeriod(form.billingMonths)}</dd>
              </div>
              <div>
                <dt>Billing year</dt>
                <dd>{billingYears(form.billingMonths).join(', ') || '—'}</dd>
              </div>
              <div>
                <dt>Invoice date</dt>
                <dd>{invoiceDate ? formatDate(invoiceDate) : '—'}</dd>
              </div>
            </dl>
            <dl className="summary-totals">
              <div>
                <dt>Subtotal</dt>
                <dd>{money(totals.subtotal)}</dd>
              </div>
              {totals.discount > 0 && (
                <div>
                  <dt>Discount{form.discountType === 'percent' ? ` (${form.discountValue}%)` : ''}</dt>
                  <dd>− {money(totals.discount)}</dd>
                </div>
              )}
              <div>
                <dt>Tax ({Number(form.taxRate) || 0}%)</dt>
                <dd>{money(totals.tax)}</dd>
              </div>
              <div className="summary-grand">
                <dt>Grand total</dt>
                <dd>{money(totals.grandTotal)}</dd>
              </div>
            </dl>
            <div className="stack-sm">
              <button className="btn btn-primary btn-block" onClick={openPreview} disabled={!!busy}>
                {busy === 'preview' ? <Spinner size={14} /> : <Icon name="eye" />} Preview invoice
              </button>
              <button className="btn btn-block" onClick={save} disabled={!!busy || !!conflict}>
                {busy === 'save' ? <Spinner size={14} /> : <Icon name="check" />} {isEdit ? 'Save changes' : 'Generate & save'}
              </button>
              <p className="muted tiny center">Totals are recalculated by the server when saving.</p>
            </div>
          </div>
        </aside>
      </div>

      {preview && (
        <Modal
          title="Invoice preview"
          onClose={() => setPreview(null)}
          width={920}
          footer={
            <>
              <button className="btn" onClick={() => setPreview(null)}>
                <Icon name="edit" /> Back to edit
              </button>
              <button className="btn btn-primary" onClick={save} disabled={busy === 'save' || !!conflict}>
                {busy === 'save' ? 'Saving…' : isEdit ? 'Save changes' : 'Generate & save invoice'}
              </button>
            </>
          }
        >
          {conflict && <ErrorBanner error={conflict.message} />}
          <iframe className="pdf-frame" src={`${preview}#toolbar=0&navpanes=0`} title="Invoice preview" />
        </Modal>
      )}
    </>
  );
}
