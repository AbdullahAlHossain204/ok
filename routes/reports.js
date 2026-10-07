const router = require('express').Router();
const { summary, monthly, periodRange } = require('../reportData');
const { bars } = require('../charts');
const GREEN = '#0b4d3a', GOLD = '#c9a227';

router.get('/', (req, res) => {
  const p = periodRange(req.query);
  const year = p.from.slice(0, 4), m = monthly(year);
  res.render('admin/reports', { p, q: req.query, s: summary(p.from, p.to), year, m, page: 'Reports',
    chartBoth: bars([{ name: 'Income', color: GREEN, values: m.credit }, { name: 'Expense', color: GOLD, values: m.debit }], `Income vs expense, ${year}`),
    chartIn: bars([{ name: 'Collection', color: GREEN, values: m.credit }], `Monthly collection, ${year}`),
    chartOut: bars([{ name: 'Expense', color: GOLD, values: m.debit }], `Monthly expense, ${year}`) });
});
module.exports = router;
