import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { Card, EmptyState, ErrorBanner, Modal, PageHeader, PageLoader, Spinner, StatusBadge } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import { formatDate, formatMoney } from '@shared/format.js';
import { formatBillingPeriod, MONTHS, MONTHS_SHORT } from '@shared/billing.js';

function StatCard({ label, value, sub }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

const SERIES = [
  { key: 'amount', label: 'Invoiced', cls: 's1' },
  { key: 'paid', label: 'Paid', cls: 's2' },
];

// Axis top = 4 round steps (e.g. 2,500 → 0 / 1K / 2K / 3K / 4K).
function niceMax(v) {
  if (v <= 0) return 4;
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= raw) * 4;
}

function useWidth(fallback) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function MonthlyChart({ months, currency }) {
  const [hover, setHover] = useState(null);
  const [ref, W] = useWidth(720);
  const H = 260;
  const pad = { l: 56, r: 8, t: 12, b: 26 };
  const max = niceMax(Math.max(...months.map((m) => m.amount)));
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const band = plotW / 12;
  const barW = Math.min(18, (band - 12) / 2);
  const y = (v) => pad.t + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const compact = (v) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

  // Bar with 4px rounded top, square at the baseline.
  const bar = (x, v) => {
    const top = y(v);
    const h = pad.t + plotH - top;
    if (h <= 0) return null;
    const r = Math.min(4, h, barW / 2);
    const b = pad.t + plotH;
    return `M${x},${b}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${x + barW},${top + r}V${b}Z`;
  };

  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Invoiced and paid amounts by invoice month">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 8} y={y(t) + 4} className="axis" textAnchor="end">
              {compact(t)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const x0 = pad.l + i * band;
          const cx = x0 + band / 2;
          return (
            <g key={m.month}>
              {hover === i && <rect x={x0 + 2} y={pad.t} width={band - 4} height={plotH} className="hover-band" rx="4" />}
              <path d={bar(cx - barW - 1, m.amount)} className="bar s1" />
              <path d={bar(cx + 1, m.paid)} className="bar s2" />
              <text x={cx} y={H - 8} className="axis" textAnchor="middle">
                {MONTHS_SHORT[i]}
              </text>
              <rect
                x={x0}
                y={pad.t}
                width={band}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: `${((pad.l + (hover + 0.5) * band) / W) * 100}%` }}>
          <div className="tooltip-title">
            Invoiced {MONTHS[hover]} · {months[hover].count} invoice{months[hover].count === 1 ? '' : 's'}
          </div>
          {SERIES.map((s) => (
            <div key={s.key} className="tooltip-row">
              <span className={`swatch ${s.cls}`} />
              {s.label}
              <b>{formatMoney(months[hover][s.key], currency)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ImportDialog({ onClose }) {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(() => api.catalogStatus(), []);
  const rows = data ? [data.customers, data.services] : [];
  return (
    <Modal
      title="Import customers & services"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn" onClick={reload} disabled={loading}>
            <Icon name="refresh" /> Re-scan
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <p className="muted small">
        Customers and services are read live from your existing MongoDB collections — nothing is copied or modified. Field names are
        detected from the actual documents.
      </p>
      <ErrorBanner error={error} />
      {loading && <Spinner label="Scanning collections…" />}
      {!loading &&
        rows.map((s) => (
          <div key={s.kind} className="import-row">
            <div className="import-head">
              <div>
                <b>{s.kind === 'customer' ? 'Customers' : 'Services'}</b>
                <div className="muted small">
                  <code>{s.database}.{s.collection}</code>
                </div>
              </div>
              {s.exists ? <span className="badge badge-paid">{s.count} records</span> : <span className="badge badge-cancelled">Not found</span>}
            </div>
            {s.exists && (
              <div className="small">
                Mapped fields:{' '}
                {Object.entries(s.fields)
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <span key={k} className="kv">
                      {k} → <code>{v}</code>
                    </span>
                  ))}
              </div>
            )}
            {s.exists && (
              <button className="btn btn-sm" onClick={() => navigate(s.kind === 'customer' ? '/customers' : '/services')}>
                Browse {s.kind === 'customer' ? 'customers' : 'services'}
              </button>
            )}
          </div>
        ))}
    </Modal>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const [year, setYear] = useState(new Date().getFullYear());
  const [showTable, setShowTable] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const { data, error, loading, reload } = useAsync(() => api.dashboard(year), [year]);

  const money = (v) => formatMoney(v, data?.currency);
  const s = data?.stats;
  const years = data ? [...new Set([...data.monthly.years, new Date().getFullYear(), year])].sort() : [year];

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Overview of all invoices (cancelled invoices excluded)"
        actions={
          <>
            <button className="btn" onClick={() => setImportOpen(true)}>
              <Icon name="database" /> Import Customers & Services
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/invoices/new')}>
              <Icon name="plus" /> Create Invoice
            </button>
          </>
        }
      />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <PageLoader />}
      {data && (
        <>
          <div className="stats">
            <StatCard label="Total invoices" value={s.totalInvoices} />
            <StatCard label="Total invoice amount" value={money(s.totalAmount)} />
            <StatCard label="Paid amount" value={money(s.paidAmount)} />
            <StatCard label="Pending amount" value={money(s.pendingAmount)} />
            <StatCard label="Paid invoices" value={s.paidInvoices} />
            <StatCard
              label="Pending invoices"
              value={s.pendingInvoices}
              sub={s.partiallyPaidInvoices ? `incl. ${s.partiallyPaidInvoices} partially paid` : null}
            />
          </div>

          <Card
            title="Monthly invoice summary"
            actions={
              <div className="row gap-sm">
                <div className="legend">
                  {SERIES.map((x) => (
                    <span key={x.key}>
                      <span className={`swatch ${x.cls}`} />
                      {x.label}
                    </span>
                  ))}
                </div>
                <select className="input input-sm" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
                  {years.map((y) => (
                    <option key={y}>{y}</option>
                  ))}
                </select>
                <button className="btn btn-sm" onClick={() => setShowTable((t) => !t)}>
                  {showTable ? 'Chart' : 'Table'}
                </button>
              </div>
            }
          >
            <p className="muted small chart-note">Grouped by invoice date — each invoice covers the previous month&apos;s services.</p>
            {showTable ? (
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Invoice month</th>
                    <th className="num">Invoices</th>
                    <th className="num">Invoiced</th>
                    <th className="num">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {data.monthly.months.map((m) => (
                    <tr key={m.month}>
                      <td>
                        {MONTHS[m.month - 1]} {data.monthly.year}
                      </td>
                      <td className="num">{m.count}</td>
                      <td className="num">{money(m.amount)}</td>
                      <td className="num">{money(m.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : data.monthly.months.every((m) => m.count === 0) ? (
              <EmptyState icon="dashboard" title={`No invoices dated in ${data.monthly.year}`}>
                Pick another year, or create invoices to see the monthly summary.
              </EmptyState>
            ) : (
              <MonthlyChart months={data.monthly.months} currency={data.currency} />
            )}
          </Card>

          <Card title="Recent invoices" actions={<Link to="/invoices" className="link">View all</Link>} pad={false}>
            {data.recent.length === 0 ? (
              <EmptyState
                title="No invoices yet"
                action={
                  <button className="btn btn-primary" onClick={() => navigate('/invoices/new')}>
                    Create your first invoice
                  </button>
                }
              >
                Create an invoice manually or generate monthly invoices in bulk.
              </EmptyState>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Billing period</th>
                    <th>Invoice date</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((inv) => (
                    <tr key={inv._id} className="clickable" onClick={() => navigate(`/invoices/${inv._id}`)}>
                      <td className="mono">{inv.invoiceNumber}</td>
                      <td>{inv.customer.name}</td>
                      <td>{formatBillingPeriod(inv.billingMonths)}</td>
                      <td>{formatDate(inv.invoiceDate)}</td>
                      <td className="num">{formatMoney(inv.grandTotal, inv.currency)}</td>
                      <td>
                        <StatusBadge status={inv.paymentStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </>
  );
}
