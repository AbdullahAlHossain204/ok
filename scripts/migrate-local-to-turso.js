// One-time copy of your existing local database (madrasa.db) into Turso.
//   1. Put TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env
//   2. npm run migrate            (reads ./madrasa.db, or the file named by LOCAL_DB)
require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const { client, remote, ready } = require('../db');
const file = process.env.LOCAL_DB || 'madrasa.db';
if (!remote) { console.error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env first.'); process.exit(1); }
if (!fs.existsSync(file)) { console.error('Local database not found: ' + file); process.exit(1); }
const ORDER = ['settings', 'categories', 'funds', 'donors', 'transactions', 'counters', 'admins']; // parents before children
(async () => {
  await ready();
  const local = new DatabaseSync(file, { readOnly: true });
  for (const t of ORDER) {
    let rows; try { rows = local.prepare(`SELECT * FROM ${t}`).all(); } catch { console.log(t + ': (no such table, skipped)'); continue; }
    if (!rows.length) { console.log(t + ': 0 rows'); continue; }
    const cols = Object.keys(rows[0]);
    const sql = `INSERT OR REPLACE INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`;
    for (let i = 0; i < rows.length; i += 50)
      await client.batch(rows.slice(i, i + 50).map((r) => ({ sql, args: cols.map((c) => (r[c] === undefined ? null : r[c])) })), 'write');
    console.log(t + ': copied ' + rows.length + ' rows');
  }
  console.log('Done. Your data is now in Turso.');
  process.exit(0);
})().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
