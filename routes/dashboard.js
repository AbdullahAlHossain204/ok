const router = require('express').Router();
const { db, totals } = require('../db');
const { summary, monthly, periodRange } = require('../reportData');
const { bars } = require('../charts');
const { today } = require('../money');

const recent = async (type, n) => (await db.prepare(`SELECT t.id,t.txn_id,t.type,t.date,t.amount,t.status,d.name donor_name,COALESCE(NULLIF(t.description,''),t.purpose) text
  FROM transactions t LEFT JOIN donors d ON d.id=t.donor_id ${type ? 'WHERE t.type=?' : ''} ORDER BY t.date DESC, t.id DESC LIMIT ${n}`).all(...(type ? [type] : [])));

router.get('/', async (req, res) => {
  const r = periodRange({ period: 'monthly' }), year = today().slice(0, 4), m = (await monthly(year));
  res.render('admin/dashboard', { t: (await totals()), month: (await summary(r.from, r.to)), monthLabel: r.label, year, page: 'Dashboard',
    donations: (await recent('CREDIT', 5)), expenses: (await recent('DEBIT', 5)), transactions: (await recent(null, 8)),
    chart: bars([{ name: 'Income', color: '#0b4d3a', values: m.credit }, { name: 'Expense', color: '#c9a227', values: m.debit }], `Income vs expense, ${year}`) });
});
module.exports = router;
