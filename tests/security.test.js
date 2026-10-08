const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), path = require('path'), fs = require('fs');
const file = path.join(os.tmpdir(), 'madrasa-sec-' + process.pid + '.db');
process.env.DB_FILE = file; delete process.env.SESSION_SECRET; delete process.env.NODE_ENV; // like a fresh setup with no real secret
const { db } = require('../db');
test.after(() => { try { db.close(); } catch {} for (const s of ['', '-wal', '-shm']) fs.rmSync(file + s, { force: true }); });

test('form tokens survive a server restart even without SESSION_SECRET (dev)', () => {
  const cookie = 'a'.repeat(64);
  const t1 = require('../security').tokenFor(cookie);
  delete require.cache[require.resolve('../security')];           // simulate restart
  const t2 = require('../security').tokenFor(cookie);
  assert.equal(t1, t2);
});

test('form pages are never cached, and an expired form gives a way back', async () => {
  const app = require('../server');
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://localhost:' + server.address().port;
  try {
    const login = await fetch(base + '/admin/login');
    assert.equal(login.headers.get('cache-control'), 'no-store');
    const bad = await fetch(base + '/admin/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', referer: base + '/admin/login' }, body: 'email=a&password=b&_csrf=stale' });
    const html = await bad.text();
    assert.equal(bad.status, 403);
    assert.ok(html.includes('href="/admin/login"') && html.includes('Reload the form') && html.includes('nothing was saved'));
    const evil = await fetch(base + '/admin/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', referer: 'https://evil.example/x' }, body: '_csrf=x' });
    assert.ok(!(await evil.text()).includes('evil.example')); // never links to another site
  } finally { server.close(); }
});
