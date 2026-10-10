const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), path = require('path'), fs = require('fs');
const file = path.join(os.tmpdir(), 'madrasa-stats-' + process.pid + '.db');
process.env.DB_FILE = file;
const { db, nextTxnId } = require('../db');
const app = require('../server');
let server, base;
test.before(async () => {
  await db.ready;
  await db.exec("INSERT INTO donors(name,phone) VALUES('SecretKarim','8801812345678')");
  const c = db.prepare("INSERT INTO transactions(txn_id,type,amount,date,category_id,donor_id,name_visibility,status) VALUES(?,'CREDIT',?,?,?,1,'PRIVATE',?)");
  const d = db.prepare("INSERT INTO transactions(txn_id,type,amount,date,category_id,status,purpose,description) VALUES(?,'DEBIT',?,?,?,?,'Secret reason','Secret expense detail')");
  await c.run(await nextTxnId('CREDIT', 2025), 1000000, '2025-03-05', 2, 'COMPLETED'); await c.run(await nextTxnId('CREDIT', 2025), 500000, '2025-03-28', 2, 'COMPLETED');
  await c.run(await nextTxnId('CREDIT', 2025), 700000, '2025-07-01', 1, 'COMPLETED'); await c.run(await nextTxnId('CREDIT', 2025), 999999, '2025-03-10', 2, 'PENDING'); // pending: ignored
  await c.run(await nextTxnId('CREDIT', 2024), 300000, '2024-12-31', 1, 'COMPLETED');                                                                        // other year
  await d.run(await nextTxnId('DEBIT', 2025), 350000, '2025-03-06', 8, 'COMPLETED'); await d.run(await nextTxnId('DEBIT', 2025), 111111, '2025-03-07', 8, 'CANCELLED');
  await new Promise((r) => { server = app.listen(0, r); }); base = 'http://localhost:' + server.address().port;
});
test.after(() => { server.close(); try { db.close(); } catch {} for (const s of ['', '-wal', '-shm']) fs.rmSync(file + s, { force: true }); });

test('monthly stats are exact and only count COMPLETED', async () => {
  const s = await (await fetch(base + '/api/public/stats?year=2025')).json();
  assert.equal(s.year, '2025');
  assert.equal(s.months[2].collected, 1500000); assert.equal(s.months[6].collected, 700000); assert.equal(s.months[2].spent, 350000); assert.equal(s.months[0].collected, 0);
  assert.equal(s.totalCollected, 2200000); assert.equal(s.totalSpent, 350000);
  assert.equal(s.donationCount, undefined); assert.equal(s.spentByCategory, undefined);   // no counts, no expense breakdown
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

test('who donated each month: names only if public, amounts per month, spending as an amount only', async () => {
  await db.exec("INSERT INTO donors(name,phone) VALUES('Md. Rahim','8801712345678')");
  await db.prepare("INSERT INTO transactions(txn_id,type,amount,date,category_id,donor_id,name_visibility,status) VALUES(?,'CREDIT',?,?,2,2,'PUBLIC','COMPLETED')").run(await nextTxnId('CREDIT', 2025), 250000, '2025-03-15');
  const s = await (await fetch(base + '/api/public/stats?year=2025')).json();
  const march = s.months[2];
  assert.equal(march.collected, 1750000); assert.equal(march.spent, 350000);
  const names = march.donors.map((d) => d.displayName + ':' + d.amount).sort();
  assert.deepEqual(names, ['Anonymous Donor:1000000', 'Anonymous Donor:500000', 'Md. Rahim:250000']);
  assert.deepEqual(Object.keys(march.donors[0]).sort(), ['amount', 'date', 'displayName']);
  const page = await (await fetch(base + '/stats?year=2025')).text();
  assert.ok(page.includes('Who donated each month') && page.includes('Md. Rahim') && page.includes('Anonymous Donor') && page.includes('Spent'));
  for (const hidden of ['Secret reason', 'Secret expense detail', 'Electricity', 'SecretKarim', '8801712345678', '8801812345678', 'Donations received']) assert.ok(!page.includes(hidden), hidden);
});

test('branding: new names (English + Bengali), logo, AJ Limited credit, only the allowed tabs', async () => {
  const t = await (await fetch(base + '/')).text();
  assert.ok(t.includes('FULTALA AFCHARIA DARUL ULOOM HAFEZIA MADRASHA AND ORPHANAGE') && t.includes('ফুলতলা আফছারিয়া দারূল উলূম হাফেজিয়া মাদ্রাসা ও এতিমখানা'));
  assert.ok(!t.includes('Afsharia') && !t.includes('আফছারিয়া দারুল'));
  assert.ok(t.includes('Website powered by <strong>AJ Limited</strong>') && t.includes('/img/logo.jpg') && t.includes('og:image'));
  const nav = t.match(/<nav aria-label="Main">(.*?)<\/nav>/s)[1];
  assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), ['/', '/donations', '/stats', '/about']);
  for (const img of ['/img/logo.jpg', '/img/logo-128.png', '/img/logo-256.jpg', '/img/favicon-32.png', '/img/apple-touch-icon.png']) assert.equal((await fetch(base + img)).status, 200, img);
});
