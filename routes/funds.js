const router = require('express').Router();
const { db } = require('../db');
const { toPoisha, validDate, taka } = require('../money');
const { progress, FUND_SQL } = require('../publicData');

const STATUSES = ['ACTIVE', 'COMPLETED', 'CLOSED'];
const get = (id) => db.prepare(`${FUND_SQL} WHERE f.id=?`).get(id);
const notFound = (res) => res.status(404).render('error', { page: 'Not found', msg: 'Fund not found.' });

function validate(b, id) {
  const errors = [], v = {};
  v.name = String(b.name || '').trim();
  if (v.name.length < 2 || v.name.length > 100) errors.push('Fund name must be 2 to 100 characters.');
  else if (db.prepare('SELECT id FROM funds WHERE name=? AND id<>?').get(v.name, id || 0)) errors.push('A fund with this name already exists.');
  v.description = String(b.description || '').trim().slice(0, 500);
  v.target_raw = String(b.target || '').trim();
  v.target = v.target_raw ? toPoisha(v.target_raw.replace(/,/g, '')) : 0;
  if (v.target === null) errors.push('Enter a valid target amount, or leave it blank for no target.');
  v.start_date = String(b.start_date || ''); v.end_date = String(b.end_date || '');
  if (v.start_date && !validDate(v.start_date)) errors.push('Enter a valid start date.');
  if (v.end_date && !validDate(v.end_date)) errors.push('Enter a valid end date.');
  if (v.start_date && v.end_date && v.end_date < v.start_date) errors.push('End date cannot be before the start date.');
  v.status = STATUSES.includes(b.status) ? b.status : 'ACTIVE';
  return { errors, v };
}
const form = (res, o) => res.status(o.errors && o.errors.length ? 400 : 200).render('admin/fund_form', { statuses: STATUSES, errors: [], ...o });

router.get('/', (req, res) => {
  const rows = db.prepare(`${FUND_SQL} ORDER BY CASE f.status WHEN 'ACTIVE' THEN 0 WHEN 'COMPLETED' THEN 1 ELSE 2 END, f.name`).all()
    .map((f) => ({ ...f, pct: progress(f.collected, f.target) }));
  res.render('admin/funds', { rows, page: 'Funds' });
});

router.get('/new', (req, res) => form(res, { page: 'Add Fund', title: 'Add Fund', action: '/admin/funds',
  v: { name: '', description: '', target_raw: '', start_date: '', end_date: '', status: 'ACTIVE' } }));
router.post('/', (req, res) => {
  const { errors, v } = validate(req.body);
  if (errors.length) return form(res, { page: 'Add Fund', title: 'Add Fund', action: '/admin/funds', v, errors });
  db.prepare('INSERT INTO funds(name,description,target,start_date,end_date,status) VALUES(?,?,?,?,?,?)')
    .run(v.name, v.description, v.target, v.start_date || null, v.end_date || null, v.status);
  res.redirect('/admin/funds?ok=fund_added');
});

router.get('/:id(\\d+)/edit', (req, res) => {
  const f = get(req.params.id);
  if (!f) return notFound(res);
  form(res, { page: 'Edit Fund', title: 'Edit Fund', action: `/admin/funds/${f.id}`,
    v: { ...f, description: f.description || '', target_raw: f.target ? String(f.target / 100) : '', start_date: f.start_date || '', end_date: f.end_date || '' } });
});
router.post('/:id(\\d+)', (req, res) => {
  const f = get(req.params.id);
  if (!f) return notFound(res);
  const { errors, v } = validate(req.body, f.id);
  if (errors.length) return form(res, { page: 'Edit Fund', title: 'Edit Fund', action: `/admin/funds/${f.id}`, v, errors });
  db.prepare('UPDATE funds SET name=?,description=?,target=?,start_date=?,end_date=?,status=? WHERE id=?')
    .run(v.name, v.description, v.target, v.start_date || null, v.end_date || null, v.status, f.id);
  res.redirect('/admin/funds?ok=fund_updated');
});

// Delete: only allowed when no donation uses the fund (otherwise suggest closing it)
const confirm = (res, f, error) => res.render('admin/confirm_delete', { label: `${f.name} — target ${taka(f.target)}`, page: 'Delete fund',
  action: `/admin/funds/${f.id}/delete`, back: '/admin/funds', error });
const used = (id) => db.prepare('SELECT COUNT(*) n FROM transactions WHERE fund_id=?').get(id).n;
router.get('/:id(\\d+)/delete', (req, res) => {
  const f = get(req.params.id);
  if (!f) return notFound(res);
  confirm(res, f, used(f.id) ? `This fund has ${used(f.id)} donation(s) linked to it, so it can't be deleted. Set its status to Closed instead.` : null);
});
router.post('/:id(\\d+)/delete', (req, res) => {
  const f = get(req.params.id);
  if (!f) return notFound(res);
  if (used(f.id)) return res.status(409), confirm(res, f, `This fund has ${used(f.id)} donation(s) linked to it, so it can't be deleted. Set its status to Closed instead.`);
  db.prepare('DELETE FROM funds WHERE id=?').run(f.id);
  res.redirect('/admin/funds?ok=fund_deleted');
});

module.exports = router;
