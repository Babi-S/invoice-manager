import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, ErrorBanner, Field, PageHeader, PageLoader, Spinner } from '../components/ui.jsx';
import { useToast } from '../components/feedback.jsx';
import { CURRENCIES } from '@shared/format.js';

const MAX_LOGO_BYTES = 500 * 1024;

export function SettingsPage() {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.settings().then(setForm).catch(setError);
  }, []);

  const fieldErrors = useMemo(() => Object.fromEntries((error?.details || []).map((d) => [d.path, d.message])), [error]);
  if (!form) return error ? <ErrorBanner error={error} /> : <PageLoader />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const onLogo = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) return setError({ message: 'Logo must be a PNG or JPEG image.' });
    if (file.size > MAX_LOGO_BYTES) return setError({ message: 'Logo must be smaller than 500 KB.' });
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, logo: reader.result }));
    reader.readAsDataURL(file);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      setForm(await api.saveSettings(form));
      toast('Settings saved');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save}>
      <PageHeader
        title="Settings"
        subtitle="Business details shown on every invoice PDF."
        actions={
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving && <Spinner size={14} />} Save settings
          </button>
        }
      />
      <ErrorBanner error={error} />
      <div className="settings-grid">
        <Card title="Business">
          <div className="stack">
            <div className="logo-row">
              <div className="logo-box">{form.logo ? <img src={form.logo} alt="Logo" /> : <span className="muted tiny">No logo</span>}</div>
              <div className="stack-sm">
                <label className="btn btn-sm">
                  Upload logo
                  <input type="file" accept="image/png,image/jpeg" hidden onChange={onLogo} />
                </label>
                {form.logo && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm((f) => ({ ...f, logo: '' }))}>
                    Remove
                  </button>
                )}
                <span className="muted tiny">PNG or JPEG, up to 500 KB</span>
              </div>
            </div>
            <Field label="Business name" error={fieldErrors.businessName}>
              <input className="input" value={form.businessName} onChange={set('businessName')} />
            </Field>
            <Field label="Address" error={fieldErrors.address}>
              <textarea className="input" rows={2} value={form.address} onChange={set('address')} />
            </Field>
            <div className="grid-2">
              <Field label="Email" error={fieldErrors.email}>
                <input className="input" value={form.email} onChange={set('email')} />
              </Field>
              <Field label="Phone" error={fieldErrors.phone}>
                <input className="input" value={form.phone} onChange={set('phone')} />
              </Field>
            </div>
          </div>
        </Card>
        <Card title="Invoicing">
          <div className="stack">
            <div className="grid-2">
              <Field label="Currency" hint="Applied to new invoices; existing invoices keep their currency.">
                <select className="input" value={form.currency} onChange={set('currency')}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Default tax %" error={fieldErrors.taxRate}>
                <input className="input" type="number" min="0" max="100" step="0.01" value={form.taxRate} onChange={set('taxRate')} />
              </Field>
            </div>
            <Field label="Payment instructions" error={fieldErrors.paymentInstructions} hint="Bank details, payment link, terms…">
              <textarea className="input" rows={4} value={form.paymentInstructions} onChange={set('paymentInstructions')} />
            </Field>
            <Field label="Invoice footer" error={fieldErrors.footer}>
              <input className="input" value={form.footer} onChange={set('footer')} />
            </Field>
          </div>
        </Card>
      </div>
    </form>
  );
}
