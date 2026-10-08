const router = require('express').Router();
const { summary, monthly, periodRange } = require('../reportData');
const { bars } = require('../charts');
const { exportRange, loadExport, buildXlsx, buildPdf } = require('../exporter');
const GREEN = '#0b4d3a', GOLD = '#c9a227';

// Admin-only downloads (this router sits behind the admin login)
const fname = (range, ext) => `madrasa-report_${range.from}_to_${range.to}.${ext}`;
router.get('/export.xlsx', async (req, res, next) => {
  try {
    const range = (await exportRange(req.query)), buf = await buildXlsx((await loadExport(range)), res.locals.site);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${fname(range, 'xlsx')}"` }).send(Buffer.from(buf));
  } catch (e) { next(e); }
});
router.get('/export.pdf', async (req, res, next) => {
  try {
    const range = (await exportRange(req.query)), buf = await buildPdf((await loadExport(range)), res.locals.site);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fname(range, 'pdf')}"` }).send(buf);
  } catch (e) { next(e); }
});

router.get('/', async (req, res) => {
  const p = periodRange(req.query);
  const year = p.from.slice(0, 4), m = (await monthly(year));
  res.render('admin/reports', { p, q: req.query, s: (await summary(p.from, p.to)), year, m, page: 'Reports',
    chartBoth: bars([{ name: 'Income', color: GREEN, values: m.credit }, { name: 'Expense', color: GOLD, values: m.debit }], `Income vs expense, ${year}`),
    chartIn: bars([{ name: 'Collection', color: GREEN, values: m.credit }], `Monthly collection, ${year}`),
    chartOut: bars([{ name: 'Expense', color: GOLD, values: m.debit }], `Monthly expense, ${year}`) });
});
module.exports = router;
