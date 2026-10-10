// Guards against broken forms: checks the HTML a browser actually receives (not just the server routes).
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), path = require('path'), fs = require('fs');
const bcrypt = require('bcryptjs');
const file = path.join(os.tmpdir(), 'madrasa-forms-' + process.pid + '.db');
process.env.DB_FILE = file;
const { db } = require('../db');
const app = require('../server');
let server, base; const jar = {};
const send = async (method, p, body) => {
  const headers = { cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ') };
  let b; if (body) { headers['content-type'] = 'application/x-www-form-urlencoded'; b = new URLSearchParams(body).toString(); }
  const r = await fetch(base + p, { method, headers, body: b, redirect: 'manual' });
  for (const sc of r.headers.getSetCookie()) { const kv = sc.split(';')[0], i = kv.indexOf('='); if (kv.slice(i + 1)) jar[kv.slice(0, i)] = kv.slice(i + 1); else delete jar[kv.slice(0, i)]; }
  return { status: r.status, text: await r.text(), loc: r.headers.get('location') };
};
test.before(async () => {
  await db.ready;
  await db.prepare('INSERT INTO admins(email,password_hash) VALUES(?,?)').run('f@t.com', bcrypt.hashSync('GoodPass123', 4));
  await db.exec("INSERT INTO funds(name,target,status) VALUES('Building Fund',100000,'ACTIVE')");
  await new Promise((r) => { server = app.listen(0, r); }); base = 'http://localhost:' + server.address().port;
  const t = (await send('GET', '/admin/login')).text.match(/name="_csrf" value="([^"]+)"/)[1];
  assert.equal((await send('POST', '/admin/login', { _csrf: t, email: 'f@t.com', password: 'GoodPass123' })).status, 302);
});
test.after(() => { server.close(); try { db.close(); } catch {} for (const s of ['', '-wal', '-shm']) fs.rmSync(file + s, { force: true }); });

const PAGES = ['/admin/login', '/admin/donations/new', '/admin/expenses/new', '/admin/funds/new', '/admin/settings', '/admin/funds/1/edit', '/admin/funds/1/delete'];
test('every form on every page is well-formed and carries the security token', async () => {
  for (const p of PAGES) {
    const html = (await send('GET', p)).text;   // login redirects once logged in, so read it logged-out below
    if (p === '/admin/login') continue;
    const forms = html.match(/<form\b[^>]*>(<input[^>]*>)?/g) || [];
    assert.ok(forms.length > 0, p);
    for (const f of forms) {
      if (/method="get"/.test(f)) continue;
      assert.match(f, /^<form method="post" action="\/admin\/[a-z0-9\/]*"[^<>]*><input type="hidden" name="_csrf" value="[a-f0-9]{64}">$/, `${p}: ${f}`);
    }
  }
  const anon = await fetch(base + '/admin/login'); const lh = await anon.text();
  assert.match(lh, /<form method="post" action="\/admin\/login"><input type="hidden" name="_csrf" value="[a-f0-9]{64}">/);
});

test('submitting forms exactly as parsed from the page works (donation, expense, fund, rename)', async () => {
  const submit = async (page, fields) => {
    const html = (await send('GET', page)).text;
    // the page's own form (the header also has a Log out form, which we skip)
    const form = [...html.matchAll(/<form method="post" action="([^"]+)"[^>]*><input type="hidden" name="_csrf" value="([^"]+)">/g)].find((m) => m[1] !== '/admin/logout');
    return send('POST', form[1], { _csrf: form[2], ...fields });
  };
  const d = await submit('/admin/donations/new', { donor_name: 'Md. Rahim', phone: '01712345678', amount: '10000', date: '2026-10-06', category_id: '2', payment_method: 'Cash', name_visibility: 'PUBLIC', status: 'COMPLETED' });
  assert.match(d.loc, /^\/admin\/donations\/\d+\?ok=added/);
  const e = await submit('/admin/expenses/new', { amount: '3500', date: '2026-10-06', category_id: '8', reason: 'Electricity bill', payment_method: 'Cash', status: 'COMPLETED' });
  assert.match(e.loc, /^\/admin\/expenses\/\d+\?ok=expense_added/);
  const f = await submit('/admin/funds/new', { name: 'Food Fund', target: '5000', status: 'ACTIVE' });
  assert.match(f.loc, /fund_added/);
  const r = await submit('/admin/settings', { name: 'Test Madrasa', title: 'Test', description: 'd' });
  assert.match(r.loc, /settings_saved/);
  const cat = (await send('GET', '/admin/settings')).text.match(/<form method="post" action="(\/admin\/settings\/categories\/\d+)"[^>]*><input type="hidden" name="_csrf" value="([^"]+)">/);
  assert.ok(cat, 'rename form found'); assert.match((await send('POST', cat[1], { _csrf: cat[2], name: 'Renamed' })).loc, /cat_renamed/);
});
