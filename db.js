// All money is stored as integer poisha (1 Taka = 100 poisha). No floating point.
// Uses Node's built-in SQLite (no install or compiling needed). Requires Node 22.13+.
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.DB_FILE || 'madrasa.db');
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// Run a function inside a database transaction (all-or-nothing). Safe to nest.
let depth = 0;
const tx = (fn) => (...args) => {
  if (depth) return fn(...args);
  db.exec('BEGIN IMMEDIATE'); depth = 1;
  try { const r = fn(...args); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  finally { depth = 0; }
};

db.exec(`
CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS donors (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('INCOME','EXPENSE')), UNIQUE(name,type));
CREATE TABLE IF NOT EXISTS funds (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, target INTEGER DEFAULT 0, start_date TEXT, end_date TEXT, status TEXT DEFAULT 'ACTIVE');
CREATE TABLE IF NOT EXISTS counters (prefix TEXT, year INTEGER, last INTEGER DEFAULT 0, PRIMARY KEY(prefix,year));
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), name TEXT, address TEXT, phone TEXT, description TEXT, title TEXT);
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
`);
// Settings upgrade: logo is stored inside the database (one file to back up)
const scols = db.prepare('PRAGMA table_info(settings)').all().map((c) => c.name);
if (!scols.includes('logo')) db.exec('ALTER TABLE settings ADD COLUMN logo BLOB');
if (!scols.includes('logo_type')) db.exec('ALTER TABLE settings ADD COLUMN logo_type TEXT');
if (!scols.includes('logo_v')) db.exec('ALTER TABLE settings ADD COLUMN logo_v INTEGER');
db.exec('CREATE INDEX IF NOT EXISTS idx_txn_donor ON transactions(donor_id); CREATE INDEX IF NOT EXISTS idx_txn_fund ON transactions(fund_id); CREATE INDEX IF NOT EXISTS idx_txn_cat ON transactions(category_id);');
// Default categories (only added if missing)
const addCat = db.prepare('INSERT OR IGNORE INTO categories(name,type) VALUES(?,?)');
['General','Building','Student Support','Food','Education','Zakat','Sadaqah'].forEach(n => addCat.run(n, 'INCOME'));
['Electricity','Salary','Food','Maintenance','Books','Other'].forEach(n => addCat.run(n, 'EXPENSE'));
// Unique, gapless IDs like INC-2026-000125 / EXP-2026-000045
const nextTxnId = tx((type, year) => {
  const prefix = type === 'CREDIT' ? 'INC' : 'EXP';
  db.prepare('INSERT OR IGNORE INTO counters(prefix,year,last) VALUES(?,?,0)').run(prefix, year);
  db.prepare('UPDATE counters SET last=last+1 WHERE prefix=? AND year=?').run(prefix, year);
  const { last } = db.prepare('SELECT last FROM counters WHERE prefix=? AND year=?').get(prefix, year);
  return `${prefix}-${year}-${String(last).padStart(6, '0')}`;
});
// Database is the single source of truth for totals.
function totals() {
  const r = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN type='CREDIT' THEN amount END),0) credit,
    COALESCE(SUM(CASE WHEN type='DEBIT' THEN amount END),0) debit,
    COUNT(CASE WHEN type='CREDIT' THEN 1 END) donations
    FROM transactions WHERE status='COMPLETED'`).get();
  return { credit: r.credit, debit: r.debit, balance: r.credit - r.debit, donations: r.donations };
}
module.exports = { db, tx, nextTxnId, totals };
