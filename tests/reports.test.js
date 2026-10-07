const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), path = require('path'), fs = require('fs');
const file = path.join(os.tmpdir(), 'madrasa-reports-' + process.pid + '.db');
process.env.DB_FILE = file;
const { db, nextTxnId, totals } = require('../db');
const { summary, monthly, periodRange } = require('../reportData');
test.after(() => { try { db.close(); } catch {} for (const s of ['', '-wal', '-shm']) fs.rmSync(file + s, { force: true }); });

test('period ranges', () => {
  assert.deepEqual([periodRange({ period: 'daily', date: '2026-10-06' }).from, periodRange({ period: 'daily', date: '2026-10-06' }).to], ['2026-10-06', '2026-10-06']);
  const w = periodRange({ period: 'weekly', date: '2026-10-06' }); // Tuesday -> Sat 3 Oct .. Fri 9 Oct
  assert.deepEqual([w.from, w.to], ['2026-10-03', '2026-10-09']);
  const sat = periodRange({ period: 'weekly', date: '2026-10-03' }); assert.deepEqual([sat.from, sat.to], ['2026-10-03', '2026-10-09']);
  const fri = periodRange({ period: 'weekly', date: '2026-10-09' }); assert.deepEqual([fri.from, fri.to], ['2026-10-03', '2026-10-09']);
  assert.equal(periodRange({ period: 'monthly', month: '2028-02' }).to, '2028-02-29'); // leap year
  assert.equal(periodRange({ period: 'monthly', month: '2026-02' }).to, '2026-02-28');
  assert.deepEqual([periodRange({ period: 'yearly', year: '2025' }).from, periodRange({ period: 'yearly', year: '2025' }).to], ['2025-01-01', '2025-12-31']);
  assert.ok(periodRange({ period: 'custom', from: '2026-05-01', to: '2026-01-01' }).error); // reversed
  assert.ok(periodRange({ period: 'custom', from: 'x', to: 'y' }).error);
  assert.equal(periodRange({ period: 'bogus' }).period, 'monthly');
});

test('summary and monthly use only COMPLETED, inclusive of boundary dates', () => {
  db.exec("INSERT INTO donors(name,phone) VALUES('A','8801712345678')");
  const c = db.prepare("INSERT INTO transactions(txn_id,type,amount,date,donor_id,name_visibility,status) VALUES(?,'CREDIT',?,?,1,'PRIVATE',?)");
  const d = db.prepare("INSERT INTO transactions(txn_id,type,amount,date,status) VALUES(?,'DEBIT',?,?,?)");
  c.run(nextTxnId('CREDIT', 2026), 1000000, '2026-10-01', 'COMPLETED');   // first day
  c.run(nextTxnId('CREDIT', 2026), 500000, '2026-10-31', 'COMPLETED');    // last day
  c.run(nextTxnId('CREDIT', 2026), 999999, '2026-10-15', 'PENDING');      // ignored
  c.run(nextTxnId('CREDIT', 2026), 700000, '2026-11-01', 'COMPLETED');    // outside month
  d.run(nextTxnId('DEBIT', 2026), 350000, '2026-10-06', 'COMPLETED');
  d.run(nextTxnId('DEBIT', 2026), 111111, '2026-10-07', 'CANCELLED');     // ignored
  const s = summary('2026-10-01', '2026-10-31');
  assert.deepEqual(s, { credit: 1500000, debit: 350000, net: 1150000, donations: 2, expenses: 1 });
  const m = monthly('2026');
  assert.equal(m.credit[9], 1500000); assert.equal(m.credit[10], 700000); assert.equal(m.debit[9], 350000); assert.equal(m.credit[0], 0);
  const all = summary('2000-01-01', '2100-12-31'), t = totals();
  assert.equal(all.credit, t.credit); assert.equal(all.debit, t.debit); // reports agree with the home page totals
});
