import { NavLink, Outlet } from 'react-router-dom';
import { Icon } from './Icons.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/invoices', label: 'All Invoices', icon: 'invoices', end: true },
  { to: '/invoices/new', label: 'Create Invoice', icon: 'plus' },
  { to: '/invoices/bulk', label: 'Bulk Generate', icon: 'layers', sub: true },
  { to: '/customers', label: 'Customers', icon: 'users' },
  { to: '/services', label: 'Services', icon: 'services' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export function Layout() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="invoices" size={16} strokeWidth={2.2} />
          </span>
          <span>Invoice Manager</span>
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link ${n.sub ? 'is-sub' : ''} ${isActive ? 'is-active' : ''}`}>
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <Icon name="database" size={14} />
          <span>Live data from MongoDB</span>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
