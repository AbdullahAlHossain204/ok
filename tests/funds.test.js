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

test('public fund API: only COMPLETED donations count, closed funds hidden, no private data', async () => {
  db.exec("INSERT INTO donors(name,phone) VALUES('SecretKarim','8801812345678')");
  db.exec("INSERT INTO funds(name,target,status) VALUES('Building Fund',200000000,'ACTIVE'),('Old Fund',100,'CLOSED'),('Food Fund',0,'ACTIVE')");
  const ins = db.prepare("INSERT INTO transactions(txn_id,type,amount,date,donor_id,name_visibility,status,fund_id) VALUES(?,?,?,?,1,'PRIVATE',?,?)");
  ins.run(nextTxnId('CREDIT', 2026), 'CREDIT', 125000000, '2026-10-06', 'COMPLETED', 1);
  ins.run(nextTxnId('CREDIT', 2026), 'CREDIT', 99999999, '2026-10-06', 'PENDING', 1);
  ins.run(nextTxnId('CREDIT', 2026), 'CREDIT', 5000, '2026-10-06', 'COMPLETED', 3);
  const api = await (await fetch(base + '/api/public/funds')).json();
  assert.equal(api.funds.length, 2);
  const b = api.funds.find((f) => f.name === 'Building Fund');
  assert.deepEqual([b.target, b.collected, b.remaining, b.progressPercent], [200000000, 125000000, 75000000, 62.5]);
  const food = api.funds.find((f) => f.name === 'Food Fund');
  assert.equal(food.progressPercent, null);
  const page = await (await fetch(base + '/funds')).text();
  assert.ok(page.includes('৳20,00,000') && page.includes('৳12,50,000') && page.includes('৳7,50,000') && page.includes('62.5%'));
  assert.ok(!page.includes('Old Fund'));
  const all = page + JSON.stringify(api);
  for (const s of ['SecretKarim', '8801812345678', '01812345678']) assert.ok(!all.includes(s), 'LEAK ' + s);
});
