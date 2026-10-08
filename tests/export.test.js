const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), path = require('path'), fs = require('fs');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const file = path.join(os.tmpdir(), 'madrasa-export-' + process.pid + '.db');
process.env.DB_FILE = file;
const { db, nextTxnId } = require('../db');
const { exportRange, loadExport, buildXlsx, buildPdf, weekStart } = require('../exporter');
const app = require('../server');
const site = { name: 'Test Madrasa', name_bn: 'টেস্ট মাদ্রাসা' };
let server, base; const jar = {};

test.before(async () => {
  (await db.prepare('INSERT INTO admins(email,password_hash) VALUES(?,?)').run('e@t.com', bcrypt.hashSync('GoodPass123', 4)));
  await db.exec("INSERT INTO donors(name,phone) VALUES('Md. Rahim','8801712345678'),('মোঃ করিম','8801812345678')");
  const ins = db.prepare('INSERT INTO transactions(txn_id,type,amount,date,category_id,donor_id,purpose,description,payment_method,status,name_visibility) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const c = async (amt, date, donor, st = 'COMPLETED') => ins.run((await nextTxnId('CREDIT', +date.slice(0, 4))), 'CREDIT', amt, date, 2, donor, 'Building', null, 'Cash', st, 'PRIVATE');
  const d = async (amt, date, st = 'COMPLETED') => ins.run((await nextTxnId('DEBIT', +date.slice(0, 4))), 'DEBIT', amt, date, 8, null, 'Electricity', 'bill', 'Cash', st, null);
  await c(1000000, '2026-09-26', 1); await c(500000, '2026-10-02', 2); await c(2500050, '2026-10-03', 1); await c(99900, '2026-10-04', 1, 'PENDING');
  await d(350000, '2026-10-06'); await d(111100, '2026-10-07', 'CANCELLED'); await c(750000, '2025-12-31', 2); await d(120000, '2025-12-30');
  await new Promise((r) => { server = app.listen(0, r); }); base = 'http://localhost:' + server.address().port;
});
test.after(() => { server.close(); try { db.close(); } catch {} for (const s of ['', '-wal', '-shm']) fs.rmSync(file + s, { force: true }); });

const send = async (method, p, body) => {
  const headers = { cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ') };
  let b; if (body) { headers['content-type'] = 'application/x-www-form-urlencoded'; b = new URLSearchParams(body).toString(); }
  const r = await fetch(base + p, { method, headers, body: b, redirect: 'manual' });
  for (const sc of r.headers.getSetCookie()) { const kv = sc.split(';')[0], i = kv.indexOf('='); if (kv.slice(i + 1)) jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return r;
};

test('totals use only COMPLETED, in exact poisha; weeks run Saturday to Friday; gaps are zero-filled', async () => {
  const d = (await loadExport((await exportRange({}))));
  assert.deepEqual([d.totals.credit, d.totals.debit, d.totals.net, d.totals.donations, d.totals.expenses], [4750050, 470000, 4280050, 4, 2]);
  assert.equal(d.rows.length, 8);                                   // pending + cancelled are listed...
  assert.equal(d.months.length, 11); assert.equal(d.months[1].credit, 0); // Dec 2025 .. Oct 2026, empty months included
  const w = Object.fromEntries(d.weeks.map((x) => [x.start, x]));
  assert.equal(w['2026-09-26'].credit, 1500000);                    // Sat 26 Sep .. Fri 2 Oct (includes Fri 2 Oct)
  assert.equal(w['2026-10-03'].credit, 2500050);                    // Sat 3 Oct starts a new week
  assert.equal(weekStart('2026-10-02'), '2026-09-26'); assert.equal(weekStart('2026-10-03'), '2026-10-03');
  assert.equal(d.months.reduce((s, m) => s + m.credit, 0), d.totals.credit); assert.equal(d.weeks.reduce((s, x) => s + x.debit, 0), d.totals.debit);
});

test('export ranges', async () => {
  assert.equal((await exportRange({ range: 'custom', from: '2026-10-01', to: '2026-10-31' })).title, 'Custom range');
  assert.equal((await exportRange({ range: 'custom', from: 'bad', to: '2026-10-31' })).title, 'All history'); // invalid -> safe default
  assert.equal((await exportRange({ range: 'custom', from: '2026-12-01', to: '2026-01-01' })).title, 'All history');
  const d = (await loadExport((await exportRange({ range: 'custom', from: '2026-10-01', to: '2026-10-31' }))));
  assert.deepEqual([d.totals.credit, d.totals.debit], [3000050, 350000]);
});

test('Excel file: sheets, live formulas, text phones, Bengali preserved', async () => {
  const buf = await buildXlsx((await loadExport((await exportRange({})))), site);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'Monthly', 'Weekly', 'Transactions']);
  const s = wb.getWorksheet('Summary');
  const cell = (addr) => s.getCell(addr).value;
  assert.match(cell('B8').formula, /SUMIFS\(Transactions!.*"CREDIT".*"COMPLETED"\)/); assert.equal(cell('B8').result, 47500.5);
  assert.equal(cell('B9').result, 4700); assert.equal(cell('B10').formula, 'B8-B9'); assert.equal(cell('B10').result, 42800.5);
  const t = wb.getWorksheet('Transactions');
  assert.equal(t.rowCount, 9);                                        // header + all 8 rows incl. pending/cancelled
  const rows = []; t.eachRow((r, i) => i > 1 && rows.push(r.values.slice(1)));
  assert.ok(rows.some((r) => r[10] === 'PENDING') && rows.some((r) => r[10] === 'CANCELLED'));
  assert.ok(rows.every((r) => typeof r[11] === 'number'));
  assert.ok(rows.some((r) => r[3] === 'মোঃ করিম' && r[4] === '8801812345678' && typeof r[4] === 'string'));
  const m = wb.getWorksheet('Monthly'), last = m.getRow(m.rowCount).values;
  assert.equal(last[1], 'TOTAL'); assert.match(last[2].formula, /^SUM\(B2:B\d+\)$/); assert.equal(last[2].result, 47500.5);
  assert.ok(wb.getWorksheet('Weekly').rowCount > 40);
});

test('PDF file is a valid PDF with the report in it', async () => {
  const buf = await buildPdf((await loadExport((await exportRange({})))), site);
  assert.equal(buf.slice(0, 5).toString(), '%PDF-'); assert.ok(buf.length > 5000); assert.ok(buf.slice(-1024).toString('latin1').includes('%%EOF'));
});

test('downloads are admin-only and work over HTTP', async () => {
  for (const u of ['/admin/reports/export.xlsx', '/admin/reports/export.pdf', '/admin/reports/export.xlsx?range=year']) {
    const r = await send('GET', u); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/admin/login', u);
  }
  assert.equal((await send('GET', '/export.xlsx')).status, 404);
  const tok = (await (await send('GET', '/admin/login')).text()).match(/name="_csrf" value="([^"]+)"/)[1];
  assert.equal((await send('POST', '/admin/login', { _csrf: tok, email: 'e@t.com', password: 'GoodPass123' })).status, 302);
  const x = await send('GET', '/admin/reports/export.xlsx');
  assert.equal(x.status, 200); assert.match(x.headers.get('content-type'), /spreadsheetml/); assert.match(x.headers.get('content-disposition'), /attachment; filename="madrasa-report_2025-12-30_to_2026-10-07\.xlsx"/);
  assert.equal(Buffer.from(await x.arrayBuffer()).slice(0, 2).toString(), 'PK');
  const p = await send('GET', '/admin/reports/export.pdf?range=custom&from=2026-10-01&to=2026-10-31');
  assert.equal(p.status, 200); assert.equal(p.headers.get('content-type'), 'application/pdf'); assert.match(p.headers.get('content-disposition'), /2026-10-01_to_2026-10-31\.pdf/);
  assert.equal(Buffer.from(await p.arrayBuffer()).slice(0, 4).toString(), '%PDF');
  assert.equal((await send('GET', '/admin/reports/export.pdf?range=custom&from=zz&to=%3Cscript%3E')).status, 200); // junk input is safe
  assert.ok((await (await send('GET', '/admin/reports')).text()).includes('formaction="/admin/reports/export.pdf"'));
  await send('POST', '/admin/logout', { _csrf: tok });
  assert.equal((await send('GET', '/admin/reports/export.xlsx')).status, 302);   // after logout: blocked again
});
