const router = require('express').Router();
const { db, tx, nextTxnId } = require('../db');
const { toPoisha, validDate, today, taka, fmtDate } = require('../money');
const { normalizePhone } = require('../phone');

const METHODS = ['Cash', 'bKash', 'Nagad', 'Bank', 'Other'];
const cats = async () => (await db.prepare("SELECT id,name FROM categories WHERE type='INCOME' ORDER BY name").all());
const funds = async (keep) => (await db.prepare("SELECT id,name FROM funds WHERE status='ACTIVE' OR id=? ORDER BY name").all(keep || 0));

const load = async (id) => (await db.prepare(`SELECT t.*, d.name AS donor_name, d.phone, c.name AS category, f.name AS fund
  FROM transactions t JOIN donors d ON d.id=t.donor_id
  LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN funds f ON f.id=t.fund_id
  WHERE t.id=? AND t.type='CREDIT'`).get(id));

async function validate(b, keepFund) {
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
  if (!(await cats()).some((c) => c.id === v.category_id)) errors.push('Choose a category.');
  v.fund_id = b.fund_id ? Number(b.fund_id) : null;
  if (v.fund_id && !(await funds(keepFund)).some((f) => f.id === v.fund_id)) errors.push('Choose a valid fund.');
  v.payment_method = METHODS.includes(b.payment_method) ? b.payment_method : null;
  if (!v.payment_method) errors.push('Choose a payment method.');
  v.name_visibility = ['PUBLIC', 'PRIVATE'].includes(b.name_visibility) ? b.name_visibility : null;
  if (!v.name_visibility) errors.push('Choose name visibility.');
  v.status = ['COMPLETED', 'PENDING', 'CANCELLED'].includes(b.status) ? b.status : 'COMPLETED';
  v.note = String(b.note || '').trim().slice(0, 500);
  return { errors, v };
}

async function upsertDonor(name, phone) {
  const d = (await db.prepare('SELECT id FROM donors WHERE phone=?').get(phone));
  if (d) { (await db.prepare('UPDATE donors SET name=? WHERE id=?').run(name, d.id)); return d.id; }
  return Number((await db.prepare('INSERT INTO donors(name,phone) VALUES(?,?)').run(name, phone)).lastInsertRowid);
}

const form = async (res, o) => res.status(o.errors && o.errors.length ? 400 : 200).render('admin/donation_form',
  { cats: (await cats()), funds: (await funds()), methods: METHODS, errors: [], ...o });

// ----- list -----
router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100), page = Math.max(1, parseInt(req.query.page) || 1), per = 25;
  const like = `%${q}%`;
  const where = q ? "AND (d.name LIKE ? OR d.phone LIKE ? OR t.txn_id LIKE ?)" : '';
  const args = q ? [like, like, like] : [];
  const total = (await db.prepare(`SELECT COUNT(*) n FROM transactions t JOIN donors d ON d.id=t.donor_id WHERE t.type='CREDIT' ${where}`).get(...args)).n;
  const rows = (await db.prepare(`SELECT t.id,t.txn_id,t.date,t.amount,t.status,t.name_visibility,d.name donor_name,d.phone,c.name category
    FROM transactions t JOIN donors d ON d.id=t.donor_id LEFT JOIN categories c ON c.id=t.category_id
    WHERE t.type='CREDIT' ${where} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`).all(...args, per, (page - 1) * per));
  res.render('admin/donations', { rows, q, pageNo: page, pages: Math.max(1, Math.ceil(total / per)), total, page: 'Donations' });
});

// ----- add -----
router.get('/new', async (req, res) => (await form(res, { page: 'Add Donation', title: 'Add Donation', action: '/admin/donations',
  v: { donor_name: '', phone_raw: '', amount_raw: '', date: today(), purpose: '', category_id: '', fund_id: '', payment_method: 'Cash', name_visibility: 'PRIVATE', status: 'COMPLETED', note: '' } })));

router.post('/', async (req, res) => {
  const { errors, v } = (await validate(req.body));
  if (errors.length) return (await form(res, { page: 'Add Donation', title: 'Add Donation', action: '/admin/donations', v: { ...v, amount_raw: v.amount_raw, phone_raw: v.phone_raw }, errors }));
  const id = await tx(async () => {
    const donorId = (await upsertDonor(v.donor_name, v.phone));
    const txnId = (await nextTxnId('CREDIT', Number(v.date.slice(0, 4))));
    return Number((await db.prepare(`INSERT INTO transactions(txn_id,type,amount,date,category_id,fund_id,donor_id,purpose,payment_method,status,name_visibility,note)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(txnId, 'CREDIT', v.amount, v.date, v.category_id, v.fund_id, donorId, v.purpose, v.payment_method, v.status, v.name_visibility, v.note)).lastInsertRowid);
  })();
  res.redirect(`/admin/donations/${id}?ok=added`);
});

// ----- view -----
router.get('/:id(\\d+)', async (req, res) => {
  const t = (await load(req.params.id));
  if (!t) return res.status(404).render('error', { page: 'Not found', msg: 'Donation not found.' });
  res.render('admin/donation_view', { t, page: 'Donation ' + t.txn_id });
});

// ----- edit -----
router.get('/:id(\\d+)/edit', async (req, res) => {
  const t = (await load(req.params.id));
  if (!t) return res.status(404).render('error', { page: 'Not found', msg: 'Donation not found.' });
  (await form(res, { page: 'Edit Donation', title: 'Edit Donation ' + t.txn_id, action: `/admin/donations/${t.id}`, isEdit: true, funds: (await funds(t.fund_id)),
    v: { ...t, phone_raw: t.phone, amount_raw: String(t.amount / 100), purpose: t.purpose || '', note: t.note || '', fund_id: t.fund_id || '' } }));
});
router.post('/:id(\\d+)', async (req, res) => {
  const t = (await load(req.params.id));
  if (!t) return res.status(404).render('error', { page: 'Not found', msg: 'Donation not found.' });
  const { errors, v } = (await validate(req.body, t.fund_id));
  if (errors.length) return (await form(res, { page: 'Edit Donation', title: 'Edit Donation ' + t.txn_id, action: `/admin/donations/${t.id}`, isEdit: true, funds: (await funds(t.fund_id)), v, errors }));
  await tx(async () => {
    const donorId = (await upsertDonor(v.donor_name, v.phone));
    (await db.prepare(`UPDATE transactions SET amount=?,date=?,category_id=?,fund_id=?,donor_id=?,purpose=?,payment_method=?,status=?,name_visibility=?,note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND type='CREDIT'`)
      .run(v.amount, v.date, v.category_id, v.fund_id, donorId, v.purpose, v.payment_method, v.status, v.name_visibility, v.note, t.id));
  })();
  res.redirect(`/admin/donations/${t.id}?ok=updated`);
});

// ----- delete (needs confirmation page) -----
router.get('/:id(\\d+)/delete', async (req, res) => {
  const t = (await load(req.params.id));
  if (!t) return res.status(404).render('error', { page: 'Not found', msg: 'Donation not found.' });
  res.render('admin/confirm_delete', { label: `${t.txn_id} — ${t.donor_name} — ${taka(t.amount)} — ${fmtDate(t.date)}`, page: 'Delete', action: `/admin/donations/${t.id}/delete`, back: `/admin/donations/${t.id}` });
});
router.post('/:id(\\d+)/delete', async (req, res) => {
  (await db.prepare("DELETE FROM transactions WHERE id=? AND type='CREDIT'").run(req.params.id));
  res.redirect('/admin/donations?ok=deleted');
});

module.exports = router;
