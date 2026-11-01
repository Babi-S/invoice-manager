export class ApiError extends Error {
  constructor(status, message, details, data) {
    super(message);
    this.status = status;
    this.details = details;
    this.data = data;
  }
}

async function request(method, path, body, { raw = false } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is it running?');
  }
  if (!res.ok) {
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.details, data);
  }
  if (raw) return res.blob();
  return res.status === 204 ? null : res.json();
}

const qs = (params = {}) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
  return s ? `?${s}` : '';
};

export const api = {
  dashboard: (year) => request('GET', `/dashboard${qs({ year })}`),
  catalogStatus: () => request('GET', '/catalog/status'),
  customers: (params) => request('GET', `/customers${qs(params)}`),
  services: (params) => request('GET', `/services${qs(params)}`),

  invoices: (params) => request('GET', `/invoices${qs(params)}`),
  invoice: (id) => request('GET', `/invoices/${id}`),
  nextNumber: () => request('GET', '/invoices/next-number'),
  validateInvoice: (body, excludeId) => request('POST', `/invoices/validate${qs({ exclude: excludeId })}`, body),
  previewPdf: (body, excludeId) => request('POST', `/invoices/preview${qs({ exclude: excludeId })}`, body, { raw: true }),
  createInvoice: (body) => request('POST', '/invoices', body),
  updateInvoice: (id, body) => request('PUT', `/invoices/${id}`, body),
  updatePayment: (id, body) => request('PATCH', `/invoices/${id}/payment`, body),
  cancelInvoice: (id) => request('POST', `/invoices/${id}/cancel`),
  deleteInvoice: (id) => request('DELETE', `/invoices/${id}`),
  invoicePdf: (id) => request('GET', `/invoices/${id}/pdf`, undefined, { raw: true }),
  bulk: (body, dryRun) => request('POST', `/invoices/bulk${qs({ dryRun: String(dryRun) })}`, body),

  settings: () => request('GET', '/settings'),
  saveSettings: (body) => request('PUT', '/settings', body),
};

export const pdfUrl = (id, download = false) => `/api/invoices/${id}/pdf${download ? '?download=1' : ''}`;
