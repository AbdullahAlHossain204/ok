// The ONLY place public transaction queries are built.
// Privacy rules enforced here, inside SQL:
//  - phone numbers are never selected or searched
//  - a donor's name is only selected/searched when name_visibility = 'PUBLIC'
//  - notes and admin data are never selected
//  - only COMPLETED transactions are shown
const { db } = require('./db');
const { validDate } = require('./money');

const clean = (s, n = 100) => String(s || '').trim().slice(0, n);

function list({ kind, type, q, from, to, category, page = 1, per = 20 }) {
  const w = ["t.status='COMPLETED'"], a = [];
  const t = kind === 'donations' ? 'CREDIT' : kind === 'expenses' ? 'DEBIT' : (['CREDIT', 'DEBIT'].includes(type) ? type : '');
  if (t) { w.push('t.type=?'); a.push(t); }
  q = clean(q);
  if (q) {
    w.push("(t.txn_id LIKE ? OR c.name LIKE ? OR t.purpose LIKE ? OR t.description LIKE ? OR (t.name_visibility='PUBLIC' AND d.name LIKE ?))");
    a.push(...Array(5).fill(`%${q}%`));
  }
  if (validDate(clean(from, 10))) { w.push('t.date>=?'); a.push(from); }
  if (validDate(clean(to, 10))) { w.push('t.date<=?'); a.push(to); }
  const cat = parseInt(category);
  if (cat) { w.push('t.category_id=?'); a.push(cat); }
  const base = `FROM transactions t LEFT JOIN donors d ON d.id=t.donor_id LEFT JOIN categories c ON c.id=t.category_id WHERE ${w.join(' AND ')}`;
  page = Math.max(1, parseInt(page) || 1);
  const total = db.prepare(`SELECT COUNT(*) n ${base}`).get(...a).n;
  const rows = db.prepare(`SELECT t.txn_id, t.type, t.date, t.amount, c.name AS category,
      CASE WHEN t.type='CREDIT' THEN (CASE WHEN t.name_visibility='PUBLIC' THEN d.name ELSE 'Anonymous Donor' END) END AS display_name,
      CASE WHEN t.type='CREDIT' THEN t.purpose ELSE COALESCE(NULLIF(t.description,''), t.purpose) END AS text
      ${base} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`).all(...a, per, (page - 1) * per);
  return { rows: rows.map(toPublic), total, page, pages: Math.max(1, Math.ceil(total / per)) };
}

// Fixed whitelist of fields that may leave the server
function toPublic(r) {
  return { transactionId: r.txn_id, type: r.type, date: r.date, displayName: r.display_name || null,
           amount: r.amount, category: r.category || null, description: r.text || null };
}

const categories = (kind) => kind === 'transactions'
  ? db.prepare("SELECT id, name || CASE type WHEN 'INCOME' THEN ' (Income)' ELSE ' (Expense)' END AS name FROM categories ORDER BY type, name").all()
  : db.prepare('SELECT id, name FROM categories WHERE type=? ORDER BY name').all(kind === 'donations' ? 'INCOME' : 'EXPENSE');

// Progress % with one decimal, using BigInt so large amounts stay exact. null when no target is set.
const progress = (collected, target) => target > 0 ? Number(BigInt(collected) * 1000n / BigInt(target)) / 10 : null;

const FUND_SQL = `SELECT f.id, f.name, f.description, f.target, f.start_date, f.end_date, f.status,
  COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.fund_id=f.id AND t.type='CREDIT' AND t.status='COMPLETED'),0) AS collected FROM funds f`;
const fundDto = (f) => ({ name: f.name, description: f.description || null, status: f.status, target: f.target, collected: f.collected,
  remaining: Math.max(0, f.target - f.collected), progressPercent: progress(f.collected, f.target), startDate: f.start_date || null, endDate: f.end_date || null });

// Public funds: ACTIVE and COMPLETED only (CLOSED funds are hidden)
const listFunds = () => db.prepare(`${FUND_SQL} WHERE f.status IN ('ACTIVE','COMPLETED') ORDER BY f.status, f.name`).all().map(fundDto);

// Public statistics: aggregate totals only (no donor-level data)
const { monthly, summary } = require('./reportData');
const { today } = require('./money');
function stats(yearIn) {
  const cur = today().slice(0, 4);
  const years = db.prepare("SELECT DISTINCT substr(date,1,4) y FROM transactions WHERE status='COMPLETED' ORDER BY y DESC").all().map((r) => r.y);
  if (!years.includes(cur)) years.unshift(cur);
  years.sort().reverse();
  const year = years.includes(String(yearIn)) ? String(yearIn) : cur;
  const by = (type) => db.prepare(`SELECT c.name, SUM(t.amount) total FROM transactions t JOIN categories c ON c.id=t.category_id
    WHERE t.status='COMPLETED' AND t.type=? AND t.date>=? AND t.date<=? GROUP BY c.id ORDER BY total DESC`).all(type, `${year}-01-01`, `${year}-12-31`);
  return { year, years, monthly: monthly(year), totals: summary(`${year}-01-01`, `${year}-12-31`), income: by('CREDIT'), expense: by('DEBIT') };
}

module.exports = { list, categories, listFunds, progress, FUND_SQL, stats };
