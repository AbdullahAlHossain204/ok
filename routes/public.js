const router = require('express').Router();
const { list, categories, listFunds } = require('../publicData');
const { totals } = require('../db');

const PAGES = {
  donations: { page: 'Donations', h: 'Donations', empty: 'No donations found.', desc: 'Every donation received. Donor names are shown only with permission.' },
};

for (const kind of Object.keys(PAGES)) {
  router.get('/' + kind, async (req, res) => {
    const f = { q: String(req.query.q || '').trim().slice(0, 100), type: ['CREDIT', 'DEBIT'].includes(req.query.type) ? req.query.type : '',
      from: String(req.query.from || '').slice(0, 10), to: String(req.query.to || '').slice(0, 10), category: parseInt(req.query.category) || '' };
    const r = (await list({ kind, ...f, page: req.query.page }));
    const qs = (o = {}) => { const p = new URLSearchParams(), m = { ...f, page: 1, ...o };
      for (const k of Object.keys(m)) if (m[k] !== '' && !(k === 'page' && m[k] === 1)) p.set(k, m[k]);
      return '?' + p.toString(); };
    res.render('public_list', { ...PAGES[kind], kind, f, qs, rows: r.rows, total: r.total, pageNo: r.page, pages: r.pages, categories: (await categories(kind)) });
  });
}

router.get('/funds', async (req, res) => res.render('public_funds', { page: 'Funds & Projects', desc: 'Our current funds and projects, with live progress toward each target.', funds: (await listFunds()) }));
router.get('/about', async (req, res) => res.render('about', { page: 'About', desc: res.locals.site.description }));

// ----- public JSON API (same sanitized data) -----
router.get('/api/public/funds', async (req, res) => res.set('Cache-Control', 'public, max-age=30').json({ funds: (await listFunds()), unit: 'poisha' }));
router.get('/api/public/summary', async (req, res) => {
  const t = (await totals());
  res.set('Cache-Control', 'public, max-age=30').json({ totalCollection: t.credit, donationCount: t.donations, currency: 'BDT', unit: 'poisha' });
});

module.exports = router;
