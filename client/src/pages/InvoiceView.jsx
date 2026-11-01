import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { Card, ErrorBanner, PageHeader, PageLoader, StatusBadge } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import { InvoiceActions } from '../components/InvoiceActions.jsx';
import { formatDate, formatMoney } from '@shared/format.js';
import { formatBillingPeriod } from '@shared/billing.js';

export function InvoiceView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(() => api.invoice(id), [id]);
  const [pdf, setPdf] = useState(null);
  const [pdfError, setPdfError] = useState(null);

  // Reload the rendered PDF whenever the saved invoice changes.
  useEffect(() => {
    if (!data) return;
    let url;
    let stale = false;
    api
      .invoicePdf(data._id)
      .then((blob) => {
        if (stale) return;
        url = URL.createObjectURL(blob);
        setPdf(url);
      })
      .catch((e) => !stale && setPdfError(e));
    return () => {
      stale = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [data]);

  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  if (loading && !data) return <PageLoader />;
  const inv = data;
  const money = (v) => formatMoney(v, inv.currency);
  const balance = Math.max(inv.grandTotal - inv.amountPaid, 0);

  return (
    <>
      <PageHeader
        back={
          <Link to="/invoices" className="back-link">
            <Icon name="arrowLeft" size={14} /> All invoices
          </Link>
        }
        title={
          <span className="row gap-sm">
            <span className="mono">{inv.invoiceNumber}</span> <StatusBadge status={inv.paymentStatus} />
          </span>
        }
        subtitle={`${inv.customer.name} · ${formatBillingPeriod(inv.billingMonths)} · ${money(inv.grandTotal)}`}
        actions={<InvoiceActions invoice={inv} variant="buttons" onChanged={(u) => (u ? reload() : navigate('/invoices'))} />}
      />

      <div className="view-layout">
        <div className="card pdf-card">
          <ErrorBanner error={pdfError} />
          {pdf ? <iframe className="pdf-frame tall" src={`${pdf}#navpanes=0`} title={`Invoice ${inv.invoiceNumber}`} /> : <PageLoader label="Rendering PDF…" />}
        </div>

        <div className="stack">
          <Card title="Payment">
            <dl className="summary-totals">
              <div>
                <dt>Grand total</dt>
                <dd>{money(inv.grandTotal)}</dd>
              </div>
              <div>
                <dt>Amount paid</dt>
                <dd>{money(inv.amountPaid)}</dd>
              </div>
              <div className="summary-grand">
                <dt>Balance due</dt>
                <dd>{inv.paymentStatus === 'Cancelled' ? '—' : money(balance)}</dd>
              </div>
            </dl>
            {inv.paymentMethod && <p className="small muted">Method: {inv.paymentMethod}</p>}
          </Card>
          <Card title="Details">
            <dl className="summary-list">
              <div>
                <dt>Invoice date</dt>
                <dd>{formatDate(inv.invoiceDate)}</dd>
              </div>
              <div>
                <dt>Billing period</dt>
                <dd>{formatBillingPeriod(inv.billingMonths)}</dd>
              </div>
              <div>
                <dt>Due date</dt>
                <dd>{inv.dueDate ? formatDate(inv.dueDate) : 'On receipt'}</dd>
              </div>
              <div>
                <dt>Customer</dt>
                <dd>{inv.customer.name}</dd>
              </div>
              {inv.customer.customerId && (
                <div>
                  <dt>Customer ID</dt>
                  <dd className="mono tiny">{inv.customer.customerId}</dd>
                </div>
              )}
              <div>
                <dt>Services</dt>
                <dd>{inv.services.length}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{new Date(inv.createdAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{new Date(inv.updatedAt).toLocaleString()}</dd>
              </div>
              {inv.cancelledAt && (
                <div>
                  <dt>Cancelled</dt>
                  <dd>{new Date(inv.cancelledAt).toLocaleString()}</dd>
                </div>
              )}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
