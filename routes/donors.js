const router = require('express').Router();
const { db } = require('../db');

router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100), page = Math.max(1, parseInt(req.query.page) || 1), per = 25;
  const digits = q.replace(/[\s\-+]/g, '');
  const where = q ? 'WHERE d.name LIKE ? OR d.phone LIKE ? OR EXISTS (SELECT 1 FROM transactions x WHERE x.donor_id=d.id AND x.type=\'CREDIT\' AND x.txn_id LIKE ?)' : '';
  const a = q ? [`%${q}%`, `%${digits || q}%`, `%${q}%`] : [];
  const total = db.prepare(`SELECT COUNT(DISTINCT d.id) n FROM donors d JOIN transactions t ON t.donor_id=d.id AND t.type='CREDIT' ${where}`).get(...a).n;
  const rows = db.prepare(`SELECT d.id, d.name, d.phone,
      COALESCE(SUM(CASE WHEN t.status='COMPLETED' THEN t.amount END),0) total, COUNT(CASE WHEN t.status='COMPLETED' THEN 1 END) cnt,
      MAX(CASE WHEN t.status='COMPLETED' THEN t.date END) last
    FROM donors d JOIN transactions t ON t.donor_id=d.id AND t.type='CREDIT' ${where}
    GROUP BY d.id ORDER BY last DESC, d.id DESC LIMIT ? OFFSET ?`).all(...a, per, (page - 1) * per);
  res.render('admin/donors', { rows, q, total, pageNo: page, pages: Math.max(1, Math.ceil(total / per)), page: 'Donors' });
});

router.get('/:id(\\d+)', (req, res) => {
  const d = db.prepare('SELECT id,name,phone FROM donors WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).render('error', { page: 'Not found', msg: 'Donor not found.' });
  const history = db.prepare(`SELECT t.id,t.txn_id,t.date,t.amount,t.status,t.purpose,t.payment_method,t.name_visibility,c.name category, f.name fund, ? donor_name, ? phone
    FROM transactions t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN funds f ON f.id=t.fund_id
    WHERE t.donor_id=? AND t.type='CREDIT' ORDER BY t.date DESC, t.id DESC`).all(d.name, d.phone, d.id);
  const done = history.filter((h) => h.status === 'COMPLETED');
  res.render('admin/donor_profile', { d, history, total: done.reduce((s, h) => s + h.amount, 0), count: done.length, page: 'Donor ' + d.name });
});
module.exports = router;
