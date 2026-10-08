// Makes a safe copy of the database:  npm run backup   (creates backups/madrasa-YYYY-MM-DD.db)
require('dotenv').config();
const fs = require('fs');
const { db } = require('../db');
fs.mkdirSync('backups', { recursive: true });
const name = `backups/madrasa-${new Date().toISOString().slice(0, 10)}.db`;
fs.rmSync(name, { force: true });
db.exec(`VACUUM INTO '${name}'`);
console.log('Backup saved: ' + name + '  (copy it somewhere safe, e.g. a USB drive or cloud storage)');
