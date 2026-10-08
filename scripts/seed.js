// Creates (or updates) the admin from .env.  Run:  npm run seed
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const pass = process.env.ADMIN_PASSWORD || '';
if (!email || pass.length < 8 || pass === 'choose-a-strong-password') {
  console.error('Set ADMIN_EMAIL and a real ADMIN_PASSWORD (8+ characters) in .env first.'); process.exit(1);
}
(async () => {
  const hash = bcrypt.hashSync(pass, 12);
  await db.prepare(`INSERT INTO admins(email,password_hash) VALUES(?,?)
              ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash`).run(email, hash);
  console.log('Admin ready: ' + email);
  process.exit(0);
})().catch((e) => { console.error('Could not create the admin:', e.message); process.exit(1); });
