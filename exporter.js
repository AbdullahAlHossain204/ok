// Admin-only exports: Excel workbook and PDF report of all credit/debit history, with weekly and monthly breakdowns.
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const path = require('path');
const { db } = require('./db');
const { validDate, today, isoDay, fmtDate, taka, OFFSET } = require('./money');

const DAY = 864e5, MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ms = (d) => Date.parse(d + 'T00:00:00Z');
const weekStart = (d) => { const t = ms(d); return isoDay(t - ((new Date(t).getUTCDay() + 1) % 7) * DAY); }; // weeks run Saturday to Friday
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const nowText = () => new Date(Date.now() + OFFSET).toISOString().replace('T', ' ').slice(0, 16);

function exportRange(q = {}) {
  const t = today();
  let from, to, title;
  if (q.range === 'month') { from = t.slice(0, 7) + '-01'; to = lastDay(t.slice(0, 7)); title = 'This month'; }
  else if (q.range === 'year') { from = t.slice(0, 4) + '-01-01'; to = t.slice(0, 4) + '-12-31'; title = 'This year'; }
  else if (q.range === 'custom' && validDate(q.from) && validDate(q.to) && q.from <= q.to) { from = q.from; to = q.to; title = 'Custom range'; }
  else {
    const r = db.prepare('SELECT MIN(date) a, MAX(date) b FROM transactions').get();
    from = r.a || t; to = r.b || t; title = 'All history';
  }
  return { from, to, label: `${title} (${fmtDate(from)} – ${fmtDate(to)})`, title };
}

// All amounts stay in integer poisha until the very end.
function loadExport(range) {
  const rows = db.prepare(`SELECT t.txn_id, t.type, t.date, t.amount, t.status, t.purpose, t.description, t.payment_method, t.name_visibility, t.note,
      d.name donor_name, d.phone, c.name category, f.name fund
    FROM transactions t LEFT JOIN donors d ON d.id=t.donor_id LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN funds f ON f.id=t.fund_id
    WHERE t.date>=? AND t.date<=? ORDER BY t.date ASC, t.id ASC`).all(range.from, range.to);
  const mk = (x = {}) => ({ credit: 0, debit: 0, donations: 0, expenses: 0, ...x });
  const months = new Map(), weeks = new Map(), totals = mk();
  let [y, m] = range.from.slice(0, 7).split('-').map(Number);
  const [ey, em] = range.to.slice(0, 7).split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) { months.set(`${y}-${String(m).padStart(2, '0')}`, mk({ label: `${MONTHS[m - 1]} ${y}` })); if (++m > 12) { m = 1; y++; } }
  for (let s = weekStart(range.from); s <= range.to; s = isoDay(ms(s) + 7 * DAY)) weeks.set(s, mk({ start: s, end: isoDay(ms(s) + 6 * DAY) }));
  for (const r of rows) {
    if (r.status !== 'COMPLETED') continue;
    for (const b of [totals, months.get(r.date.slice(0, 7)), weeks.get(weekStart(r.date))]) {
      if (r.type === 'CREDIT') { b.credit += r.amount; b.donations++; } else { b.debit += r.amount; b.expenses++; }
    }
  }
  const fin = (b) => ({ ...b, net: b.credit - b.debit });
  return { range, rows, totals: fin(totals), months: [...months.values()].map(fin), weeks: [...weeks.values()].map(fin) };
}

const detail = (r) => (r.type === 'CREDIT' ? r.purpose : (r.description || r.purpose)) || '';
const tk = (p) => p / 100;

// ---------------------------------------------------------------- Excel
async function buildXlsx(data, site) {
  const wb = new ExcelJS.Workbook();
  wb.creator = site.name; wb.created = new Date();
  const GREEN = 'FF0B4D3A', head = (ws, row) => { row.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }; c.alignment = { vertical: 'middle', wrapText: true }; }); ws.views = [{ state: 'frozen', ySplit: row.number }]; };
  const MONEY = '#,##0.00';
  const sum = wb.addWorksheet('Summary'), mon = wb.addWorksheet('Monthly'), wk = wb.addWorksheet('Weekly'), tx = wb.addWorksheet('Transactions');

  // ----- Transactions (the source data) -----
  const cols = [['Transaction ID', 16], ['Date', 13], ['Type', 9], ['Donor', 24], ['Phone', 16], ['Name shown publicly', 16], ['Category', 18], ['Fund', 18], ['Purpose / Description', 34], ['Payment method', 14], ['Status', 12], ['Amount (BDT)', 15], ['Note', 30]];
  tx.columns = cols.map(([header, width]) => ({ header, width }));
  head(tx, tx.getRow(1));
  data.rows.forEach((r) => {
    const row = tx.addRow([r.txn_id, new Date(r.date + 'T00:00:00Z'), r.type, r.donor_name || '', r.phone ? String(r.phone) : '', r.type === 'CREDIT' ? (r.name_visibility === 'PUBLIC' ? 'Public' : 'Private') : '',
      r.category || '', r.fund || '', detail(r), r.payment_method || '', r.status, tk(r.amount), r.note || '']);
    row.getCell(2).numFmt = 'dd mmm yyyy'; row.getCell(12).numFmt = MONEY;
    row.getCell(3).font = { bold: true, color: { argb: r.type === 'CREDIT' ? 'FF0B5A32' : 'FF8A1F17' } };
  });
  tx.autoFilter = { from: 'A1', to: `M${Math.max(2, data.rows.length + 1)}` };
  const N = Math.max(2, data.rows.length + 1), amt = `Transactions!$L$2:$L$${N}`, typ = `Transactions!$C$2:$C$${N}`, sta = `Transactions!$K$2:$K$${N}`;

  // ----- Monthly / Weekly (period sums from the database; net and totals are live formulas) -----
  const period = (ws, labels, items, firstCols) => {
    ws.columns = [...firstCols, { header: 'Credit (BDT)', width: 16 }, { header: 'Debit (BDT)', width: 16 }, { header: 'Net (BDT)', width: 16 }, { header: 'Donations', width: 11 }, { header: 'Expenses', width: 11 }];
    head(ws, ws.getRow(1));
    const k = firstCols.length;
    items.forEach((b, i) => {
      const r = i + 2, c = (n) => String.fromCharCode(65 + k + n);
      const row = ws.addRow([...labels(b), tk(b.credit), tk(b.debit), { formula: `${c(0)}${r}-${c(1)}${r}`, result: tk(b.net) }, b.donations, b.expenses]);
      for (let n = 0; n < 3; n++) row.getCell(k + 1 + n).numFmt = MONEY;
    });
    const last = items.length + 1, tr = ws.addRow([...Array(k - 1).fill(''), 'TOTAL']);
    ['credit', 'debit', 'net', 'donations', 'expenses'].forEach((key, n) => {
      const col = String.fromCharCode(65 + k + n);
      tr.getCell(k + 1 + n).value = { formula: `SUM(${col}2:${col}${last})`, result: key === 'donations' || key === 'expenses' ? data.totals[key] : tk(data.totals[key]) };
      if (n < 3) tr.getCell(k + 1 + n).numFmt = MONEY;
    });
    tr.font = { bold: true }; tr.eachCell((c) => { c.border = { top: { style: 'thin' } }; });
  };
  period(mon, (b) => [b.label], data.months, [{ header: 'Month', width: 20 }]);
  period(wk, (b) => [new Date(b.start + 'T00:00:00Z'), new Date(b.end + 'T00:00:00Z')], data.weeks, [{ header: 'Week start (Sat)', width: 17 }, { header: 'Week end (Fri)', width: 17 }]);
  wk.getColumn(1).numFmt = 'dd mmm yyyy'; wk.getColumn(2).numFmt = 'dd mmm yyyy';

  // ----- Summary (live formulas over the Transactions sheet) -----
  sum.columns = [{ width: 34 }, { width: 22 }];
  sum.addRow([site.name]).font = { bold: true, size: 14, color: { argb: GREEN } };
  if (site.name_bn) sum.addRow([site.name_bn]);
  sum.addRow(['Financial report: all credit and debit history']).font = { bold: true };
  sum.addRow(['Period', data.range.label]); sum.addRow(['Generated', nowText()]); sum.addRow([]);
  head(sum, sum.addRow(['Item', 'Value'])); sum.views = [];
  const f = (formula, result, fmt) => ({ formula, result, fmt });
  const items = [
    ['Total Credit (BDT)', f(`SUMIFS(${amt},${typ},"CREDIT",${sta},"COMPLETED")`, tk(data.totals.credit), MONEY)],
    ['Total Debit (BDT)', f(`SUMIFS(${amt},${typ},"DEBIT",${sta},"COMPLETED")`, tk(data.totals.debit), MONEY)],
    ['Net balance (BDT)', f('B8-B9', tk(data.totals.net), MONEY)],
    ['Number of donations', f(`COUNTIFS(${typ},"CREDIT",${sta},"COMPLETED")`, data.totals.donations)],
    ['Number of expenses', f(`COUNTIFS(${typ},"DEBIT",${sta},"COMPLETED")`, data.totals.expenses)],
  ];
  items.forEach(([label, v]) => { const row = sum.addRow([label, { formula: v.formula, result: v.result }]); row.getCell(2).numFmt = v.fmt || '0'; row.getCell(1).font = { bold: true }; });
  sum.addRow([]);
  sum.addRow(['Totals count only COMPLETED transactions. Pending and cancelled ones are listed on the Transactions sheet but not counted.']);
  sum.addRow(['CONFIDENTIAL: this file contains private donor names and phone numbers. Keep it safe and do not publish it.']).font = { bold: true, color: { argb: 'FF8A1F17' } };
  sum.addRow(['Weeks run Saturday to Friday. The first and last week may extend beyond the chosen period; only transactions inside it are counted.']);
  wb.views = [{ activeTab: 0 }];
  return wb.xlsx.writeBuffer();
}

// ---------------------------------------------------------------- PDF
const PDF_MAX_ROWS = 3000;
function buildPdf(data, site) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: 'Financial Report', Author: site.name } });
    doc.registerFont('R', path.join(__dirname, 'fonts', 'NotoSansBengali-Regular.ttf'));
    doc.registerFont('B', path.join(__dirname, 'fonts', 'NotoSansBengali-Bold.ttf'));
    const chunks = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const W = 515, GREEN = '#0b4d3a', ROW = 15;
    const money = (p) => (p < 0 ? '-' : '') + taka(Math.abs(p)).replace('৳', '');
    const fit = (s, w) => { s = String(s ?? ''); if (doc.widthOfString(s) <= w) return s; while (s.length > 1 && doc.widthOfString(s + '…') > w) s = s.slice(0, -1); return s + '…'; };

    // banner
    doc.rect(0, 0, 595, 74).fill(GREEN);
    doc.fillColor('#fff').font('B').fontSize(13).text(site.name, 40, 16, { width: W });
    if (site.name_bn) doc.fillColor('#e6c65a').font('R').fontSize(10).text(site.name_bn, 40, 40, { width: W });
    doc.fillColor(GREEN).font('B').fontSize(17).text('Financial Report', 40, 92);
    doc.fillColor('#333').font('R').fontSize(9).text(`Period: ${data.range.label}`, 40, 116).text(`Generated: ${nowText()}`, 40, 129);

    // summary boxes
    const boxes = [['Total Credit', 'BDT ' + money(data.totals.credit), '#0b5a32'], ['Total Debit', 'BDT ' + money(data.totals.debit), '#8a1f17'], ['Net Balance', 'BDT ' + money(data.totals.net), GREEN], ['Donations / Expenses', `${data.totals.donations} / ${data.totals.expenses}`, '#333']];
    boxes.forEach(([label, value, color], i) => { const x = 40 + i * (W / 4 + 0), w = W / 4 - 8;
      doc.roundedRect(x, 152, w, 46, 6).fill('#f1f6f2'); doc.fillColor('#5b6b65').font('R').fontSize(8).text(label, x + 8, 160, { width: w - 16 });
      doc.fillColor(color).font('B').fontSize(11).text(fit(value, w - 16), x + 8, 175, { lineBreak: false }); });
    doc.fillColor('#5b6b65').font('R').fontSize(7.5).text('Totals count only COMPLETED transactions. Amounts are in Bangladeshi Taka (BDT).', 40, 204);

    // generic table
    const header = (cols, y) => { doc.rect(40, y, W, ROW + 2).fill(GREEN); let x = 40; doc.font('B').fontSize(8).fillColor('#fff');
      cols.forEach((c) => { doc.text(c.label, x + 3, y + 4, { width: c.w - 6, align: c.align || 'left', lineBreak: false }); x += c.w; }); return y + ROW + 2; };
    const table = (title, cols, rows, y) => {
      if (y + 60 > 780) { doc.addPage(); y = 40; }
      doc.fillColor(GREEN).font('B').fontSize(11).text(title, 40, y); y = header(cols, y + 18);
      rows.forEach((r, i) => {
        if (y + ROW > 780) { doc.addPage(); y = header(cols, 40); }
        if (r.total) doc.rect(40, y, W, ROW).fill('#e3ece6'); else if (i % 2) doc.rect(40, y, W, ROW).fill('#f6f8f6');
        let x = 40;
        cols.forEach((c, ci) => { const color = r.colors && r.colors[ci] ? r.colors[ci] : '#222'; doc.fillColor(color).font(r.total ? 'B' : 'R').fontSize(8);
          const s = c.align === 'right' ? String(r.cells[ci]) : fit(r.cells[ci], c.w - 6);
          doc.text(s, x + 3, y + 3.5, { width: c.w - 6, align: c.align || 'left', lineBreak: false }); x += c.w; });
        y += ROW;
      });
      return y + 18;
    };
    const R = 'right', per = (b, label) => ({ cells: [label, money(b.credit), money(b.debit), money(b.net), b.donations, b.expenses] });
    const pcols = (first) => [...first, { label: 'Credit (BDT)', w: 95, align: R }, { label: 'Debit (BDT)', w: 95, align: R }, { label: 'Net (BDT)', w: 95, align: R }, { label: 'Donations', w: 48, align: R }, { label: 'Expenses', w: 48, align: R }];
    let y = 230;
    y = table('Monthly summary', pcols([{ label: 'Month', w: 134 }]), [...data.months.map((b) => per(b, b.label)), { ...per(data.totals, 'TOTAL'), total: true }], y);
    if (data.weeks.length <= 53) y = table('Weekly summary (Saturday to Friday)', pcols([{ label: 'Week', w: 134 }]),
      [...data.weeks.map((b) => per(b, `${fmtDate(b.start)} – ${fmtDate(b.end).slice(0, 6)}`)), { ...per(data.totals, 'TOTAL'), total: true }], y);
    else { doc.fillColor('#5b6b65').font('R').fontSize(8).text('The weekly breakdown is in the Excel export (the period is longer than one year).', 40, y); y += 24; }

    // transactions
    const shown = data.rows.length > PDF_MAX_ROWS ? data.rows.slice(-PDF_MAX_ROWS) : data.rows;
    const tcols = [{ label: 'Date', w: 54 }, { label: 'Transaction ID', w: 82 }, { label: 'Type', w: 36 }, { label: 'Donor / Description', w: 150 }, { label: 'Category', w: 70 }, { label: 'Status', w: 55 }, { label: 'Amount (BDT)', w: 68, align: R }];
    const trs = shown.map((r) => ({ cells: [fmtDate(r.date), r.txn_id, r.type === 'CREDIT' ? 'Credit' : 'Debit',
      r.type === 'CREDIT' ? `${r.donor_name}${r.name_visibility === 'PRIVATE' ? ' (private)' : ''}` : detail(r), r.category || '', r.status === 'COMPLETED' ? 'Completed' : r.status === 'PENDING' ? 'Pending' : 'Cancelled', money(r.amount)],
      colors: { 2: r.type === 'CREDIT' ? '#0b5a32' : '#8a1f17', 6: r.type === 'CREDIT' ? '#0b5a32' : '#8a1f17' } }));
    y = table(`All transactions (${data.rows.length})`, tcols, trs, y);
    if (data.rows.length > PDF_MAX_ROWS) doc.fillColor('#8a1f17').font('R').fontSize(8).text(`Showing the latest ${PDF_MAX_ROWS} of ${data.rows.length} transactions. Use the Excel export for the complete list.`, 40, Math.min(y, 770));

    // footer on every page
    const n = doc.bufferedPageRange().count;
    for (let i = 0; i < n; i++) { doc.switchToPage(i); doc.page.margins.bottom = 0;
      doc.fillColor('#777').font('R').fontSize(7).text(`Confidential: for authorised admins only  ·  ${site.name}  ·  Page ${i + 1} of ${n}`, 40, 812, { width: W, align: 'center', lineBreak: false }); }
    doc.end();
  });
}

module.exports = { exportRange, loadExport, buildXlsx, buildPdf, weekStart };
