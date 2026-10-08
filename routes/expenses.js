const router = require('express').Router();
const { db, tx, nextTxnId } = require('../db');
const { toPoisha, validDate, today, taka, fmtDate } = require('../money');

const METHODS = ['Cash', 'bKash', 'Nagad', 'Bank', 'Other'];
const cats = async () => (await db.prepare("SELECT id,name FROM categories WHERE type='EXPENSE' ORDER BY name").all());
const load = async (id) => (await db.prepare(`SELECT t.*, c.name AS category FROM transactions t
  LEFT JOIN categories c ON c.id=t.category_id WHERE t.id=? AND t.type='DEBIT'`).get(id));
const notFound = (res) => res.status(404).render('error', { page: 'Not found', msg: 'Expense not found.' });

async function validate(b) {
  const errors = [], v = {};
  v.amount_raw = String(b.amount || '').trim();
  v.amount = toPoisha(v.amount_raw.replace(/,/g, ''));
  if (!v.amount || v.amount <= 0) errors.push('Enter a valid amount greater than zero (up to 2 decimals).');
  v.date = String(b.date || '');
  if (!validDate(v.date)) errors.push('Enter a valid date.');
  v.category_id = Number(b.category_id);
  if (!(await cats()).some((c) => c.id === v.category_id)) errors.push('Choose a category.');
  v.purpose = String(b.reason || '').trim().slice(0, 200);
  if (v.purpose.length < 2) errors.push('Enter the reason for this expense.');
  v.description = String(b.description || '').trim().slice(0, 500);
  v.payment_method = METHODS.includes(b.payment_method) ? b.payment_method : null;
  if (!v.payment_method) errors.push('Choose a payment method.');
  v.status = ['COMPLETED', 'PENDING', 'CANCELLED'].includes(b.status) ? b.status : 'COMPLETED';
  v.note = String(b.note || '').trim().slice(0, 500);
  return { errors, v };
}

const form = async (res, o) => res.status(o.errors && o.errors.length ? 400 : 200).render('admin/expense_form',
  { cats: (await cats()), methods: METHODS, errors: [], ...o });

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100), page = Math.max(1, parseInt(req.query.page) || 1), per = 25;
  const like = `%${q}%`;
  const where = q ? "AND (t.purpose LIKE ? OR t.description LIKE ? OR t.txn_id LIKE ?)" : '';
  const args = q ? [like, like, like] : [];
  const total = (await db.prepare(`SELECT COUNT(*) n FROM transactions t WHERE t.type='DEBIT' ${where}`).get(...args)).n;
  const rows = (await db.prepare(`SELECT t.id,t.txn_id,t.date,t.amount,t.status,t.purpose,t.payment_method,c.name category
    FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
    WHERE t.type='DEBIT' ${where} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`).all(...args, per, (page - 1) * per));
  res.render('admin/expenses', { rows, q, pageNo: page, pages: Math.max(1, Math.ceil(total / per)), total, page: 'Expenses' });
});

router.get('/new', async (req, res) => (await form(res, { page: 'Add Expense', title: 'Add Expense', action: '/admin/expenses',
  v: { amount_raw: '', date: today(), category_id: '', purpose: '', description: '', payment_method: 'Cash', status: 'COMPLETED', note: '' } })));

router.post('/', async (req, res) => {
  const { errors, v } = (await validate(req.body));
  if (errors.length) return (await form(res, { page: 'Add Expense', title: 'Add Expense', action: '/admin/expenses', v, errors }));
  const id = await tx(async () => {
    const txnId = (await nextTxnId('DEBIT', Number(v.date.slice(0, 4))));
    return Number((await db.prepare(`INSERT INTO transactions(txn_id,type,amount,date,category_id,purpose,description,payment_method,status,note)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(txnId, 'DEBIT', v.amount, v.date, v.category_id, v.purpose, v.description, v.payment_method, v.status, v.note)).lastInsertRowid);
  })();
  res.redirect(`/admin/expenses/${id}?ok=expense_added`);
});

router.get('/:id(\\d+)', async (req, res) => {
  const t = (await load(req.params.id));
  if (!t) return notFound(res);
  res.render('admin/expense_view', { t, page: 'Expense ' + t.txn_id });
});

router.get('/:id(\\d+)/edit', async (req, res) => {
  const t = (await load(req.params.id));
  if (!t) return notFound(res);
  (await form(res, { page: 'Edit Expense', title: 'Edit Expense ' + t.txn_id, action: `/admin/expenses/${t.id}`,
    v: { ...t, amount_raw: String(t.amount / 100), purpose: t.purpose || '', description: t.description || '', note: t.note || '' } }));
});
router.post('/:id(\\d+)', async (req, res) => {
  const t = (await load(req.params.id));
  if (!t) return notFound(res);
  const { errors, v } = (await validate(req.body));
  if (errors.length) return (await form(res, { page: 'Edit Expense', title: 'Edit Expense ' + t.txn_id, action: `/admin/expenses/${t.id}`, v, errors }));
  (await db.prepare(`UPDATE transactions SET amount=?,date=?,category_id=?,purpose=?,description=?,payment_method=?,status=?,note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND type='DEBIT'`)
    .run(v.amount, v.date, v.category_id, v.purpose, v.description, v.payment_method, v.status, v.note, t.id));
  res.redirect(`/admin/expenses/${t.id}?ok=expense_updated`);
});

router.get('/:id(\\d+)/delete', async (req, res) => {
  const t = (await load(req.params.id));
  if (!t) return notFound(res);
  res.render('admin/confirm_delete', { label: `${t.txn_id} — ${t.purpose} — ${taka(t.amount)} — ${fmtDate(t.date)}`,
    page: 'Delete', action: `/admin/expenses/${t.id}/delete`, back: `/admin/expenses/${t.id}` });
});
router.post('/:id(\\d+)/delete', async (req, res) => {
  (await db.prepare("DELETE FROM transactions WHERE id=? AND type='DEBIT'").run(req.params.id));
  res.redirect('/admin/expenses?ok=deleted');
});

module.exports = router;
