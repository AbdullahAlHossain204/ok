// Public site shows donation statistics only (no expenses, transactions or statistics tabs).
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), path = require('path'), fs = require('fs');
const file = path.join(os.tmpdir(), 'madrasa-stats-' + process.pid + '.db');
process.env.DB_FILE = file;
const { db, nextTxnId } = require('../db');
const app = require('../server');
let server, base;
test.before(async () => {
  await db.exec("INSERT INTO donors(name,phone) VALUES('SecretKarim','8801812345678')");
  const c = db.prepare("INSERT INTO transactions(txn_id,type,amount,date,category_id,donor_id,name_visibility,status) VALUES(?,'CREDIT',?,?,?,1,'PRIVATE',?)");
  const d = db.prepare("INSERT INTO transactions(txn_id,type,amount,date,category_id,status) VALUES(?,'DEBIT',?,?,?,?)");
  const y = String(new Date().getFullYear());
  c.run((await nextTxnId('CREDIT', y)), 1000000, y + '-03-05', 2, 'COMPLETED'); c.run((await nextTxnId('CREDIT', y)), 999999, y + '-03-10', 2, 'PENDING'); // pending: ignored
  d.run((await nextTxnId('DEBIT', y)), 350000, y + '-03-06', 8, 'COMPLETED');
  await new Promise((r) => { server = app.listen(0, r); }); base = 'http://localhost:' + server.address().port;
});
test.after(() => { server.close(); try { db.close(); } catch {} for (const s of ['', '-wal', '-shm']) fs.rmSync(file + s, { force: true }); });

test('home shows donation statistics only', async () => {
  const t = await (await fetch(base + '/')).text();
  assert.ok(t.includes('Total Collection') && t.includes('৳10,000') && t.includes('Total Donations') && t.includes('Monthly Collection') && t.includes('<svg') && t.includes('Recent Donations'));
  for (const gone of ['Recent Expenses', 'Total Expense', 'Current Balance', 'Transaction History', 'href="/expenses"', 'href="/transactions"', 'href="/stats"']) assert.ok(!t.includes(gone), gone);
  for (const secret of ['SecretKarim', '8801812345678', '01812345678']) assert.ok(!t.includes(secret), secret);
});

test('expenses, transactions and statistics pages are gone', async () => {
  for (const u of ['/expenses', '/transactions', '/stats', '/api/public/transactions', '/api/public/stats']) assert.equal((await fetch(base + u)).status, 404, u);
});

test('branding: official bilingual name everywhere, AJ Limited credit, only donation tabs', async () => {
  const EN = 'FULTALA AFCHARIA DARUL ULOOM HAFEZIA MADRASHA AND ORPHANAGE', BN = 'ফুলতলা আফছারিয়া দারূল উলূম হাফেজিয়া মাদ্রাসা ও এতিমখানা';
  for (const u of ['/', '/donations', '/funds', '/about']) {
    const t = await (await fetch(base + u)).text();
    assert.ok(t.includes(EN) && t.includes(BN), u);
    assert.ok(!/Afsharia|আফছারিয়া দারুল/.test(t), u);
  }
  const t = await (await fetch(base + '/')).text();
  assert.ok(t.includes('Website powered by <strong>AJ Limited</strong>') && t.includes('href="/donations"') && t.includes('href="/about"'));
});

test('logo appears in header, hero, footer and about once public/logo.png exists', async () => {
  const f = path.join(__dirname, '..', 'public', 'logo.png');
  const saved = fs.existsSync(f) ? fs.readFileSync(f) : null; // keep the real logo if one is installed
  fs.writeFileSync(f, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  try {
    const home = await (await fetch(base + '/')).text();
    assert.ok(home.includes('class="emblem" src="/logo.png"') && home.includes('class="hero-logo"') && home.includes('class="foot-logo"'));
    assert.ok((await (await fetch(base + '/about')).text()).includes('class="about-logo"'));
  } finally { if (saved) fs.writeFileSync(f, saved); else fs.rmSync(f, { force: true }); }
});
