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
  await db.exec("INSERT INTO donors(name,phone) VALUES('Md. Rahim','8801712345678'),('SecretKarim','8801812345678')");
  const ins = db.prepare('INSERT INTO transactions(txn_id,type,amount,date,category_id,donor_id,purpose,payment_method,status,name_visibility,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  await ins.run((await nextTxnId('CREDIT', 2026)), 'CREDIT', 1000000, '2026-10-06', 2, 1, 'Building Fund', 'Cash', 'COMPLETED', 'PUBLIC', 'SECRET-NOTE-XYZ');
  await ins.run((await nextTxnId('CREDIT', 2026)), 'CREDIT', 500000, '2026-10-06', 2, 2, 'Building Fund', 'bKash', 'COMPLETED', 'PRIVATE', 'SECRET-NOTE-XYZ');
  await ins.run((await nextTxnId('CREDIT', 2026)), 'CREDIT', 99900, '2026-10-06', 2, 2, 'Hidden', 'Cash', 'PENDING', 'PUBLIC', null);
  (await db.prepare("INSERT INTO transactions(txn_id,type,amount,date,category_id,purpose,description,payment_method,status,note) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run((await nextTxnId('DEBIT', 2026)), 'DEBIT', 350000, '2026-10-06', 8, 'Electricity bill', 'September bill', 'Cash', 'COMPLETED', 'SECRET-NOTE-XYZ'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = 'http://localhost:' + server.address().port;
});
test.after(() => { server.close(); try { db.close(); } catch {} for (const s of ['', '-wal', '-shm']) fs.rmSync(file + s, { force: true }); });

const get = async (p) => { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; };
const URLS = ['/', '/donations', '/about', '/api/public/summary', '/funds', '/api/public/funds', '/donations?q=SecretKarim', '/donations?q=01812345678', '/donations?q=8801812',
  '/donations?page=1'];

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
});

test('searching a private name or phone finds nothing', async () => {
  for (const q of ['SecretKarim', '01812345678', '8801812345678', '01712345678']) {
    const { text } = await get('/donations?q=' + q);
    assert.ok(text.includes('No donations found.'), q);
  }
});

test('only COMPLETED donations are public; expenses are not public at all', async () => {
  const { text } = await get('/donations');
  assert.ok(text.includes('2 record(s)') && !text.includes('Hidden')); // pending one hidden
  const s = JSON.parse((await get('/api/public/summary')).text);
  assert.deepEqual(s, { totalCollection: 1500000, donationCount: 2, currency: 'BDT', unit: 'poisha' });
  for (const u of ['/expenses', '/transactions', '/stats', '/api/public/transactions', '/api/public/stats']) assert.equal((await get(u)).status, 404, u);
  const home = (await get('/')).text;
  assert.ok(!home.includes('Recent Expenses') && !home.includes('Total Expense') && !home.includes('September bill') && !home.includes('Electricity'));
});

test('admin pages and admin-only data are protected', async () => {
  const r = await fetch(base + '/admin/donors', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.ok(r.headers.get('location').includes('/admin/login'));
  assert.equal((await fetch(base + '/admin/transactions', { redirect: 'manual' })).status, 302);
});
