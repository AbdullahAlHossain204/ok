// Database layer. One API for both places the data can live:
//   - Turso (cloud, survives redeploys):  set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN
//   - a local file (your own computer):   madrasa.db  (or DB_FILE)
// All money is stored as integer poisha (1 Taka = 100 poisha). No floating point.
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');

const REMOTE = (process.env.TURSO_DATABASE_URL || '').trim();
const client = createClient(REMOTE
  ? { url: REMOTE, authToken: (process.env.TURSO_AUTH_TOKEN || '').trim() || undefined }
  : { url: 'file:' + (process.env.DB_FILE || 'madrasa.db') });

const plain = (rs) => rs.rows.map((r) => { const o = {}; rs.columns.forEach((c, i) => { o[c] = r[i]; }); return o; });
const clean = (a) => a.map((v) => (v === undefined ? null : v));

// Query helpers. `exec` is the client or an open transaction, so the same helpers work in both.
function api(exec) {
  const q = {
    all: async (sql, ...a) => plain(await exec.execute({ sql, args: clean(a) })),
    get: async (sql, ...a) => (await q.all(sql, ...a))[0],
    run: async (sql, ...a) => { const r = await exec.execute({ sql, args: clean(a) }); return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid ?? 0) }; },
    exec: async (sql) => { await exec.executeMultiple(sql); },
    prepare: (sql) => ({ all: (...a) => q.all(sql, ...a), get: (...a) => q.get(sql, ...a), run: (...a) => q.run(sql, ...a) }),
  };
  return q;
}
const db = api(client);

// Run work inside a transaction (all-or-nothing): await db.tx(async (q) => { await q.run(...); ... })
async function tx(fn) {
  const t = await client.transaction('write');
  try { const r = await fn(api(t)); await t.commit(); return r; }
  catch (e) { try { await t.rollback(); } catch { /* ignore */ } throw e; }
  finally { t.close(); }
}

const TABLES = `
CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS donors (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('INCOME','EXPENSE')), UNIQUE(name,type));
CREATE TABLE IF NOT EXISTS funds (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, target INTEGER DEFAULT 0, start_date TEXT, end_date TEXT, status TEXT DEFAULT 'ACTIVE');
CREATE TABLE IF NOT EXISTS counters (prefix TEXT, year INTEGER, last INTEGER DEFAULT 0, PRIMARY KEY(prefix,year));
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), name TEXT, address TEXT, phone TEXT, description TEXT, title TEXT);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY, txn_id TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('CREDIT','DEBIT')),
  amount INTEGER NOT NULL CHECK(amount>0),
  date TEXT NOT NULL, category_id INTEGER REFERENCES categories(id), fund_id INTEGER REFERENCES funds(id),
  donor_id INTEGER REFERENCES donors(id), purpose TEXT, description TEXT, payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(status IN ('COMPLETED','PENDING','CANCELLED')),
  name_visibility TEXT CHECK(name_visibility IN ('PUBLIC','PRIVATE')), note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  CHECK((type='CREDIT' AND donor_id IS NOT NULL AND name_visibility IS NOT NULL) OR (type='DEBIT' AND donor_id IS NULL))
);
`;
const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_txn ON transactions(type,status,date);
CREATE INDEX IF NOT EXISTS idx_txn_donor ON transactions(donor_id);
CREATE INDEX IF NOT EXISTS idx_txn_fund ON transactions(fund_id);
CREATE INDEX IF NOT EXISTS idx_txn_cat ON transactions(category_id);
`;
const REQUIRED = { transactions: ['txn_id', 'type', 'amount', 'date', 'category_id', 'fund_id', 'donor_id', 'purpose', 'description', 'payment_method', 'status', 'name_visibility', 'note'],
  donors: ['name', 'phone'], admins: ['email', 'password_hash'], settings: ['name', 'title', 'description'] };

// Runs once at startup. Only ever ADDS things that are missing; it never deletes or rewrites your records.
async function init() {
  await db.exec(TABLES);
  // Safety check: refuse to run against a database with an unexpected structure instead of corrupting it
  for (const [table, cols] of Object.entries(REQUIRED)) {
    const have = (await db.all(`PRAGMA table_info(${table})`)).map((c) => c.name);
    const missing = cols.filter((c) => !have.includes(c));
    if (missing.length) throw new Error(`The database table "${table}" is missing columns: ${missing.join(', ')}. This database does not look like one created by this app, so the app stopped. Your existing records were not changed.`);
  }
  await db.run("INSERT OR IGNORE INTO settings (id,name,description,title) VALUES (1,'Madrasa','Transparent fund management','Madrasa Fund')");
  await db.exec(INDEXES);
  // Settings upgrade: logo is stored inside the database
  const have = (await db.all('PRAGMA table_info(settings)')).map((c) => c.name);
  for (const [col, type] of [['logo', 'BLOB'], ['logo_type', 'TEXT'], ['logo_v', 'INTEGER'], ['name_bn', 'TEXT'], ['short_name', 'TEXT']])
    if (!have.includes(col)) await db.run(`ALTER TABLE settings ADD COLUMN ${col} ${type}`);
  // New default names (only replaces the untouched defaults, never a name you typed yourself)
  await db.run("UPDATE settings SET name=?, name_bn=?, short_name=?, title=?, description=? WHERE id=1 AND name IN ('Madrasa','Afsharia Darul Ulum Nurani Hafizia Madrasha & Orphanage')",
    'FULTALA AFCHARIA DARUL ULOOM HAFEZIA MADRASHA AND ORPHANAGE', 'ফুলতলা আফছারিয়া দারূল উলূম হাফেজিয়া মাদ্রাসা ও এতিমখানা', 'Fultala Afcharia Madrasha',
    'Fultala Afcharia Madrasha', 'A Hafezia madrasa and orphanage in Fultala, Betagi, Barguna. This website shows every donation received, openly.');
  // Default categories: only for a brand-new database (so categories you renamed or deleted never come back)
  if (!(await db.get('SELECT COUNT(*) n FROM categories')).n) {
    for (const n of ['General', 'Building', 'Student Support', 'Food', 'Education', 'Zakat', 'Sadaqah']) await db.run('INSERT OR IGNORE INTO categories(name,type) VALUES(?,?)', n, 'INCOME');
    for (const n of ['Electricity', 'Salary', 'Food', 'Maintenance', 'Books', 'Other']) await db.run('INSERT OR IGNORE INTO categories(name,type) VALUES(?,?)', n, 'EXPENSE');
  }
  // First admin: created from ADMIN_EMAIL / ADMIN_PASSWORD only when there is no admin at all (never changes an existing admin)
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase(), pass = process.env.ADMIN_PASSWORD || '';
  if (email && pass.length >= 8 && !(await db.get('SELECT COUNT(*) n FROM admins')).n) {
    await db.run('INSERT INTO admins(email,password_hash) VALUES(?,?)', email, bcrypt.hashSync(pass, 12));
    console.log('First admin account created: ' + email);
  }
}
const ready = init();
ready.catch(() => {}); // whoever awaits `ready` still sees the error

// Unique IDs like INC-2026-000125 / EXP-2026-000045 (one atomic statement; pass a transaction `q` to roll it back with the rest)
async function nextTxnId(type, year, q = db) {
  const prefix = type === 'CREDIT' ? 'INC' : 'EXP';
  const r = await q.get('INSERT INTO counters(prefix,year,last) VALUES(?,?,1) ON CONFLICT(prefix,year) DO UPDATE SET last=last+1 RETURNING last', prefix, year);
  return `${prefix}-${year}-${String(r.last).padStart(6, '0')}`;
}

// The database is the single source of truth for totals.
async function totals() {
  const r = await db.get(`SELECT
    COALESCE(SUM(CASE WHEN type='CREDIT' THEN amount END),0) credit,
    COALESCE(SUM(CASE WHEN type='DEBIT' THEN amount END),0) debit,
    COUNT(CASE WHEN type='CREDIT' THEN 1 END) donations
    FROM transactions WHERE status='COMPLETED'`);
  return { credit: r.credit, debit: r.debit, balance: r.credit - r.debit, donations: r.donations };
}

db.tx = tx; db.close = () => client.close(); db.ready = ready; db.isRemote = !!REMOTE;
module.exports = { db, tx, nextTxnId, totals, ready };
