const router = require('express').Router();
const { db, tx, nextTxnId } = require('../db');
const { toPoisha, validDate, today, taka, fmtDate } = require('../money');
const { normalizePhone } = require('../phone');

const METHODS = ['Cash', 'bKash', 'Nagad', 'Bank', 'Other'];
const cats = () => db.prepare("SELECT id,name FROM categories WHERE type='INCOME' ORDER BY name").all();
const funds = (keep) => db.prepare("SELECT id,name FROM funds WHERE status='ACTIVE' OR id=? ORDER BY name").all(keep || 0);

const load = (id) => db.prepare(`SELECT t.*, d.name AS donor_name, d.phone, c.name AS category, f.name AS fund
  FROM transactions t JOIN donors d ON d.id=t.donor_id
  LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN funds f ON f.id=t.fund_id
  WHERE t.id=? AND t.type='CREDIT'`).get(id);

function validate(b, keepFund) {
  const errors = [], v = {};
  v.donor_name = String(b.donor_name || '').trim();
  if (v.donor_name.length < 2 || v.donor_name.length > 100) errors.push('Donor name must be 2 to 100 characters.');
  v.phone_raw = String(b.phone || '').trim();
  v.phone = normalizePhone(v.phone_raw);
  if (!v.phone) errors.push('Enter a valid phone number, for example 01712345678.');
  v.amount_raw = String(b.amount || '').trim();
  v.amount = toPoisha(v.amount_raw.replace(/,/g, ''));
  if (!v.amount || v.amount <= 0) errors.push('Enter a valid amount greater than zero (up to 2 decimals).');
  v.date = String(b.date || '');
  if (!validDate(v.date)) errors.push('Enter a valid date.');
  v.purpose = String(b.purpose || '').trim().slice(0, 200);
  v.category_id = Number(b.category_id);
  if (!cats().some((c) => c.id === v.category_id)) errors.push('Choose a category.');
  v.fund_id = b.fund_id ? Number(b.fund_id) : null;
  if (v.fund_id && !funds(keepFund).some((f) => f.id === v.fund_id)) errors.push('Choose a valid fund.');
  v.payment_method = METHODS.includes(b.payment_method) ? b.payment_method : null;
  if (!v.payment_method) errors.push('Choose a payment method.');
  v.name_visibility = ['PUBLIC', 'PRIVATE'].includes(b.name_visibility) ? b.name_visibility : null;
  if (!v.name_visibility) errors.push('Choose name visibility.');
  v.status = ['COMPLETED', 'PENDING', 'CANCELLED'].includes(b.status) ? b.status : 'COMPLETED';
  v.note = String(b.note || '').trim().slice(0, 500);
  return { errors, v };
}

function upsertDonor(name, phone) {
  const d = db.prepare('SELECT id FROM donors WHERE phone=?').get(phone);
  if (d) { db.prepare('UPDATE donors SET name=? WHERE id=?').run(name, d.id); return d.id; }
  return Number(db.prepare('INSERT INTO donors(name,phone) VALUES(?,?)').run(name, phone).lastInsertRowid);
}

const form = (res, o) => res.status(o.errors && o.errors.length ? 400 : 200).render('admin/donation_form',
  { cats: cats(), funds: funds(), methods: METHODS, errors: [], ...o });

// ----- list -----
router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100), page = Math.max(1, parseInt(req.query.page) || 1), per = 25;
  const like = `%${q}%`;
  const where = q ? "AND (d.name LIKE ? OR d.phone LIKE ? OR t.txn_id LIKE ?)" : '';
  const args = q ? [like, like, like] : [];
  const total = db.prepare(`SELECT COUNT(*) n FROM transactions t JOIN donors d ON d.id=t.donor_id WHERE t.type='CREDIT' ${where}`).get(...args).n;
  const rows = db.prepare(`SELECT t.id,t.txn_id,t.date,t.amount,t.status,t.name_visibility,d.name donor_name,d.phone,c.name category
    FROM transactions t JOIN donors d ON d.id=t.donor_id LEFT JOIN categories c ON c.id=t.category_id
    WHERE t.type='CREDIT' ${where} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`).all(...args, per, (page - 1) * per);
  res.render('admin/donations', { rows, q, pageNo: page, pages: Math.max(1, Math.ceil(total / per)), total, page: 'Donations' });
});

// ----- add -----
router.get('/new', (req, res) => form(res, { page: 'Add Donation', title: 'Add Donation', action: '/admin/donations',
  v: { donor_name: '', phone_raw: '', amount_raw: '', date: today(), purpose: '', category_id: '', fund_id: '', payment_method: 'Cash', name_visibility: 'PRIVATE', status: 'COMPLETED', note: '' } }));

router.post('/', (req, res) => {
  const { errors, v } = validate(req.body);
  if (errors.length) return form(res, { page: 'Add Donation', title: 'Add Donation', action: '/admin/donations', v: { ...v, amount_raw: v.amount_raw, phone_raw: v.phone_raw }, errors });
  const id = tx(() => {
    const donorId = upsertDonor(v.donor_name, v.phone);
    const txnId = nextTxnId('CREDIT', Number(v.date.slice(0, 4)));
    return Number(db.prepare(`INSERT INTO transactions(txn_id,type,amount,date,category_id,fund_id,donor_id,purpose,payment_method,status,name_visibility,note)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(txnId, 'CREDIT', v.amount, v.date, v.category_id, v.fund_id, donorId, v.purpose, v.payment_method, v.status, v.name_visibility, v.note).lastInsertRowid);
  })();
  res.redirect(`/admin/donations/${id}?ok=added`);
});

// ----- view -----
router.get('/:id(\\d+)', (req, res) => {
  const t = load(req.params.id);
  if (!t) return res.status(404).render('error', { page: 'Not found', msg: 'Donation not found.' });
  res.render('admin/donation_view', { t, page: 'Donation ' + t.txn_id });
});

// ----- edit -----
router.get('/:id(\\d+)/edit', (req, res) => {
  const t = load(req.params.id);
  if (!t) return res.status(404).render('error', { page: 'Not found', msg: 'Donation not found.' });
  form(res, { page: 'Edit Donation', title: 'Edit Donation ' + t.txn_id, action: `/admin/donations/${t.id}`, isEdit: true, funds: funds(t.fund_id),
    v: { ...t, phone_raw: t.phone, amount_raw: String(t.amount / 100), purpose: t.purpose || '', note: t.note || '', fund_id: t.fund_id || '' } });
});
router.post('/:id(\\d+)', (req, res) => {
  const t = load(req.params.id);
  if (!t) return res.status(404).render('error', { page: 'Not found', msg: 'Donation not found.' });
  const { errors, v } = validate(req.body, t.fund_id);
  if (errors.length) return form(res, { page: 'Edit Donation', title: 'Edit Donation ' + t.txn_id, action: `/admin/donations/${t.id}`, isEdit: true, funds: funds(t.fund_id), v, errors });
  tx(() => {
    const donorId = upsertDonor(v.donor_name, v.phone);
    db.prepare(`UPDATE transactions SET amount=?,date=?,category_id=?,fund_id=?,donor_id=?,purpose=?,payment_method=?,status=?,name_visibility=?,note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND type='CREDIT'`)
      .run(v.amount, v.date, v.category_id, v.fund_id, donorId, v.purpose, v.payment_method, v.status, v.name_visibility, v.note, t.id);
  })();
  res.redirect(`/admin/donations/${t.id}?ok=updated`);
});

// ----- delete (needs confirmation page) -----
router.get('/:id(\\d+)/delete', (req, res) => {
  const t = load(req.params.id);
  if (!t) return res.status(404).render('error', { page: 'Not found', msg: 'Donation not found.' });
  res.render('admin/confirm_delete', { label: `${t.txn_id} — ${t.donor_name} — ${taka(t.amount)} — ${fmtDate(t.date)}`, page: 'Delete', action: `/admin/donations/${t.id}/delete`, back: `/admin/donations/${t.id}` });
});
router.post('/:id(\\d+)/delete', (req, res) => {
  db.prepare("DELETE FROM transactions WHERE id=? AND type='CREDIT'").run(req.params.id);
  res.redirect('/admin/donations?ok=deleted');
});

module.exports = router;
