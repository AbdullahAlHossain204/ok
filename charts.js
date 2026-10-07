// Simple server-drawn SVG bar charts (no external libraries, work offline).
const { taka } = require('./money');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const short = (p) => { const t = p / 100;
  if (t >= 1e7) return +(t / 1e7).toFixed(1) + ' Cr'; if (t >= 1e5) return +(t / 1e5).toFixed(1) + ' L'; if (t >= 1e3) return +(t / 1e3).toFixed(1) + 'K'; return String(Math.round(t)); };

function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }

// series: [{ name, color, values: [12 numbers in poisha] }]
function bars(series, title) {
  const W = 720, H = 300, L = 56, R = 12, T = 16, B = 32, pw = W - L - R, ph = H - T - B;
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const top = niceMax(max), gw = pw / 12, bw = (gw * 0.72) / series.length;
  let g = '';
  for (let i = 0; i <= 4; i++) { const y = T + ph - (ph * i) / 4;
    g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#d9dfdb"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="#5b6b65">${short((top * i) / 4)}</text>`; }
  MONTHS.forEach((m, i) => { g += `<text x="${L + gw * i + gw / 2}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#5b6b65">${m}</text>`; });
  series.forEach((s, si) => s.values.forEach((v, i) => { if (!v) return; const h = (ph * v) / top, x = L + gw * i + gw * 0.14 + bw * si;
    g += `<rect x="${x.toFixed(1)}" y="${(T + ph - h).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${s.color}"><title>${MONTHS[i]} – ${s.name}: ${taka(v)}</title></rect>`; }));
  if (!max) g += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#5b6b65">No data for this year</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}" class="chart">${g}</svg>`;
}

module.exports = { bars };
