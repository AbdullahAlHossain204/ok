// Fails if any public page or API ever exposes a phone number, private name, note or admin data.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), path = require('path'), fs = require('fs');
const file = path.join(os.tmpdir(), 'madrasa-privacy-' + process.pid + '.db');
process.env.DB_FILE = file;
process.env.ADMIN_EMAIL = 'secret-admin@example.com';
const { db, nextTxnId } = require('../db');
const app = require('../server');

const SECRETS = ['SecretKarim', '8801812345678', '01812345678', '8801712345678', '01712345678', 'SECRET-NOTE-XYZ', 'secret-admin@example.com', 'password_hash', 'wa.me'];
let server, base;

test.before(async () => {
  db.exec("INSERT INTO donors(name,phone) VALUES('Md. Rahim','8801712345678'),('SecretKarim','8801812345678')");
  const ins = db.prepare('INSERT INTO transactions(txn_id,type,amount,date,category_id,donor_id,purpose,payment_method,status,name_visibility,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  ins.run(nextTxnId('CREDIT', 2026), 'CREDIT', 1000000, '2026-10-06', 2, 1, 'Building Fund', 'Cash', 'COMPLETED', 'PUBLIC', 'SECRET-NOTE-XYZ');
  ins.run(nextTxnId('CREDIT', 2026), 'CREDIT', 500000, '2026-10-06', 2, 2, 'Building Fund', 'bKash', 'COMPLETED', 'PRIVATE', 'SECRET-NOTE-XYZ');
  ins.run(nextTxnId('CREDIT', 2026), 'CREDIT', 99900, '2026-10-06', 2, 2, 'Hidden', 'Cash', 'PENDING', 'PUBLIC', null);
  db.prepare("INSERT INTO transactions(txn_id,type,amount,date,category_id,purpose,description,payment_method,status,note) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(nextTxnId('DEBIT', 2026), 'DEBIT', 350000, '2026-10-06', 8, 'Electricity bill', 'September bill', 'Cash', 'COMPLETED', 'SECRET-NOTE-XYZ');
  await new Promise((r) => { server = app.listen(0, r); });
  base = 'http://localhost:' + server.address().port;
});
test.after(() => { server.close(); try { db.close(); } catch {} for (const s of ['', '-wal', '-shm']) fs.rmSync(file + s, { force: true }); });

const get = async (p) => { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; };
const URLS = ['/', '/donations', '/expenses', '/transactions', '/about', '/api/public/transactions', '/api/public/summary',
  '/funds', '/api/public/funds', '/stats', '/stats?year=2026', '/api/public/stats', '/donations?q=SecretKarim', '/donations?q=01812345678', '/donations?q=8801812', '/transactions?q=Karim', '/api/public/transactions?q=SecretKarim',
  '/api/public/transactions?q=0171', '/transactions?type=CREDIT&page=1', '/expenses?q=bill'];

test('no public page or API leaks private data', async () => {
  for (const u of URLS) {
    let { status, text } = await get(u);
    assert.equal(status, 200, u);
    const q = new URL(base + u).searchParams.get('q'); // the search box just echoes what the visitor typed
    if (q) text = text.split(q).join('');
    for (const s of SECRETS) assert.ok(!text.includes(s), `LEAK: "${s}" found in ${u}`);
  }
});

test('public donor shows name, private shows Anonymous Donor', async () => {
  const { text } = await get('/donations');
  assert.ok(text.includes('Md. Rahim') && text.includes('৳10,000'));
  assert.ok(text.includes('Anonymous Donor') && text.includes('৳5,000'));
  const api = JSON.parse((await get('/api/public/transactions')).text);
  assert.deepEqual(Object.keys(api.items[0]).sort(), ['amount', 'category', 'date', 'description', 'displayName', 'transactionId', 'type']);
});

test('searching a private name or phone finds nothing', async () => {
  for (const q of ['SecretKarim', '01812345678', '8801812345678', '01712345678']) {
    const api = JSON.parse((await get('/api/public/transactions?q=' + q)).text);
    assert.equal(api.total, 0, q);
  }
});

test('only COMPLETED transactions are public; totals are right', async () => {
  const api = JSON.parse((await get('/api/public/transactions')).text);
  assert.equal(api.total, 3); // pending one hidden
  const s = JSON.parse((await get('/api/public/summary')).text);
  assert.deepEqual([s.totalCollection, s.totalExpense, s.balance, s.donationCount], [1500000, 350000, 1150000, 2]);
});

test('admin pages and admin-only data are protected', async () => {
  const r = await fetch(base + '/admin/donors', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.ok(r.headers.get('location').includes('/admin/login'));
  assert.equal((await fetch(base + '/admin/transactions', { redirect: 'manual' })).status, 302);
});
