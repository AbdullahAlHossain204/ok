// WhatsApp confirmation links (V1: plain wa.me deep link, no API, nothing is sent automatically)
const { taka } = require('./money');
const { normalizePhone } = require('./phone');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => { const [y, m, d] = String(iso).split('-'); return `${d} ${MONTHS[m - 1]} ${y}`; };

function buildMessage({ name, amount, txnId, date, purpose, org }) {
  const lines = [
    `Assalamu Alaikum ${name},`,
    `Your donation of ${taka(amount)} has been successfully added to the ${org} Fund.`,
    `Transaction ID: ${txnId}`,
    `Date: ${longDate(date)}`,
  ];
  if (purpose) lines.push(`Purpose: ${purpose}`);
  lines.push('JazakAllahu Khairan for your valuable contribution.', `— ${org} Fund Management`);
  return lines.join('\n');
}

// Returns a wa.me URL, or null if the phone number is not valid
function buildUrl(phone, message) {
  const p = normalizePhone(phone);
  if (!p || !/^\d{8,15}$/.test(p)) return null;
  return `https://wa.me/${p}?text=${encodeURIComponent(message)}`;
}

function donationLink(t, org) {
  return buildUrl(t.phone, buildMessage({ name: t.donor_name, amount: t.amount, txnId: t.txn_id, date: t.date, purpose: t.purpose || t.category, org }));
}

module.exports = { buildMessage, buildUrl, donationLink, longDate };
