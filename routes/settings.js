const router = require('express').Router();
const { db } = require('../db');
const { invalidateSite } = require('../site');

const clean = (s, n) => String(s || '').trim().slice(0, n);
const cats = (type) => db.prepare(`SELECT c.id, c.name, (SELECT COUNT(*) FROM transactions t WHERE t.category_id=c.id) used FROM categories c WHERE c.type=? ORDER BY c.name`).all(type);
const row = () => db.prepare('SELECT name,name_bn,short_name,title,description,address,phone,logo_v FROM settings WHERE id=1').get();

const render = async (res, o = {}) => {
  const [s, income, expense] = await Promise.all([row(), cats('INCOME'), cats('EXPENSE')]);
  return res.status((o.errors && o.errors.length) || o.catError ? 400 : 200).render('admin/settings',
    { s, income, expense, errors: [], catError: null, page: 'Settings', ...o });
};

router.get('/', (req, res) => render(res));

router.post('/', async (req, res) => {
  const v = { name: clean(req.body.name, 150), name_bn: clean(req.body.name_bn, 150), short_name: clean(req.body.short_name, 60), title: clean(req.body.title, 100), description: clean(req.body.description, 500), address: clean(req.body.address, 300), phone: clean(req.body.phone, 40) };
  const errors = [];
  if (v.name.length < 2) errors.push('Madrasa name must be at least 2 characters.');
  if (v.title.length < 2) errors.push('Website title must be at least 2 characters.');
  if (errors.length) return render(res, { errors, s: { ...(await row()), ...v } });
  await db.prepare('UPDATE settings SET name=?,name_bn=?,short_name=?,title=?,description=?,address=?,phone=? WHERE id=1').run(v.name, v.name_bn, v.short_name || v.name, v.title, v.description, v.address, v.phone);
  invalidateSite();
  res.redirect('/admin/settings?ok=settings_saved');
});

// ----- logo (browser resizes it to max 256px and sends it as a data URL) -----
const MAGIC = { 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff] };
router.post('/logo', async (req, res) => {
  if (req.body.remove) { await db.prepare('UPDATE settings SET logo=NULL, logo_type=NULL, logo_v=NULL WHERE id=1').run(); invalidateSite(); return res.redirect('/admin/settings?ok=logo_removed'); }
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.logo_data || ''));
  const buf = m ? Buffer.from(m[2], 'base64') : null;
  const okType = buf && (m[1] === 'image/webp' ? buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP'
                                                : MAGIC[m[1]].every((b, i) => buf[i] === b));
  if (!buf || !buf.length || buf.length > 200 * 1024 || !okType)
    return render(res, { errors: ['Logo must be a PNG, JPEG or WebP image under 200 KB.'] });
  await db.prepare('UPDATE settings SET logo=?, logo_type=?, logo_v=? WHERE id=1').run(buf, m[1], Date.now());
  invalidateSite();
  res.redirect('/admin/settings?ok=logo_saved');
});

// ----- categories -----
router.post('/categories', async (req, res) => {
  const name = clean(req.body.name, 50), type = req.body.type === 'EXPENSE' ? 'EXPENSE' : req.body.type === 'INCOME' ? 'INCOME' : null;
  if (name.length < 2 || !type) return render(res, { catError: 'Enter a category name (at least 2 characters) and choose a type.' });
  try { await db.prepare('INSERT INTO categories(name,type) VALUES(?,?)').run(name, type); }
  catch { return render(res, { catError: 'That category already exists.' }); }
  res.redirect('/admin/settings?ok=cat_added#categories');
});
router.post('/categories/:id(\\d+)', async (req, res) => {
  const c = await db.prepare('SELECT id,type FROM categories WHERE id=?').get(req.params.id), name = clean(req.body.name, 50);
  if (!c) return res.status(404).render('error', { page: 'Not found', msg: 'Category not found.' });
  if (name.length < 2) return render(res, { catError: 'Category name must be at least 2 characters.' });
  try { await db.prepare('UPDATE categories SET name=? WHERE id=?').run(name, c.id); }
  catch { return render(res, { catError: 'A category with that name already exists.' }); }
  res.redirect('/admin/settings?ok=cat_renamed#categories');
});
const usedCount = async (id) => (await db.prepare('SELECT COUNT(*) n FROM transactions WHERE category_id=?').get(id)).n;
const confirm = (res, c, error) => res.render('admin/confirm_delete', { label: `Category: ${c.name}`, page: 'Delete category', action: `/admin/settings/categories/${c.id}/delete`, back: '/admin/settings#categories', error });
router.get('/categories/:id(\\d+)/delete', async (req, res) => {
  const c = await db.prepare('SELECT id,name FROM categories WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).render('error', { page: 'Not found', msg: 'Category not found.' });
  const n = await usedCount(c.id);
  return confirm(res, c, n ? `This category is used by ${n} transaction(s), so it can't be deleted. You can rename it instead.` : null);
});
router.post('/categories/:id(\\d+)/delete', async (req, res) => {
  const c = await db.prepare('SELECT id,name FROM categories WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).render('error', { page: 'Not found', msg: 'Category not found.' });
  const n = await usedCount(c.id);
  if (n) return res.status(409), confirm(res, c, `This category is used by ${n} transaction(s), so it can't be deleted. You can rename it instead.`);
  await db.prepare('DELETE FROM categories WHERE id=?').run(c.id);
  res.redirect('/admin/settings?ok=cat_deleted#categories');
});

module.exports = router;
