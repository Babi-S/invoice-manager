import { Fragment, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync, useDebounced } from '../lib/useAsync.js';
import { EmptyState, ErrorBanner, PageHeader, Pagination, Spinner } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import { formatMoney } from '@shared/format.js';

const CONFIG = {
  customers: {
    title: 'Customers',
    icon: 'users',
    load: api.customers,
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'address', label: 'Address' },
    ],
  },
  services: {
    title: 'Services',
    icon: 'services',
    load: api.services,
    columns: [
      { key: 'name', label: 'Service' },
      { key: 'description', label: 'Description' },
      { key: 'price', label: 'Price', num: true },
    ],
  },
};

/** Read-only browser over the existing MongoDB collection. */
export function CatalogPage({ kind }) {
  const cfg = CONFIG[kind];
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);
  const query = useDebounced(q, 250);
  const { data, error, loading, reload } = useAsync(() => cfg.load({ q: query, page, limit: 25 }), [kind, query, page]);
  const { data: settings } = useAsync(() => api.settings(), []);

  const src = data?.source;
  // Only show columns whose field actually exists in the collection.
  const columns = src ? cfg.columns.filter((c) => c.key === 'name' || src.fields[c.key]) : [];

  return (
    <>
      <PageHeader
        title={cfg.title}
        subtitle={
          src ? (
            <span>
              Live, read-only data from <code>{src.database}.{src.collection}</code>
              {src.exists ? ` · ${data.total} record${data.total === 1 ? '' : 's'}${q ? ' matching' : ''}` : ''}
            </span>
          ) : (
            ' '
          )
        }
        actions={
          <button className="btn" onClick={reload}>
            <Icon name="refresh" /> Refresh
          </button>
        }
      />
      <div className="filters">
        <div className="input-icon grow">
          <Icon name="search" />
          <input
            className="input"
            placeholder={`Search ${kind}…`}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>
      <ErrorBanner error={error} onRetry={reload} />
      <div className="card">
        {loading && !data ? (
          <div className="page-loader">
            <Spinner label={`Loading ${kind}…`} />
          </div>
        ) : src && !src.exists ? (
          <EmptyState icon="database" title={`Collection "${src.collection}" not found`}>
            Set <code>{kind === 'customers' ? 'CUSTOMER_COLLECTION' : 'SERVICE_COLLECTION'}</code> in <code>server/.env</code> to the collection that holds your{' '}
            {kind}.
          </EmptyState>
        ) : data?.items.length === 0 ? (
          <EmptyState icon={cfg.icon} title={q ? `No ${kind} match “${q}”` : `No ${kind} in the collection`} />
        ) : (
          data && (
            <div className={`table-wrap ${loading ? 'is-loading' : ''}`}>
              <table className="table">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c.key} className={c.num ? 'num' : ''}>
                        {c.label}
                      </th>
                    ))}
                    <th>ID</th>
                    <th aria-label="Details" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <Fragment key={item._id}>
                      <tr>
                        {columns.map((c) => (
                          <td key={c.key} className={`${c.num ? 'num' : ''} ${c.key === 'description' ? 'truncate' : ''}`}>
                            {c.key === 'price'
                              ? item.price != null
                                ? formatMoney(item.price, settings?.currency)
                                : <span className="muted">—</span>
                              : item[c.key] || <span className="muted">—</span>}
                          </td>
                        ))}
                        <td className="mono tiny muted">{item._id}</td>
                        <td className="actions-cell">
                          {Object.keys(item.extra).length > 0 && (
                            <button className="btn btn-sm btn-ghost" onClick={() => setExpanded(expanded === item._id ? null : item._id)}>
                              {expanded === item._id ? 'Hide' : 'More'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded === item._id && (
                        <tr className="detail-row">
                          <td colSpan={columns.length + 2}>
                            <dl className="kv-grid">
                              {Object.entries(item.extra).map(([k, v]) => (
                                <div key={k}>
                                  <dt>{k}</dt>
                                  <dd>{v}</dd>
                                </div>
                              ))}
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
      {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
    </>
  );
}
