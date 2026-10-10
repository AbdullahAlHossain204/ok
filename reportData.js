// Report calculations. Only COMPLETED transactions count. All sums are done by the database.
const { db } = require('./db');
const { validDate, today, isoDay, fmtDate } = require('./money');

async function summary(from, to) {
  const r = await db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN type='CREDIT' THEN amount END),0) credit, COALESCE(SUM(CASE WHEN type='DEBIT' THEN amount END),0) debit,
    COUNT(CASE WHEN type='CREDIT' THEN 1 END) donations, COUNT(CASE WHEN type='DEBIT' THEN 1 END) expenses
    FROM transactions WHERE status='COMPLETED' AND date>=? AND date<=?`).get(from, to);
  return { credit: r.credit, debit: r.debit, net: r.credit - r.debit, donations: r.donations, expenses: r.expenses };
}

// 12 monthly totals (Jan..Dec) for a year
async function monthly(year) {
  const credit = Array(12).fill(0), debit = Array(12).fill(0);
  const mrows = await db.prepare(`SELECT CAST(substr(date,6,2) AS INTEGER) m, type, SUM(amount) s FROM transactions
    WHERE status='COMPLETED' AND date>=? AND date<=? GROUP BY m, type`).all(`${year}-01-01`, `${year}-12-31`);
  mrows.forEach((r) => { (r.type === 'CREDIT' ? credit : debit)[r.m - 1] = r.s; });
  return { credit, debit };
}

// Turns the report form values into a date range
function periodRange(q = {}) {
  const t = today();
  const period = ['daily', 'weekly', 'monthly', 'yearly', 'custom'].includes(q.period) ? q.period : 'monthly';
  const date = validDate(q.date) ? q.date : t;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(q.month || '') ? q.month : t.slice(0, 7);
  const year = /^\d{4}$/.test(q.year || '') && q.year >= 2000 && q.year <= 2100 ? q.year : t.slice(0, 4);
  let from, to, label, error = null;
  if (period === 'daily') { from = to = date; label = fmtDate(date); }
  else if (period === 'weekly') {
    const ms = new Date(date + 'T00:00:00Z').getTime(), back = (new Date(ms).getUTCDay() + 1) % 7; // week runs Saturday to Friday
    from = isoDay(ms - back * 864e5); to = isoDay(ms - back * 864e5 + 6 * 864e5); label = `${fmtDate(from)} – ${fmtDate(to)}`;
  } else if (period === 'yearly') { from = `${year}-01-01`; to = `${year}-12-31`; label = year; }
  else if (period === 'custom') {
    if (validDate(q.from) && validDate(q.to) && q.from <= q.to) { from = q.from; to = q.to; label = `${fmtDate(from)} – ${fmtDate(to)}`; }
    else { error = 'Enter a valid date range (the start date must not be after the end date).'; }
  }
  if (!from) {
    const [y, m] = month.split('-').map(Number);
    from = `${month}-01`; to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    label = new Date(from + 'T00:00:00Z').toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  return { period, from, to, label, error, date, month, year };
}

module.exports = { summary, monthly, periodRange };
