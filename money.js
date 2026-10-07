// Integer poisha <-> display. Uses Bangladeshi lakh/crore grouping: ৳20,00,000
const toPoisha = (s) => { const m = String(s).trim().match(/^(\d{1,12})(?:\.(\d{1,2}))?$/); if (!m) return null; return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || 0); };
const taka = (p) => { const t = Math.floor(p / 100), f = p % 100; let s = String(t);
  if (s.length > 3) s = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
  return '৳' + s + (f ? '.' + String(f).padStart(2, '0') : ''); };
// "2026-10-06" -> "06 Oct 2026"
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtDate = (iso) => { const [y, m, d] = String(iso).split('-'); return `${d} ${MON[m - 1]} ${y}`; };
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

// "Today" in Bangladesh time (UTC+6). Change TZ_OFFSET_HOURS in .env for another timezone.
const OFFSET = Number(process.env.TZ_OFFSET_HOURS ?? 6) * 3600e3;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const today = () => isoDay(Date.now() + OFFSET);

module.exports = { toPoisha, taka, fmtDate, validDate, today, isoDay, OFFSET };
