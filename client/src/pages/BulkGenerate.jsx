import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Card, ErrorBanner, Field, PageHeader, Spinner } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import { SearchSelect } from '../components/SearchSelect.jsx';
import { yearOptions } from '../components/MonthPicker.jsx';
import { useConfirm, useToast } from '../components/feedback.jsx';
import { MONTHS, invoiceDateFor, monthLabel } from '@shared/billing.js';
import { formatDate, formatMoney } from '@shared/format.js';

function MonthYear({ label, value, onChange }) {
  return (
    <Field label={label}>
      <div className="row gap-sm">
        <select className="input" value={value.month} onChange={(e) => onChange({ ...value, month: Number(e.target.value) })}>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select className="input" value={value.year} onChange={(e) => onChange({ ...value, year: Number(e.target.value) })}>
          {yearOptions().map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
      </div>
    </Field>
  );
}

export function BulkGenerate() {
  const toast = useToast();
  const confirm = useConfirm();
  const year = new Date().getFullYear();
  const [customer, setCustomer] = useState(null);
  const [service, setService] = useState(null);
  const [manualCustomer, setManualCustomer] = useState('');
  const [manualService, setManualService] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [from, setFrom] = useState({ month: 1, year });
  const [to, setTo] = useState({ month: 12, year });
  const [taxRate, setTaxRate] = useState('0');
  const [dueDays, setDueDays] = useState('');
  const [status, setStatus] = useState('Pending');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const fetchCustomers = useCallback((q) => api.customers({ q, limit: 20 }), []);
  const fetchServices = useCallback((q) => api.services({ q, limit: 20 }), []);

  const body = () => ({
    customer: customer
      ? { customerId: customer._id, name: customer.name, email: customer.email || '', phone: customer.phone || '', address: customer.address || '' }
      : { name: manualCustomer },
    services: [
      {
        serviceId: service?._id || null,
        name: service ? service.name : manualService,
        description: service?.description || '',
        quantity: 1,
        unitPrice,
      },
    ],
    from,
    to,
    taxRate,
    dueDays: dueDays || undefined,
    paymentStatus: status,
  });

  const run = async (dryRun) => {
    if (!dryRun) {
      const ok = await confirm({
        title: `Generate ${result.summary.toCreate} invoices?`,
        message: `This creates ${result.summary.toCreate} invoices totalling ${formatMoney(result.summary.total, result.currency)}. Months already invoiced are skipped.`,
        confirmLabel: 'Generate invoices',
      });
      if (!ok) return;
    }
    setBusy(dryRun ? 'preview' : 'run');
    setError(null);
    try {
      const r = await api.bulk(body(), dryRun);
      setResult(r);
      if (!dryRun) toast(`Created ${r.items.filter((i) => i.status === 'created').length} invoices`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const reset = () => setResult(null);

  return (
    <>
      <PageHeader
        title="Bulk generate monthly invoices"
        subtitle="One invoice per billing month. Each is dated the 1st of the following month (e.g. February 2025 → 01 Mar 2025)."
      />
      <ErrorBanner error={error} />
      <div className="form-layout">
        <div className="form-main">
          <Card title="Customer & service">
            <div className="grid-2">
              <Field label="Customer">
                {customer ? (
                  <div className="picked">
                    <span>{customer.name}</span>
                    <button className="link-btn" onClick={() => (setCustomer(null), reset())}>
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <SearchSelect
                      fetchItems={fetchCustomers}
                      placeholder="Search customers…"
                      onSelect={(c) => (setCustomer(c), reset())}
                      renderItem={(c) => (
                        <div>
                          <div className="ss-title">{c.name}</div>
                          {c.email && <div className="ss-sub">{c.email}</div>}
                        </div>
                      )}
                    />
                    <input className="input mt-xs" placeholder="…or type a customer name manually" value={manualCustomer} onChange={(e) => (setManualCustomer(e.target.value), reset())} />
                  </>
                )}
              </Field>
              <Field label="Service">
                {service ? (
                  <div className="picked">
                    <span>{service.name}</span>
                    <button className="link-btn" onClick={() => (setService(null), reset())}>
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <SearchSelect
                      fetchItems={fetchServices}
                      placeholder="Search services…"
                      onSelect={(s) => {
                        setService(s);
                        if (s.price != null) setUnitPrice(String(s.price));
                        reset();
                      }}
                      renderItem={(s) => (
                        <div className="ss-row">
                          <span className="ss-title">{s.name}</span>
                          <span className="ss-price">{s.price != null ? formatMoney(s.price) : 'No price'}</span>
                        </div>
                      )}
                    />
                    <input className="input mt-xs" placeholder="…or type a service name manually" value={manualService} onChange={(e) => (setManualService(e.target.value), reset())} />
                  </>
                )}
              </Field>
            </div>
          </Card>
          <Card title="Billing period & amount">
            <div className="grid-2">
              <MonthYear label="First billing month" value={from} onChange={(v) => (setFrom(v), reset())} />
              <MonthYear label="Last billing month" value={to} onChange={(v) => (setTo(v), reset())} />
            </div>
            <div className="grid-3">
              <Field label="Monthly amount">
                <input className="input" type="number" min="0" step="0.01" value={unitPrice} onChange={(e) => (setUnitPrice(e.target.value), reset())} />
              </Field>
              <Field label="Tax rate %">
                <input className="input" type="number" min="0" max="100" value={taxRate} onChange={(e) => (setTaxRate(e.target.value), reset())} />
              </Field>
              <Field label="Due after (days, optional)">
                <input className="input" type="number" min="0" max="365" value={dueDays} onChange={(e) => (setDueDays(e.target.value), reset())} />
              </Field>
              <Field label="Payment status">
                <select className="input" value={status} onChange={(e) => (setStatus(e.target.value), reset())}>
                  <option>Pending</option>
                  <option>Paid</option>
                </select>
              </Field>
            </div>
            <p className="muted small">
              Invoices are dated {formatDate(invoiceDateFor([from]))} through{' '}
              {formatDate(invoiceDateFor([to]))}.
            </p>
          </Card>
        </div>
        <aside className="form-side">
          <div className="card summary">
            {!result ? (
              <>
                <p className="muted small">Preview the invoices before anything is created.</p>
                <button className="btn btn-primary btn-block" onClick={() => run(true)} disabled={!!busy}>
                  {busy === 'preview' ? <Spinner size={14} /> : <Icon name="eye" />} Preview invoices
                </button>
              </>
            ) : (
              <>
                <dl className="summary-totals">
                  <div>
                    <dt>Billing months</dt>
                    <dd>{result.summary.months}</dd>
                  </div>
                  <div>
                    <dt>Already invoiced (skipped)</dt>
                    <dd>{result.summary.skipped}</dd>
                  </div>
                  <div>
                    <dt>{result.dryRun ? 'To create' : 'Created'}</dt>
                    <dd>{result.dryRun ? result.summary.toCreate : result.items.filter((i) => i.status === 'created').length}</dd>
                  </div>
                  <div className="summary-grand">
                    <dt>Total value</dt>
                    <dd>{formatMoney(result.summary.total, result.currency)}</dd>
                  </div>
                </dl>
                {result.dryRun ? (
                  <button className="btn btn-primary btn-block" onClick={() => run(false)} disabled={!!busy || result.summary.toCreate === 0}>
                    {busy === 'run' ? <Spinner size={14} /> : <Icon name="layers" />} Generate {result.summary.toCreate} invoices
                  </button>
                ) : (
                  <Link className="btn btn-primary btn-block" to="/invoices">
                    View all invoices
                  </Link>
                )}
              </>
            )}
          </div>
        </aside>
      </div>

      {result && (
        <Card title={result.dryRun ? 'Preview' : 'Result'} pad={false}>
          <table className="table table-compact">
            <thead>
              <tr>
                <th>#</th>
                <th>Invoice date</th>
                <th>Billing period</th>
                <th className="num">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((it, i) => (
                <tr key={i}>
                  <td className="muted">{i + 1}</td>
                  <td>{formatDate(it.invoiceDate)}</td>
                  <td>{monthLabel(it.billingMonth)}</td>
                  <td className="num">{formatMoney(it.grandTotal, result.currency)}</td>
                  <td>
                    {it.status === 'new' && <span className="badge badge-partial">Will be created</span>}
                    {it.status === 'created' && (
                      <Link to={`/invoices/${it.invoiceId}`} className="badge badge-paid">
                        Created {it.invoiceNumber}
                      </Link>
                    )}
                    {it.status === 'exists' && (
                      <Link to={`/invoices/${it.invoiceId}`} className="badge badge-cancelled">
                        Exists · {it.invoiceNumber}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
