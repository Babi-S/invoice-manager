import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icons.jsx';
import { Field, Modal } from './ui.jsx';
import { useConfirm, useToast } from './feedback.jsx';
import { api } from '../lib/api.js';
import { downloadPdf, downloadPng, printInvoice } from '../lib/exporters.js';
import { formatMoney } from '@shared/format.js';

export function PaymentDialog({ invoice, onClose, onSaved }) {
  const toast = useToast();
  const [status, setStatus] = useState(invoice.paymentStatus === 'Cancelled' ? 'Pending' : invoice.paymentStatus);
  const [amount, setAmount] = useState(invoice.paymentStatus === 'Partially Paid' ? String(invoice.amountPaid) : '');
  const [method, setMethod] = useState(invoice.paymentMethod || '');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updatePayment(invoice._id, {
        paymentStatus: status,
        amountPaid: status === 'Partially Paid' ? amount : undefined,
        paymentMethod: method,
      });
      toast(`${invoice.invoiceNumber} marked ${status}`);
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e.details?.[0]?.message ? `Amount paid ${e.details[0].message}` : e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Payment status · ${invoice.invoiceNumber}`}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Update status'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="muted small">Grand total {formatMoney(invoice.grandTotal, invoice.currency)}</div>
        <div className="segmented">
          {['Pending', 'Partially Paid', 'Paid'].map((s) => (
            <button key={s} type="button" className={status === s ? 'is-on' : ''} onClick={() => setStatus(s)}>
              {s}
            </button>
          ))}
        </div>
        {status === 'Partially Paid' && (
          <Field label="Amount paid" error={error}>
            <input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
        )}
        <Field label="Payment method (optional)">
          <input className="input" value={method} placeholder="Bank transfer, card, cash…" onChange={(e) => setMethod(e.target.value)} />
        </Field>
        {error && status !== 'Partially Paid' && <div className="field-error">{error}</div>}
      </div>
    </Modal>
  );
}

/**
 * All per-invoice actions. `onChanged(updated|null)` is called after a change
 * (null when deleted). `variant="buttons"` renders the main ones inline.
 */
export function InvoiceActions({ invoice, onChanged, variant = 'menu' }) {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const ref = useRef(null);
  const cancelled = invoice.paymentStatus === 'Cancelled';
  const deletable = invoice.paymentStatus === 'Pending' && !(invoice.amountPaid > 0);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const run = async (key, fn) => {
    setOpen(false);
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const actions = {
    view: () => navigate(`/invoices/${invoice._id}`),
    edit: () => navigate(`/invoices/${invoice._id}/edit`),
    duplicate: () => navigate(`/invoices/new?from=${invoice._id}`),
    pdf: () => run('pdf', async () => downloadPdf(invoice)),
    png: () => run('png', () => downloadPng(invoice)),
    print: () => run('print', () => printInvoice(invoice)),
    paid: () =>
      run('paid', async () => {
        const updated = await api.updatePayment(invoice._id, { paymentStatus: 'Paid' });
        toast(`${invoice.invoiceNumber} marked as paid`);
        onChanged?.(updated);
      }),
    payment: () => {
      setOpen(false);
      setPaymentOpen(true);
    },
    cancel: async () => {
      setOpen(false);
      const ok = await confirm({
        title: `Cancel ${invoice.invoiceNumber}?`,
        message: 'The invoice is kept for your records but marked Cancelled and excluded from totals. Its billing period can then be invoiced again.',
        confirmLabel: 'Cancel invoice',
        danger: true,
      });
      if (ok)
        run('cancel', async () => {
          const updated = await api.cancelInvoice(invoice._id);
          toast(`${invoice.invoiceNumber} cancelled`);
          onChanged?.(updated);
        });
    },
    delete: async () => {
      setOpen(false);
      const ok = await confirm({
        title: `Delete ${invoice.invoiceNumber}?`,
        message: 'This permanently removes the invoice. This cannot be undone.',
        confirmLabel: 'Delete invoice',
        danger: true,
      });
      if (ok)
        run('delete', async () => {
          await api.deleteInvoice(invoice._id);
          toast(`${invoice.invoiceNumber} deleted`);
          onChanged?.(null);
        });
    },
  };

  const items = [
    variant === 'menu' && { key: 'view', label: 'View', icon: 'eye' },
    !cancelled && { key: 'edit', label: 'Edit', icon: 'edit' },
    { key: 'pdf', label: 'Download PDF', icon: 'download' },
    { key: 'png', label: 'Download PNG', icon: 'image' },
    { key: 'print', label: 'Print', icon: 'printer' },
    { key: 'duplicate', label: 'Duplicate', icon: 'copy' },
    'sep',
    !cancelled && invoice.paymentStatus !== 'Paid' && { key: 'paid', label: 'Mark as paid', icon: 'check' },
    !cancelled && { key: 'payment', label: 'Update payment status', icon: 'card' },
    'sep',
    !cancelled && !deletable && { key: 'cancel', label: 'Cancel invoice', icon: 'ban', danger: true },
    deletable && { key: 'delete', label: 'Delete', icon: 'trash', danger: true },
  ].filter(Boolean);

  const menu = (
    <div className="menu-wrap" ref={ref}>
      <button
        className={variant === 'menu' ? 'icon-btn' : 'btn'}
        onClick={() => setOpen((o) => !o)}
        aria-label="Invoice actions"
        aria-haspopup="menu"
        disabled={!!busy}
      >
        {busy ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <Icon name="more" />}
        {variant !== 'menu' && 'More'}
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((it, i) =>
            it === 'sep' ? (
              <div key={`sep${i}`} className="menu-sep" />
            ) : (
              <button key={it.key} role="menuitem" className={`menu-item ${it.danger ? 'is-danger' : ''}`} onClick={actions[it.key]}>
                <Icon name={it.icon} />
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      {variant === 'buttons' ? (
        <div className="btn-group">
          {!cancelled && (
            <button className="btn" onClick={actions.edit}>
              <Icon name="edit" /> Edit
            </button>
          )}
          <button className="btn" onClick={actions.print} disabled={busy === 'print'}>
            <Icon name="printer" /> Print
          </button>
          <button className="btn" onClick={actions.png} disabled={busy === 'png'}>
            <Icon name="image" /> {busy === 'png' ? 'Rendering…' : 'PNG'}
          </button>
          <button className="btn btn-primary" onClick={actions.pdf}>
            <Icon name="download" /> Download PDF
          </button>
          {menu}
        </div>
      ) : (
        menu
      )}
      {paymentOpen && <PaymentDialog invoice={invoice} onClose={() => setPaymentOpen(false)} onSaved={(u) => onChanged?.(u)} />}
    </>
  );
}
