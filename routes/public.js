const router = require('express').Router();
const { list, categories, stats } = require('../publicData');
const { bars } = require('../charts');
const { totals } = require('../db');

// Public site: donations, statistics and about only. Expense details, transaction history and funds are admin-only.
router.get('/donations', async (req, res) => {
  const f = { q: String(req.query.q || '').trim().slice(0, 100), from: String(req.query.from || '').slice(0, 10), to: String(req.query.to || '').slice(0, 10), category: parseInt(req.query.category) || '' };
  const [r, cats] = await Promise.all([list({ kind: 'donations', ...f, page: req.query.page }), categories('donations')]);
  const qs = (o = {}) => { const p = new URLSearchParams(), m = { ...f, page: 1, ...o };
    for (const k of Object.keys(m)) if (m[k] !== '' && !(k === 'page' && m[k] === 1)) p.set(k, m[k]);
    return '?' + p.toString(); };
  res.render('public_list', { page: 'Donations', h: 'Donations', empty: 'No donations found.', desc: 'Every donation received. Donor names are shown only with permission.',
    kind: 'donations', f, qs, rows: r.rows, total: r.total, pageNo: r.page, pages: r.pages, categories: cats });
});

router.get('/stats', async (req, res) => {
  const st = await stats(req.query.year);
  res.render('stats', { st, page: 'Statistics', desc: 'Monthly collection, who donated each month, and the total spent.',
    chartIn: bars([{ name: 'Collection', color: '#0b4d3a', values: st.monthly.credit }], `Monthly collection ${st.year}`),
    chartOut: bars([{ name: 'Expense', color: '#c9a227', values: st.monthly.debit }], `Monthly expense ${st.year}`) });
});
router.get('/about', (req, res) => res.render('about', { page: 'About', desc: res.locals.site.description }));

// ----- public JSON API (same sanitized data) -----
router.get('/api/public/transactions', async (req, res) => {
  const r = await list({ kind: 'donations', q: req.query.q, from: req.query.from, to: req.query.to, category: req.query.category, page: req.query.page });
  res.set('Cache-Control', 'public, max-age=30').json({ items: r.rows, page: r.page, pages: r.pages, total: r.total });
});
router.get('/api/public/stats', async (req, res) => {
  const st = await stats(req.query.year);
  res.set('Cache-Control', 'public, max-age=30').json({ year: st.year, unit: 'poisha',
    months: st.monthly.credit.map((c, i) => ({ month: i + 1, collected: c, spent: st.monthly.debit[i], donors: st.donors[i] })),
    totalCollected: st.totals.credit, totalSpent: st.totals.debit,
    collectedByCategory: st.income.map((r) => ({ category: r.name, amount: r.total })) });
});
router.get('/api/public/summary', async (req, res) => {
  const t = await totals();
  res.set('Cache-Control', 'public, max-age=30').json({ totalCollection: t.credit, totalExpense: t.debit, balance: t.balance, currency: 'BDT', unit: 'poisha' });
});

module.exports = router;
