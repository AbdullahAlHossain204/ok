// Admin: all transactions (credit + debit) in one searchable, filterable, sortable list.
const router = require('express').Router();
const { db } = require('../db');
const { toPoisha, validDate, today, isoDay, OFFSET } = require('../money');

const SORTS = { date: 't.date', amount: 't.amount', id: 't.txn_id', type: 't.type' };
const METHODS = ['Cash', 'bKash', 'Nagad', 'Bank', 'Other'];
const clean = (s, n = 100) => String(s || '').trim().slice(0, n);

function dateRange(range, from, to) {
  const t = today(), d = new Date(t + 'T00:00:00Z');
  if (range === 'today') return [t, t];
  if (range === 'week') { const back = (d.getUTCDay() + 1) % 7; return [isoDay(d.getTime() - back * 864e5), t]; } // week starts Saturday
  if (range === 'month') return [t.slice(0, 8) + '01', t];
  if (range === 'custom') return [validDate(from) ? from : null, validDate(to) ? to : null];
  return [null, null];
}

router.get('/', async (req, res) => {
  const q = req.query, f = {
    q: clean(q.q), type: ['CREDIT', 'DEBIT'].includes(q.type) ? q.type : '',
    range: ['today', 'week', 'month', 'custom'].includes(q.range) ? q.range : '', from: clean(q.from, 10), to: clean(q.to, 10),
    category: parseInt(q.category) || '', method: METHODS.includes(q.method) ? q.method : '',
    status: ['COMPLETED', 'PENDING', 'CANCELLED'].includes(q.status) ? q.status : '',
    min: clean(q.min, 15), max: clean(q.max, 15),
    sort: SORTS[q.sort] ? q.sort : 'date', dir: q.dir === 'asc' ? 'asc' : 'desc',
  };
  const w = [], a = [];
  if (f.q) { w.push('(t.txn_id LIKE ? OR d.name LIKE ? OR d.phone LIKE ? OR t.purpose LIKE ? OR t.description LIKE ?)'); a.push(...Array(5).fill(`%${f.q}%`)); }
  if (f.type) { w.push('t.type=?'); a.push(f.type); }
  const [from, to] = dateRange(f.range, f.from, f.to);
  if (from) { w.push('t.date>=?'); a.push(from); }
  if (to) { w.push('t.date<=?'); a.push(to); }
  if (f.category) { w.push('t.category_id=?'); a.push(f.category); }
  if (f.method) { w.push('t.payment_method=?'); a.push(f.method); }
  if (f.status) { w.push('t.status=?'); a.push(f.status); }
  const min = f.min ? toPoisha(f.min.replace(/,/g, '')) : null, max = f.max ? toPoisha(f.max.replace(/,/g, '')) : null;
  if (min !== null) { w.push('t.amount>=?'); a.push(min); }
  if (max !== null) { w.push('t.amount<=?'); a.push(max); }
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const base = `FROM transactions t LEFT JOIN donors d ON d.id=t.donor_id LEFT JOIN categories c ON c.id=t.category_id ${where}`;
  const page = Math.max(1, parseInt(q.page) || 1), per = 25;
  const total = (await db.prepare(`SELECT COUNT(*) n ${base}`).get(...a)).n;
  const rows = (await db.prepare(`SELECT t.id,t.txn_id,t.type,t.date,t.amount,t.status,t.payment_method,t.purpose,t.description,
      d.name donor_name, d.phone, c.name category ${base}
      ORDER BY ${SORTS[f.sort]} ${f.dir.toUpperCase()}, t.id DESC LIMIT ? OFFSET ?`).all(...a, per, (page - 1) * per));

  // build links that keep the current filters
  const qs = (o = {}) => { const p = new URLSearchParams(); const m = { ...f, page: 1, ...o };
    for (const k of Object.keys(m)) if (m[k] !== '' && m[k] != null && !(k === 'page' && m[k] === 1)) p.set(k, m[k]);
    return '?' + p.toString(); };
  const categories = (await db.prepare("SELECT id, name || CASE type WHEN 'INCOME' THEN ' (Income)' ELSE ' (Expense)' END AS label FROM categories ORDER BY type, name").all());
  res.render('admin/transactions', { rows, f, qs, categories, methods: METHODS, total, pageNo: page, pages: Math.max(1, Math.ceil(total / per)), page: 'Transactions' });
});

module.exports = router;
