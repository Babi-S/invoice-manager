import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync, useDebounced } from '../lib/useAsync.js';
import { EmptyState, ErrorBanner, PageHeader, Pagination, Spinner, StatusBadge } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import { InvoiceActions } from '../components/InvoiceActions.jsx';
import { yearOptions } from '../components/MonthPicker.jsx';
import { formatDate, formatMoney } from '@shared/format.js';
import { formatBillingPeriod, MONTHS } from '@shared/billing.js';

const FILTERS = ['invoiceNumber', 'customer', 'service', 'month', 'year', 'status'];

export function InvoiceList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(() => Object.fromEntries(FILTERS.map((k) => [k, params.get(k) || ''])));
  const page = Number(params.get('page')) || 1;
  const filters = useDebounced(draft, 300);

  const { data, error, loading, reload } = useAsync(
    () => api.invoices({ ...filters, page, limit: 20 }),
    [JSON.stringify(filters), page],
  );

  const set = (key, value) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v)), { replace: true });
  };
  const clear = () => {
    setDraft(Object.fromEntries(FILTERS.map((k) => [k, ''])));
    setParams({}, { replace: true });
  };
  const hasFilters = Object.values(draft).some(Boolean);

  return (
    <>
      <PageHeader
        title="All invoices"
        subtitle={data ? `${data.total} invoice${data.total === 1 ? '' : 's'}${hasFilters ? ' matching filters' : ''}` : ' '}
        actions={
          <button className="btn btn-primary" onClick={() => navigate('/invoices/new')}>
            <Icon name="plus" /> Create Invoice
          </button>
        }
      />

      <div className="filters">
        <div className="input-icon">
          <Icon name="search" />
          <input className="input" placeholder="Invoice number" value={draft.invoiceNumber} onChange={(e) => set('invoiceNumber', e.target.value)} />
        </div>
        <input className="input" placeholder="Customer" value={draft.customer} onChange={(e) => set('customer', e.target.value)} />
        <input className="input" placeholder="Service" value={draft.service} onChange={(e) => set('service', e.target.value)} />
        <select className="input" value={draft.month} onChange={(e) => set('month', e.target.value)} aria-label="Billing month">
          <option value="">Any billing month</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select className="input" value={draft.year} onChange={(e) => set('year', e.target.value)} aria-label="Billing year">
          <option value="">Any year</option>
          {yearOptions().map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
        <select className="input" value={draft.status} onChange={(e) => set('status', e.target.value)} aria-label="Payment status">
          <option value="">Any status</option>
          {['Pending', 'Partially Paid', 'Paid', 'Cancelled'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        {hasFilters && (
          <button className="btn btn-ghost" onClick={clear}>
            Clear
          </button>
        )}
      </div>

      <ErrorBanner error={error} onRetry={reload} />

      <div className="card">
        {loading && !data ? (
          <div className="page-loader">
            <Spinner label="Loading invoices…" />
          </div>
        ) : data?.items.length === 0 ? (
          hasFilters ? (
            <EmptyState icon="search" title="No invoices match these filters" action={<button className="btn" onClick={clear}>Clear filters</button>} />
          ) : (
            <EmptyState
              title="No invoices yet"
              action={
                <button className="btn btn-primary" onClick={() => navigate('/invoices/new')}>
                  Create Invoice
                </button>
              }
            />
          )
        ) : (
          data && (
            <div className={`table-wrap ${loading ? 'is-loading' : ''}`}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Service</th>
                    <th>Billing month(s)</th>
                    <th>Invoice date</th>
                    <th className="num">Total</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((inv) => (
                    <tr key={inv._id}>
                      <td className="mono clickable" onClick={() => navigate(`/invoices/${inv._id}`)}>
                        {inv.invoiceNumber}
                      </td>
                      <td>{inv.customer.name}</td>
                      <td className="truncate" title={inv.services.map((s) => s.name).join(', ')}>
                        {inv.services[0]?.name}
                        {inv.services.length > 1 && <span className="muted"> +{inv.services.length - 1}</span>}
                      </td>
                      <td>{formatBillingPeriod(inv.billingMonths)}</td>
                      <td>{formatDate(inv.invoiceDate)}</td>
                      <td className="num">{formatMoney(inv.grandTotal, inv.currency)}</td>
                      <td>
                        <StatusBadge status={inv.paymentStatus} />
                      </td>
                      <td className="actions-cell">
                        <InvoiceActions invoice={inv} onChanged={reload} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
      {data && (
        <Pagination
          page={data.page}
          pages={data.pages}
          total={data.total}
          onPage={(p) => setParams({ ...Object.fromEntries(params), page: String(p) })}
        />
      )}
    </>
  );
}
