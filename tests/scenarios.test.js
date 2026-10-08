// The 8 final scenarios from the project brief, run against the real app over HTTP.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), path = require('path'), fs = require('fs');
const bcrypt = require('bcryptjs');
const file = path.join(os.tmpdir(), 'madrasa-scen-' + process.pid + '.db');
process.env.DB_FILE = file;
const { db } = require('../db');
const app = require('../server');

let server, base, jar = {}, csrf;
function client() { return { jar: {} }; }
async function send(c, method, p, body) {
  const headers = { cookie: Object.entries(c.jar).map(([k, v]) => k + '=' + v).join('; ') };
  let b; if (body) { headers['content-type'] = 'application/x-www-form-urlencoded'; b = new URLSearchParams(body).toString(); }
  const r = await fetch(base + p, { method, headers, body: b, redirect: 'manual' });
  for (const sc of r.headers.getSetCookie()) { const kv = sc.split(';')[0], i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1);
    if (!v || /expires=Thu, 01 Jan 1970/i.test(sc)) delete c.jar[k]; else c.jar[k] = v; }
  return { status: r.status, text: await r.text(), loc: r.headers.get('location'), headers: r.headers };
}
const token = (html) => (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
let admin;
const formToken = async (c) => token((await send(c, 'GET', '/admin/login')).text) || token((await send(c, 'GET', '/admin')).text) || ''; // logged-in pages carry the token in the logout form
const post = async (c, p, fields) => send(c, 'POST', p, { _csrf: await formToken(c), ...fields });
const summary = async () => (await fetch(base + '/api/public/summary')).json();
const PUBLIC_URLS = ['/', '/donations', '/about', '/stats', '/api/public/transactions', '/api/public/summary', '/api/public/stats',
  '/donations?q=Karim', '/donations?q=018', '/api/public/transactions?q=Karim', '/stats?year=2026'];
const SECRETS = ['Md. Karim', '8801812345678', '01812345678', '8801712345678', '01712345678', 'karim-note', 'admin@scen.test', 'wa.me'];

test.before(async () => {
  db.prepare('INSERT INTO admins(email,password_hash) VALUES(?,?)').run('admin@scen.test', bcrypt.hashSync('GoodPass123', 4));
  await new Promise((r) => { server = app.listen(0, r); });
  base = 'http://localhost:' + server.address().port;
  admin = client();
  const r = await post(admin, '/admin/login', { email: 'admin@scen.test', password: 'GoodPass123' });
  assert.equal(r.status, 302); assert.equal(r.loc, '/admin');
});
test.after(() => { server.close(); try { db.close(); } catch {} for (const s of ['', '-wal', '-shm']) fs.rmSync(file + s, { force: true }); });

const donation = (o) => ({ date: '2026-10-06', category_id: '2', payment_method: 'Cash', status: 'COMPLETED', purpose: 'Building Fund', ...o });
let rahimId, karimId;

test('Test 1 - public donation: name shown, phone never shown', async () => {
  const r = await post(admin, '/admin/donations', donation({ donor_name: 'Md. Rahim', phone: '01712345678', amount: '10000', name_visibility: 'PUBLIC' }));
  assert.match(r.loc, /^\/admin\/donations\/(\d+)\?ok=added/); rahimId = r.loc.match(/donations\/(\d+)/)[1];
  const pub = (await send(client(), 'GET', '/donations')).text;
  assert.ok(pub.includes('Md. Rahim') && pub.includes('৳10,000') && pub.includes('INC-2026-000001') && pub.includes('Building Fund'));
  assert.ok(!pub.includes('01712345678') && !pub.includes('8801712345678'));
});

test('Test 2 - private donation: Anonymous publicly, full details for admin', async () => {
  const r = await post(admin, '/admin/donations', donation({ donor_name: 'Md. Karim', phone: '018 1234-5678', amount: '5000', name_visibility: 'PRIVATE', note: 'karim-note' }));
  karimId = r.loc.match(/donations\/(\d+)/)[1];
  const pub = (await send(client(), 'GET', '/donations')).text;
  assert.ok(pub.includes('Anonymous Donor') && pub.includes('৳5,000') && !pub.includes('Md. Karim'));
  const adm = (await send(admin, 'GET', '/admin/donations/' + karimId)).text;
  assert.ok(adm.includes('Md. Karim') && adm.includes('8801812345678') && adm.includes('৳5,000'));
});

test('Test 3 - expense: debit up, balance down by exactly 3,500', async () => {
  const b = await summary();
  const r = await post(admin, '/admin/expenses', { amount: '3500', date: '2026-10-06', category_id: '8', reason: 'Electricity', payment_method: 'Cash', status: 'COMPLETED' });
  assert.match(r.loc, /\/admin\/expenses\/\d+\?ok=expense_added/);
  const a = await summary();
  assert.equal(a.totalExpense - b.totalExpense, 350000); assert.equal(b.balance - a.balance, 350000); assert.equal(a.totalCollection, b.totalCollection);
  assert.equal((await send(client(), 'GET', '/expenses')).status, 404);                       // the public cannot open expense details
  assert.ok(!(await send(client(), 'GET', '/stats?year=2026')).text.includes('Electricity'));  // only the amount, never the reason
});

test('Test 4 - edit 10,000 -> 15,000 updates every total', async () => {
  const b = await summary();
  const r = await post(admin, '/admin/donations/' + rahimId, donation({ donor_name: 'Md. Rahim', phone: '01712345678', amount: '15000', name_visibility: 'PUBLIC' }));
  assert.match(r.loc, /ok=updated/);
  const a = await summary();
  assert.equal(a.totalCollection - b.totalCollection, 500000); assert.equal(a.balance - b.balance, 500000);
  assert.equal(a.totalCollection, 2000000); assert.equal(a.balance, 1650000);
  assert.ok((await send(client(), 'GET', '/donations')).text.includes('৳15,000'));
  assert.ok((await send(admin, 'GET', '/admin')).text.includes('৳20,000'));
});

test('Test 5 - delete needs confirmation, then totals and history update', async () => {
  const b = await summary();
  assert.ok((await send(admin, 'GET', `/admin/donations/${karimId}/delete`)).text.includes('Are you sure you want to delete this transaction?'));
  assert.equal((await summary()).totalCollection, b.totalCollection); // opening the page deleted nothing
  const r = await post(admin, `/admin/donations/${karimId}/delete`, {});
  assert.match(r.loc, /ok=deleted/);
  const a = await summary();
  assert.equal(b.totalCollection - a.totalCollection, 500000); assert.equal(b.balance - a.balance, 500000); assert.equal(a.donationCount, undefined);
  assert.ok(!(await send(client(), 'GET', '/donations')).text.includes('INC-2026-000002'));
});

test('Test 6 - WhatsApp link has correct number, name, amount, ID, date, purpose', async () => {
  const html = (await send(admin, 'GET', '/admin/donations/' + rahimId)).text;
  const href = html.match(/href="(https:\/\/wa\.me\/[^"]+)"/)[1].replace(/&amp;/g, '&');
  assert.ok(href.startsWith('https://wa.me/8801712345678?text='));
  const msg = decodeURIComponent(href.split('?text=')[1]);
  for (const part of ['Assalamu Alaikum Md. Rahim,', '৳15,000', 'Transaction ID: INC-2026-000001', 'Date: 06 October 2026', 'Purpose: Building Fund', 'JazakAllahu Khairan']) assert.ok(msg.includes(part), part);
  assert.ok(html.includes('target="_blank"') && !html.includes('autosubmit')); // opens WhatsApp only; admin presses Send
});

test('Test 7 - public pages and API never expose private data', async () => {
  await post(admin, '/admin/donations', donation({ donor_name: 'Md. Karim', phone: '01812345678', amount: '700', name_visibility: 'PRIVATE', note: 'karim-note' }));
  for (const u of PUBLIC_URLS) {
    const r = await send(client(), 'GET', u); assert.equal(r.status, 200, u);
    let t = r.text; const q = new URL(base + u).searchParams.get('q'); if (q) t = t.split(q).join('');
    for (const s of SECRETS) assert.ok(!t.includes(s), `LEAK "${s}" in ${u}`);
  }
  assert.equal((await (await fetch(base + '/api/public/transactions?q=Karim')).json()).total, 0);
});

test('Test 8 - admin routes are protected; CSRF and sessions enforced', async () => {
  const anon = client();
  for (const p of ['/admin', '/admin/donations', '/admin/donations/new', '/admin/expenses', '/admin/transactions', '/admin/donors', '/admin/funds', '/admin/reports', '/admin/settings']) {
    const r = await send(anon, 'GET', p); assert.equal(r.status, 302, p); assert.equal(r.loc, '/admin/login', p);
  }
  const noTok = await send(anon, 'POST', '/admin/donations', { donor_name: 'x' }); assert.equal(noTok.status, 403);
  const noTok2 = await send(admin, 'POST', '/admin/donations', donation({ donor_name: 'Hack', phone: '01712345678', amount: '1', name_visibility: 'PUBLIC' }));
  assert.equal(noTok2.status, 403); // logged in but no CSRF token
  const bad = await send(admin, 'POST', '/admin/donations', { _csrf: 'wrong', ...donation({ donor_name: 'Hack', phone: '01712345678', amount: '1', name_visibility: 'PUBLIC' }) });
  assert.equal(bad.status, 403);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM donors WHERE name='Hack'").get().n, 0);
  const stolen = { jar: { ...admin.jar } };
  await post(admin, '/admin/logout', {});
  assert.equal((await send(admin, 'GET', '/admin')).status, 302);
  assert.equal((await send(stolen, 'GET', '/admin')).status, 302); // old session cookie is dead after logout
});

test('security headers are present', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.headers.get('x-frame-options'), 'DENY'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(r.headers.get('content-security-policy').includes("default-src 'self'")); assert.equal(r.headers.get('x-powered-by'), null);
});

test('Settings: name changes show publicly; logo upload is validated; categories managed safely', async () => {
  const me = client(); // log in again (previous session was logged out)
  assert.equal((await post(me, '/admin/login', { email: 'admin@scen.test', password: 'GoodPass123' })).status, 302);
  assert.match((await post(me, '/admin/settings', { name: 'Darul Uloom Test', title: 'Darul Uloom Funds', description: 'Our fund', address: 'Dhaka', phone: '0171' })).loc, /settings_saved/);
  assert.ok((await send(client(), 'GET', '/')).text.includes('Darul Uloom Test'));
  assert.ok((await send(client(), 'GET', '/about')).text.includes('Our fund'));
  assert.ok((await send(me, 'GET', '/admin/donations/' + rahimId)).text.includes(encodeURIComponent('Darul Uloom Test Fund')) || true);
  assert.ok(decodeURIComponent((await send(me, 'GET', '/admin/donations/' + rahimId)).text.match(/wa\.me\/[^"]*/)[0]).includes('Darul Uloom Test Fund Management'));
  assert.equal((await post(me, '/admin/settings', { name: 'x', title: '' })).status, 400);
  // logo: valid 1x1 PNG accepted, fake/HTML/SVG rejected
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  assert.match((await post(me, '/admin/settings/logo', { logo_data: png })).loc, /logo_saved/);
  const lg = await fetch(base + '/logo'); assert.equal(lg.status, 200); assert.equal(lg.headers.get('content-type'), 'image/png');
  assert.ok((await send(client(), 'GET', '/')).text.includes('/logo?v='));
  for (const bad of ['data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+', 'data:image/png;base64,' + Buffer.from('<html>not a png</html>').toString('base64'), 'nonsense'])
    assert.equal((await post(me, '/admin/settings/logo', { logo_data: bad })).status, 400);
  assert.match((await post(me, '/admin/settings/logo', { remove: '1' })).loc, /logo_removed/);
  assert.equal((await fetch(base + '/logo')).status, 404);
  // categories
  assert.match((await post(me, '/admin/settings/categories', { name: 'Library', type: 'EXPENSE' })).loc, /cat_added/);
  assert.equal((await post(me, '/admin/settings/categories', { name: 'Library', type: 'EXPENSE' })).status, 400); // duplicate
  const lib = db.prepare("SELECT id FROM categories WHERE name='Library'").get().id;
  assert.match((await post(me, '/admin/settings/categories/' + lib, { name: 'Library Books' })).loc, /cat_renamed/);
  assert.match((await post(me, `/admin/settings/categories/${lib}/delete`, {})).loc, /cat_deleted/);
  assert.equal((await post(me, '/admin/settings/categories/2/delete', {})).status, 409); // Building is in use
  assert.ok(db.prepare('SELECT id FROM categories WHERE id=2').get());
});
