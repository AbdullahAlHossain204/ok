// Makes a safe copy of a LOCAL database file:  npm run backup   (creates backups/madrasa-YYYY-MM-DD.db)
// For a Turso database use the Turso CLI instead:  turso db shell YOUR-DB-NAME .dump > backup.sql
require('dotenv').config();
const fs = require('fs');
const { db } = require('../db');
(async () => {
  if (db.isRemote) { console.log('Your data is in Turso. Back it up with:  turso db shell YOUR-DB-NAME .dump > backup.sql'); await db.close(); return; }
  await db.ready;
  fs.mkdirSync('backups', { recursive: true });
  const name = `backups/madrasa-${new Date().toISOString().slice(0, 10)}.db`;
  fs.rmSync(name, { force: true });
  await db.exec(`VACUUM INTO '${name}'`);
  console.log('Backup saved: ' + name + '  (copy it somewhere safe, e.g. a USB drive or cloud storage)');
  await db.close();
})().catch((e) => { console.error('Backup failed:', e.message); process.exit(1); });
