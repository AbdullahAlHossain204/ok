// All money is stored as integer poisha (1 Taka = 100 poisha). No floating point.
// Database: Turso (hosted SQLite, free plan) when TURSO_DATABASE_URL is set, otherwise a local file (madrasa.db).
// Every query is async:  await db.prepare('SELECT ...').get(a, b)   |   .all(...)   |   .run(...)
const { AsyncLocalStorage } = require('node:async_hooks');
const { createClient } = require('@libsql/client');

const remote = !!process.env.TURSO_DATABASE_URL;
const client = createClient(remote
  ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
  : { url: 'file:' + (process.env.DB_FILE || 'madrasa.db') });

const als = new AsyncLocalStorage(); // holds the open transaction, so queries inside tx() join it automatically

const clean = (args) => args.map((a) => (a === undefined ? null : a));
const toRows = (rs) => rs.rows.map((r) => { const o = {}; rs.columns.forEach((c, i) => { o[c] = r[i]; }); return o; });

let readyPromise;
async function raw(sql, args = []) {
  if (readyPromise) await readyPromise;
  return (als.getStore() || client).execute({ sql, args: clean(args) });
}
const prepare = (sql) => ({
  get: async (...a) => toRows(await raw(sql, a))[0],
  all: async (...a) => toRows(await raw(sql, a)),
  run: async (...a) => { const r = await raw(sql, a); return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid || 0) }; },
});
const exec = async (sql) => { if (readyPromise) await readyPromise; return (als.getStore() || client).executeMultiple(sql); };

// Run a function inside a database transaction (all-or-nothing). Safe to nest.
const tx = (fn) => async (...args) => {
  if (als.getStore()) return fn(...args);
  if (readyPromise) await readyPromise;
  const t = await client.transaction('write');
  try { const r = await als.run(t, () => fn(...args)); await t.commit(); return r; }
  catch (e) { try { await t.rollback(); } catch {} throw e; }
  finally { t.close(); }
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS donors (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('INCOME','EXPENSE')), UNIQUE(name,type));
CREATE TABLE IF NOT EXISTS funds (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, target INTEGER DEFAULT 0, start_date TEXT, end_date TEXT, status TEXT DEFAULT 'ACTIVE');
CREATE TABLE IF NOT EXISTS counters (prefix TEXT, year INTEGER, last INTEGER DEFAULT 0, PRIMARY KEY(prefix,year));
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), name TEXT, address TEXT, phone TEXT, description TEXT, title TEXT, logo BLOB, logo_type TEXT, logo_v INTEGER, name_bn TEXT, short_name TEXT);
INSERT OR IGNORE INTO settings (id,name,description,title) VALUES (1,'Madrasa','Transparent fund management','Madrasa Fund');
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
CREATE INDEX IF NOT EXISTS idx_txn ON transactions(type,status,date);
CREATE INDEX IF NOT EXISTS idx_txn_donor ON transactions(donor_id);
CREATE INDEX IF NOT EXISTS idx_txn_fund ON transactions(fund_id);
CREATE INDEX IF NOT EXISTS idx_txn_cat ON transactions(category_id);
`;

// Runs once at start-up: creates tables, upgrades older databases, adds default categories.
async function init() {
  await client.executeMultiple('PRAGMA foreign_keys = ON;').catch(() => {});
  await client.executeMultiple(SCHEMA);
  // Older databases: add the logo columns if they are missing
  const cols = (await client.execute('PRAGMA table_info(settings)')).rows.map((r) => r[1]);
  for (const [c, t] of [['logo', 'BLOB'], ['logo_type', 'TEXT'], ['logo_v', 'INTEGER'], ['name_bn', 'TEXT'], ['short_name', 'TEXT']])
    if (!cols.includes(c)) await client.execute(`ALTER TABLE settings ADD COLUMN ${c} ${t}`);
  // First-time branding (only while the name is still the default 'Madrasa')
  await client.execute({ sql: "UPDATE settings SET name=?, name_bn=?, short_name=?, title=?, description=? WHERE id=1 AND name='Madrasa'", args: [
    'Afsharia Darul Ulum Nurani Hafizia Madrasha & Orphanage', 'আফছারিয়া দারুল উলুম নুরানী হাফিজিয়া এতিমখানা', 'Afsharia Madrasa',
    'Afsharia Madrasha Fund Transparency',
    'A madrasa and orphanage providing Nurani and Hifz education and care for orphans. This website shows every donation received and every expense paid, openly.'] });
  const cats = [['General', 'INCOME'], ['Building', 'INCOME'], ['Student Support', 'INCOME'], ['Food', 'INCOME'], ['Education', 'INCOME'], ['Zakat', 'INCOME'], ['Sadaqah', 'INCOME'],
    ['Electricity', 'EXPENSE'], ['Salary', 'EXPENSE'], ['Food', 'EXPENSE'], ['Maintenance', 'EXPENSE'], ['Books', 'EXPENSE'], ['Other', 'EXPENSE']];
  await client.batch(cats.map(([name, type]) => ({ sql: 'INSERT OR IGNORE INTO categories(name,type) VALUES(?,?)', args: [name, type] })), 'write');
}
readyPromise = init().then(() => { readyPromise = null; }, (e) => { console.error('Database start-up failed:', e.message); process.exit(1); });
const ready = () => readyPromise || Promise.resolve();

// Unique, gapless IDs like INC-2026-000125 / EXP-2026-000045
const nextTxnId = tx(async (type, year) => {
  const prefix = type === 'CREDIT' ? 'INC' : 'EXP';
  await prepare('INSERT OR IGNORE INTO counters(prefix,year,last) VALUES(?,?,0)').run(prefix, year);
  await prepare('UPDATE counters SET last=last+1 WHERE prefix=? AND year=?').run(prefix, year);
  const { last } = await prepare('SELECT last FROM counters WHERE prefix=? AND year=?').get(prefix, year);
  return `${prefix}-${year}-${String(last).padStart(6, '0')}`;
});
// Database is the single source of truth for totals.
async function totals() {
  const r = await prepare(`SELECT
    COALESCE(SUM(CASE WHEN type='CREDIT' THEN amount END),0) credit,
    COALESCE(SUM(CASE WHEN type='DEBIT' THEN amount END),0) debit,
    COUNT(CASE WHEN type='CREDIT' THEN 1 END) donations
    FROM transactions WHERE status='COMPLETED'`).get();
  return { credit: r.credit, debit: r.debit, balance: r.credit - r.debit, donations: r.donations };
}
const db = { prepare, exec, close: () => client.close(), ready };
module.exports = { db, tx, nextTxnId, totals, client, remote, ready };
