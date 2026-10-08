const router = require('express').Router();
const { list, categories, listFunds, stats } = require('../publicData');
const { bars } = require('../charts');
const { totals } = require('../db');

const PAGES = {
  donations: { page: 'Donations', h: 'Donations', empty: 'No donations found.', desc: 'Every donation received. Donor names are shown only with permission.' },
  expenses: { page: 'Expenses', h: 'Expenses', empty: 'No expenses found.', desc: 'Every expense paid from the fund, with category and description.' },
  transactions: { page: 'Transactions', h: 'Transaction History', empty: 'No transactions found.', desc: 'Complete public history of money received and spent.' },
};

for (const kind of Object.keys(PAGES)) {
  router.get('/' + kind, (req, res) => {
    const f = { q: String(req.query.q || '').trim().slice(0, 100), type: ['CREDIT', 'DEBIT'].includes(req.query.type) ? req.query.type : '',
      from: String(req.query.from || '').slice(0, 10), to: String(req.query.to || '').slice(0, 10), category: parseInt(req.query.category) || '' };
    const r = list({ kind, ...f, page: req.query.page });
    const qs = (o = {}) => { const p = new URLSearchParams(), m = { ...f, page: 1, ...o };
      for (const k of Object.keys(m)) if (m[k] !== '' && !(k === 'page' && m[k] === 1)) p.set(k, m[k]);
      return '?' + p.toString(); };
    res.render('public_list', { ...PAGES[kind], kind, f, qs, rows: r.rows, total: r.total, pageNo: r.page, pages: r.pages, categories: categories(kind) });
  });
}

router.get('/funds', (req, res) => res.render('public_funds', { page: 'Funds & Projects', desc: 'Our current funds and projects, with live progress toward each target.', funds: listFunds() }));
router.get('/stats', (req, res) => {
  const st = stats(req.query.year);
  res.render('stats', { st, page: 'Statistics', desc: 'Monthly collection and expenses, with a breakdown by category.',
    chartIn: bars([{ name: 'Collection', color: '#0b4d3a', values: st.monthly.credit }], `Monthly collection ${st.year}`),
    chartOut: bars([{ name: 'Expense', color: '#c9a227', values: st.monthly.debit }], `Monthly expense ${st.year}`) });
});
router.get('/about', (req, res) => res.render('about', { page: 'About', desc: res.locals.site.description }));

// ----- public JSON API (same sanitized data) -----
router.get('/api/public/transactions', (req, res) => {
  const r = list({ kind: 'transactions', ...req.query, q: req.query.q, page: req.query.page });
  res.set('Cache-Control', 'public, max-age=30').json({ items: r.rows, page: r.page, pages: r.pages, total: r.total });
});
router.get('/api/public/funds', (req, res) => res.set('Cache-Control', 'public, max-age=30').json({ funds: listFunds(), unit: 'poisha' }));
router.get('/api/public/stats', (req, res) => {
  const st = stats(req.query.year);
  res.set('Cache-Control', 'public, max-age=30').json({ year: st.year, unit: 'poisha',
    months: st.monthly.credit.map((c, i) => ({ month: i + 1, collected: c, spent: st.monthly.debit[i] })),
    totalCollected: st.totals.credit, totalSpent: st.totals.debit, donationCount: st.totals.donations,
    collectedByCategory: st.income.map((r) => ({ category: r.name, amount: r.total })), spentByCategory: st.expense.map((r) => ({ category: r.name, amount: r.total })) });
});
router.get('/api/public/summary', (req, res) => {
  const t = totals();
  res.set('Cache-Control', 'public, max-age=30').json({ totalCollection: t.credit, totalExpense: t.debit, balance: t.balance, donationCount: t.donations, currency: 'BDT', unit: 'poisha' });
});

module.exports = router;
