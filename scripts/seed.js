// Creates (or updates) the admin from .env.  Run:  npm run seed
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const pass = process.env.ADMIN_PASSWORD || '';
if (!email || pass.length < 8 || pass === 'choose-a-strong-password') {
  console.error('Set ADMIN_EMAIL and a real ADMIN_PASSWORD (8+ characters) in .env first.'); process.exit(1);
}
const hash = bcrypt.hashSync(pass, 12);
(async () => {
  await db.ready;
  await db.run(`INSERT INTO admins(email,password_hash) VALUES(?,?)
                ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash`, email, hash);
  console.log('Admin ready: ' + email + (db.isRemote ? '  (saved in your Turso database)' : ''));
  await db.close();
})().catch((e) => { console.error('Could not save the admin:', e.message); process.exit(1); });
