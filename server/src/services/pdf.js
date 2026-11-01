import PDFDocument from 'pdfkit';
import { formatDate, formatMoney } from '../../../shared/format.js';
import { billingYears, formatBillingPeriod } from '../../../shared/billing.js';

const C = {
  text: '#1a1f36',
  muted: '#697386',
  faint: '#8792a2',
  border: '#e3e8ee',
  soft: '#f6f8fa',
  accent: '#4f46e5',
  accentSoft: '#eef2ff',
};

function decodeLogo(dataUrl) {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl || '');
  return m ? Buffer.from(m[2], 'base64') : null;
}

/** Renders an invoice PDF to a Buffer. `draft` marks unsaved previews. */
export function renderInvoicePdf(invoice, settings, { draft = false } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      bufferPages: true,
      info: { Title: `Invoice ${invoice.invoiceNumber}`, Author: settings.businessName || 'Invoice' },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      draw(doc, invoice, settings, draft);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function draw(doc, inv, s, draft) {
  // Every text element sits between the same two content edges (CL…CR);
  // fills and rules extend PAD further out to L…R.
  const PAD = 12;
  const L = 50;
  const R = doc.page.width - 50;
  const W = R - L;
  const CL = L + PAD;
  const CR = R - PAD;
  const CW = CR - CL;
  const COL2 = CR - 230; // right column (invoice details + totals) starts here
  const LEFT_W = COL2 - CL - 24;
  const BOTTOM = doc.page.height - 70;
  const GAP = 26; // vertical space between sections
  const money = (v) => formatMoney(v, inv.currency || s.currency || 'USD');
  const label = (text, x, y, opts = {}) =>
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.faint).text(text.toUpperCase(), x, y, { characterSpacing: 0.6, ...opts });
  const rule = (y, color = C.border, width = 0.75) => doc.moveTo(L, y).lineTo(R, y).lineWidth(width).strokeColor(color).stroke();
  const pairRow = (k, val, y, { bold = false, size = 9.5 } = {}) => {
    const font = bold ? 'Helvetica-Bold' : 'Helvetica';
    doc.font(font).fontSize(size).fillColor(bold ? C.text : C.muted).text(k, COL2, y, { width: 120 });
    doc.font(font).fontSize(size).fillColor(C.text).text(val, COL2 + 100, y, { width: CR - COL2 - 100, align: 'right' });
  };

  // ── Header: title (left) / business details, only if configured (right) ─
  let y = 50;
  doc.font('Helvetica-Bold').fontSize(26).fillColor(C.accent).text('INVOICE', CL, y);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(C.muted)
    .text(draft ? `${inv.invoiceNumber} · Preview` : inv.invoiceNumber, CL, y + 32);
  let headerBottom = y + 46;

  let ry = y;
  const logo = decodeLogo(s.logo);
  if (logo) {
    try {
      doc.image(logo, CR - 120, ry, { fit: [120, 48], align: 'right' });
      ry += 56;
    } catch {
      /* unreadable image: render without logo */
    }
  }
  if (s.businessName) {
    doc.font('Helvetica-Bold').fontSize(12).fillColor(C.text).text(s.businessName, CL + CW / 2, ry, { width: CW / 2, align: 'right' });
    ry = doc.y + 2;
  }
  doc.font('Helvetica').fontSize(9).fillColor(C.muted);
  for (const line of [s.address, s.email, s.phone].filter(Boolean)) {
    doc.text(line, CL + CW / 2, ry, { width: CW / 2, align: 'right' });
    ry = doc.y + 1;
  }
  headerBottom = Math.max(headerBottom, ry);

  y = headerBottom + 18;
  rule(y, C.border, 1);
  y += GAP;

  // ── Bill to (left) / invoice details (right column) ─────────────────────
  label('Bill to', CL, y);
  doc.font('Helvetica-Bold').fontSize(11.5).fillColor(C.text).text(inv.customer?.name || '—', CL, y + 16, { width: LEFT_W });
  doc.font('Helvetica').fontSize(9).fillColor(C.muted);
  for (const line of [inv.customer?.address, inv.customer?.email, inv.customer?.phone].filter(Boolean)) {
    doc.text(line, CL, doc.y + 3, { width: LEFT_W });
  }
  const billBottom = doc.y;

  label('Invoice details', COL2, y);
  let dy = y + 16;
  for (const [k, val] of [
    ['Invoice number', inv.invoiceNumber],
    ['Invoice date', formatDate(inv.invoiceDate)],
    ['Due date', inv.dueDate ? formatDate(inv.dueDate) : 'On receipt'],
    ['Billing year', billingYears(inv.billingMonths).join(', ')],
  ]) {
    doc.font('Helvetica').fontSize(9).fillColor(C.muted).text(k, COL2, dy, { width: 110 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.text).text(val, COL2 + 100, dy, { width: CR - COL2 - 100, align: 'right' });
    dy += 17;
  }
  y = Math.max(billBottom, dy) + GAP - 6;

  // ── Billing period banner ───────────────────────────────────────────────
  const period = formatBillingPeriod(inv.billingMonths);
  doc.font('Helvetica-Bold').fontSize(12.5);
  const periodH = Math.max(doc.heightOfString(period, { width: LEFT_W }), 15);
  const bannerH = periodH + 38;
  doc.roundedRect(L, y, W, bannerH, 6).fill(C.accentSoft);
  label('Billing period (services rendered)', CL, y + 13);
  doc.font('Helvetica-Bold').fontSize(12.5).fillColor(C.text).text(period, CL, y + 26, { width: LEFT_W });
  label('Invoiced on', COL2, y + 13, { width: CR - COL2, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(12.5).fillColor(C.text).text(formatDate(inv.invoiceDate), COL2, y + 26, { width: CR - COL2, align: 'right' });
  y += bannerH + GAP;

  // ── Line items ──────────────────────────────────────────────────────────
  const cols = {
    amount: { x: CR - 90, w: 90 },
    unit: { x: CR - 185, w: 90 },
    qty: { x: CR - 225, w: 35 },
  };
  cols.desc = { x: CL, w: cols.qty.x - CL - 12 };
  const tableHeader = () => {
    doc.rect(L, y, W, 26).fill(C.soft);
    const hy = y + 10;
    label('Description', cols.desc.x, hy, { width: cols.desc.w });
    label('Qty', cols.qty.x, hy, { width: cols.qty.w, align: 'right' });
    label('Unit price', cols.unit.x, hy, { width: cols.unit.w, align: 'right' });
    label('Amount', cols.amount.x, hy, { width: cols.amount.w, align: 'right' });
    y += 26;
  };
  tableHeader();

  for (const line of inv.services || []) {
    doc.font('Helvetica-Bold').fontSize(10);
    const nameH = doc.heightOfString(line.name, { width: cols.desc.w });
    doc.font('Helvetica').fontSize(8.5);
    const descH = line.description ? doc.heightOfString(line.description, { width: cols.desc.w }) + 4 : 0;
    const rowH = nameH + descH + 24;
    if (y + rowH > BOTTOM) {
      doc.addPage();
      y = 50;
      tableHeader();
    }
    const ty = y + 12;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.text).text(line.name, cols.desc.x, ty, { width: cols.desc.w });
    if (line.description) {
      doc.font('Helvetica').fontSize(8.5).fillColor(C.muted).text(line.description, cols.desc.x, ty + nameH + 4, { width: cols.desc.w });
    }
    doc.font('Helvetica').fontSize(10).fillColor(C.text);
    doc.text(String(line.quantity), cols.qty.x, ty, { width: cols.qty.w, align: 'right' });
    doc.text(money(line.unitPrice), cols.unit.x, ty, { width: cols.unit.w, align: 'right' });
    doc.font('Helvetica-Bold').text(money(line.total), cols.amount.x, ty, { width: cols.amount.w, align: 'right' });
    y += rowH;
    rule(y);
  }

  // ── Totals (right column, same edges as the invoice details) ────────────
  const totals = [['Subtotal', money(inv.subtotal)]];
  if (inv.discount > 0) {
    totals.push([inv.discountType === 'percent' ? `Discount (${inv.discountValue}%)` : 'Discount', `-${money(inv.discount)}`]);
  }
  if (inv.taxRate > 0 || inv.tax > 0) totals.push([`Tax (${inv.taxRate}%)`, money(inv.tax)]);
  const showPaid = inv.amountPaid > 0 && inv.paymentStatus !== 'Cancelled';
  const totalsH = totals.length * 19 + 40 + (showPaid ? 42 : 0);
  if (y + totalsH + 20 > BOTTOM) {
    doc.addPage();
    y = 50;
  }
  y += 16;
  for (const [k, val] of totals) {
    pairRow(k, val, y);
    y += 19;
  }
  doc.moveTo(COL2, y).lineTo(CR, y).lineWidth(1).strokeColor(C.text).stroke();
  y += 10;
  pairRow('Total', money(inv.grandTotal), y, { bold: true, size: 12.5 });
  y += 26;
  if (showPaid) {
    pairRow('Amount paid', `-${money(inv.amountPaid)}`, y);
    y += 19;
    pairRow('Balance due', money(Math.max(inv.grandTotal - inv.amountPaid, 0)), y, { bold: true, size: 10.5 });
    y += 23;
  }
  y += GAP - 10;

  // ── Payment instructions & notes ────────────────────────────────────────
  const block = (title, body) => {
    if (!body) return;
    doc.font('Helvetica').fontSize(9);
    if (y + 16 + Math.min(doc.heightOfString(body, { width: CW }), 60) + 20 > BOTTOM) {
      doc.addPage();
      y = 50;
    } else {
      rule(y);
      y += 16;
    }
    label(title, CL, y);
    doc.font('Helvetica').fontSize(9).fillColor(C.text).text(body, CL, y + 14, { width: CW, lineGap: 3 });
    y = doc.y + 18;
  };
  const payment = [inv.paymentMethod && `Payment method: ${inv.paymentMethod}`, s.paymentInstructions].filter(Boolean).join('\n');
  block('Payment instructions', payment);
  block('Notes', inv.notes);

  // ── Footer on every page ────────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // allow writing inside the bottom margin
    const fy = doc.page.height - 45;
    doc.moveTo(L, fy - 10).lineTo(R, fy - 10).lineWidth(0.75).strokeColor(C.border).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(C.faint);
    if (s.footer) doc.text(s.footer, CL, fy, { width: CW - 160, lineBreak: false, ellipsis: true });
    doc.text(`${inv.invoiceNumber} · Page ${i - range.start + 1} of ${range.count}`, CR - 150, fy, { width: 150, align: 'right' });
    doc.page.margins.bottom = bottomMargin;
  }
}
