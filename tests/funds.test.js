const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), path = require('path'), fs = require('fs');
const file = path.join(os.tmpdir(), 'madrasa-funds-' + process.pid + '.db');
process.env.DB_FILE = file;
const { db, nextTxnId } = require('../db');
const { progress } = require('../publicData');
const app = require('../server');
let server, base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = 'http://localhost:' + server.address().port; });
test.after(() => { server.close(); try { db.close(); } catch {} for (const s of ['', '-wal', '-shm']) fs.rmSync(file + s, { force: true }); });

test('progress math is exact (example: 12,50,000 of 20,00,000 = 62.5%)', () => {
  assert.equal(progress(125000000, 200000000), 62.5);
  assert.equal(progress(0, 100), 0);
  assert.equal(progress(5, 0), null);            // no target: no division by zero
  assert.equal(progress(30000, 20000), 150);     // over target
  assert.equal(progress(99999999999999, 99999999999999), 100); // huge numbers stay exact
});

test('public fund pages are removed (funds are managed by admins only)', async () => {
  assert.equal((await fetch(base + '/funds')).status, 404);
  assert.equal((await fetch(base + '/api/public/funds')).status, 404);
});
