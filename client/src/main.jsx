import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.jsx';
import { FeedbackProvider } from './components/feedback.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { InvoiceList } from './pages/InvoiceList.jsx';
import { InvoiceForm } from './pages/InvoiceForm.jsx';
import { InvoiceView } from './pages/InvoiceView.jsx';
import { BulkGenerate } from './pages/BulkGenerate.jsx';
import { CatalogPage } from './pages/CatalogPage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';
import { EmptyState } from './components/ui.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <FeedbackProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="invoices" element={<InvoiceList />} />
            <Route path="invoices/new" element={<InvoiceForm />} />
            <Route path="invoices/bulk" element={<BulkGenerate />} />
            <Route path="invoices/:id" element={<InvoiceView />} />
            <Route path="invoices/:id/edit" element={<InvoiceForm />} />
            <Route path="customers" element={<CatalogPage kind="customers" />} />
            <Route path="services" element={<CatalogPage kind="services" />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<EmptyState title="Page not found" />} />
          </Route>
        </Routes>
      </FeedbackProvider>
    </BrowserRouter>
  </StrictMode>,
);
