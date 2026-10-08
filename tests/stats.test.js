const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), path = require('path'), fs = require('fs');
const file = path.join(os.tmpdir(), 'madrasa-stats-' + process.pid + '.db');
process.env.DB_FILE = file;
const { db, nextTxnId } = require('../db');
const app = require('../server');
let server, base;
test.before(async () => {
  db.exec("INSERT INTO donors(name,phone) VALUES('SecretKarim','8801812345678')");
  const c = db.prepare("INSERT INTO transactions(txn_id,type,amount,date,category_id,donor_id,name_visibility,status) VALUES(?,'CREDIT',?,?,?,1,'PRIVATE',?)");
  const d = db.prepare("INSERT INTO transactions(txn_id,type,amount,date,category_id,status) VALUES(?,'DEBIT',?,?,?,?)");
  c.run(nextTxnId('CREDIT', 2025), 1000000, '2025-03-05', 2, 'COMPLETED'); c.run(nextTxnId('CREDIT', 2025), 500000, '2025-03-28', 2, 'COMPLETED');
  c.run(nextTxnId('CREDIT', 2025), 700000, '2025-07-01', 1, 'COMPLETED'); c.run(nextTxnId('CREDIT', 2025), 999999, '2025-03-10', 2, 'PENDING'); // pending: ignored
  c.run(nextTxnId('CREDIT', 2024), 300000, '2024-12-31', 1, 'COMPLETED');                                                                        // other year
  d.run(nextTxnId('DEBIT', 2025), 350000, '2025-03-06', 8, 'COMPLETED'); d.run(nextTxnId('DEBIT', 2025), 111111, '2025-03-07', 8, 'CANCELLED');
  await new Promise((r) => { server = app.listen(0, r); }); base = 'http://localhost:' + server.address().port;
});
test.after(() => { server.close(); try { db.close(); } catch {} for (const s of ['', '-wal', '-shm']) fs.rmSync(file + s, { force: true }); });

test('monthly stats are exact and only count COMPLETED', async () => {
  const s = await (await fetch(base + '/api/public/stats?year=2025')).json();
  assert.equal(s.year, '2025');
  assert.equal(s.months[2].collected, 1500000); assert.equal(s.months[6].collected, 700000); assert.equal(s.months[2].spent, 350000); assert.equal(s.months[0].collected, 0);
  assert.equal(s.totalCollected, 2200000); assert.equal(s.totalSpent, 350000); assert.equal(s.donationCount, 3);
  assert.deepEqual(s.collectedByCategory.map((r) => [r.category, r.amount]), [['Building', 1500000], ['General', 700000]]);
  const other = await (await fetch(base + '/api/public/stats?year=2024')).json();
  assert.equal(other.totalCollected, 300000);
});

test('stats page renders, bad years are safe, and nothing private leaks', async () => {
  const page = await (await fetch(base + '/stats?year=2025')).text();
  assert.ok(page.includes('৳15,000') && page.includes('<svg') && page.includes('Monthly Collection') && page.includes('AJ Limited'));
  assert.equal((await fetch(base + '/stats?year=<script>')).status, 200);
  assert.equal((await (await fetch(base + '/api/public/stats?year=abc')).json()).year, String(new Date().getFullYear()));
  for (const u of ['/stats?year=2025', '/api/public/stats?year=2025', '/']) {
    const t = await (await fetch(base + u)).text();
    for (const secret of ['SecretKarim', '8801812345678', '01812345678']) assert.ok(!t.includes(secret), `${secret} in ${u}`);
  }
});

test('branding: bilingual name, AJ Limited credit, nav link', async () => {
  const t = await (await fetch(base + '/')).text();
  assert.ok(t.includes('Afsharia Darul Ulum Nurani Hafizia Madrasha &amp; Orphanage') && t.includes('আফছারিয়া দারুল উলুম নুরানী হাফিজিয়া এতিমখানা'));
  assert.ok(t.includes('Website powered by <strong>AJ Limited</strong>') && t.includes('href="/stats"'));
});
