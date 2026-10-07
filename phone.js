// Normalizes phone numbers to international digits (no +). Bangladesh: 017XXXXXXXX -> 88017XXXXXXXX
function normalizePhone(input) {
  let p = String(input || '').replace(/[\s\-().]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  else if (p.startsWith('00')) p = p.slice(2);
  if (!/^\d+$/.test(p)) return null;
  if (/^01[3-9]\d{8}$/.test(p)) return '88' + p;       // local BD mobile
  if (/^8801[3-9]\d{8}$/.test(p)) return p;             // BD with country code
  if (/^[1-9]\d{7,14}$/.test(p) && !p.startsWith('880')) return p; // other country
  return null;
}
module.exports = { normalizePhone };
