// Saves a full copy of all data as a JSON file:  npm run backup   (creates backups/madrasa-YYYY-MM-DD.json)
// Works with Turso and with the local file. Copy the file somewhere safe (USB drive, Google Drive, email to yourself).
require('dotenv').config();
const fs = require('fs');
const { db } = require('../db');
const TABLES = ['settings', 'categories', 'funds', 'donors', 'transactions', 'counters', 'admins'];
(async () => {
  const out = { exportedAt: new Date().toISOString(), tables: {} };
  for (const t of TABLES) {
    const rows = await db.prepare(`SELECT * FROM ${t}`).all();
    out.tables[t] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof ArrayBuffer ? { base64: Buffer.from(v).toString('base64') } : v])));
  }
  fs.mkdirSync('backups', { recursive: true });
  const name = `backups/madrasa-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(name, JSON.stringify(out));
  console.log('Backup saved: ' + name + ' (' + out.tables.transactions.length + ' transactions). Copy it somewhere safe.');
  process.exit(0);
})().catch((e) => { console.error('Backup failed:', e.message); process.exit(1); });
