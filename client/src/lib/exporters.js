// Download / print helpers. Every export starts from the server-generated PDF of
// the saved invoice, so PDF, PNG and print output are identical.
import { api, pdfUrl } from './api.js';

export function downloadPdf(invoice) {
  const a = document.createElement('a');
  a.href = pdfUrl(invoice._id, true);
  a.download = `${invoice.invoiceNumber}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Rasterises the invoice PDF (all pages stacked) into a PNG at 2.5× resolution. */
export async function downloadPng(invoice, scale = 2.5) {
  const [pdfjs, { default: workerSrc }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const data = new Uint8Array(await (await api.invoicePdf(invoice._id)).arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  try {
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      pages.push(canvas);
    }
    const out = document.createElement('canvas');
    out.width = Math.max(...pages.map((p) => p.width));
    out.height = pages.reduce((h, p) => h + p.height, 0);
    const octx = out.getContext('2d');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, out.width, out.height);
    let y = 0;
    for (const p of pages) {
      octx.drawImage(p, 0, y);
      y += p.height;
    }
    const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    saveBlob(blob, `${invoice.invoiceNumber}.png`);
  } finally {
    pdf.destroy();
  }
}

/** Prints the PDF through a hidden iframe; falls back to opening it in a new tab. */
export async function printInvoice(invoice) {
  const blob = await api.invoicePdf(invoice._id);
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch {
      window.open(url, '_blank', 'noopener');
    }
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
  document.body.appendChild(frame);
}
