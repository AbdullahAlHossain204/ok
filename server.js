//  New ES Module syntax
import 'dotenv/config';
const express = require('express');
const path = require('path');
//  New ES Module syntax
import { db, totals } from './db.js';
const { list } = require('./publicData');
const { monthly } = require('./reportData');
const { bars } = require('./charts');
const { today } = require('./money');
const { taka, fmtDate } = require('./money');
const auth = require('./auth');
const security = require('./security');
const { donationLink } = require('./whatsapp');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1); // set when behind a proxy/host so rate limiting sees real IPs
app.use(security.headers);
app.use('/img', express.static('public/img', { maxAge: '7d' }));
app.use(express.static('public'));
app.use((req, res, next) => {
  res.locals.taka = taka;
  res.locals.fmtDate = fmtDate;
  res.locals.site = db.prepare('SELECT id,name,name_bn,short_name,address,phone,description,title,logo_v FROM settings WHERE id=1').get();
  res.locals.path = req.path;
  res.locals.base = req.protocol + '://' + req.get('host');
  // WhatsApp link for a COMPLETED donation (null if not available or phone invalid)
  res.locals.waLink = (t) => (t.status === 'COMPLETED' ? donationLink(t, res.locals.site.short_name || res.locals.site.name) : null);
  next();
});

const small = express.urlencoded({ extended: false, limit: '20kb' }), big = express.urlencoded({ extended: false, limit: '400kb' });
app.use((req, res, next) => (req.path.startsWith('/admin/settings') ? big : small)(req, res, next)); // settings accepts a small logo image
app.use(security.csrfAttach);
app.use(security.csrfVerify);

app.use(auth.loadAdmin);

// Public logo image (stored in the database; only PNG/JPEG/WebP are ever accepted)
app.get('/logo', (req, res) => {
  const r = db.prepare('SELECT logo, logo_type FROM settings WHERE id=1').get();
  if (!r || !r.logo) return res.status(404).end();
  res.set({ 'Content-Type': r.logo_type, 'Cache-Control': 'public, max-age=86400' }).end(Buffer.from(r.logo));
});

// ---------- Public ----------
app.get('/', (req, res) => res.render('home', { t: totals(), page: 'Home', hero: true, year: today().slice(0, 4),
  chart: bars([{ name: 'Collection', color: '#0b4d3a', values: monthly(today().slice(0, 4)).credit }], 'Monthly collection this year'),
  donations: list({ kind: 'donations', per: 5 }).rows }));
app.use(require('./routes/public'));

// ---------- Admin login / logout ----------
app.get('/admin/login', (req, res) => {
  if (req.admin) return res.redirect('/admin');
  res.render('admin/login', { error: null, email: '' });
});
app.post('/admin/login', async (req, res, next) => {
  try {
    const ip = req.ip;
    if (auth.blocked(ip)) return res.status(429).render('admin/login', { error: 'Too many attempts. Please wait 15 minutes and try again.', email: '' });
    const a = await auth.checkLogin(req.body.email, req.body.password);
    if (!a) { auth.recordFail(ip); return res.status(401).render('admin/login', { error: 'Incorrect email or password.', email: String(req.body.email || '').slice(0, 100) }); }
    auth.clearFails(ip);
    auth.startSession(res, a.id);
    res.redirect('/admin');
  } catch (e) { next(e); }
});
app.post('/admin/logout', (req, res) => { auth.endSession(req, res); res.redirect('/admin/login'); });

// ---------- Everything below here needs a logged-in admin ----------
app.use('/admin', auth.requireAdmin);
const FLASH = { added: 'Donation added successfully.', updated: 'Donation updated successfully.', deleted: 'Transaction deleted successfully.',
  expense_added: 'Expense added successfully.', expense_updated: 'Expense updated successfully.',
  settings_saved: 'Settings saved successfully.', logo_saved: 'Logo updated successfully.', logo_removed: 'Logo removed.',
  cat_added: 'Category added successfully.', cat_renamed: 'Category renamed successfully.', cat_deleted: 'Category deleted successfully.',
  fund_added: 'Fund added successfully.', fund_updated: 'Fund updated successfully.', fund_deleted: 'Fund deleted successfully.' };
app.use('/admin', (req, res, next) => { res.set('Cache-Control', 'no-store'); res.locals.flash = FLASH[req.query.ok] || null; next(); });
app.use('/admin', require('./routes/dashboard'));
app.use('/admin/reports', require('./routes/reports'));
app.use('/admin/donors', require('./routes/donors'));
app.use('/admin/donations', require('./routes/donations'));
app.use('/admin/expenses', require('./routes/expenses'));
app.use('/admin/settings', require('./routes/settings'));
app.use('/admin/funds', require('./routes/funds'));
app.use('/admin/transactions', require('./routes/transactions'));

// ---------- Errors ----------
app.use((req, res) => res.status(404).render('error', { page: 'Not found', msg: 'Page not found.' }));
app.use((err, req, res, next) => {
  if (err.status === 413 || err.type === 'entity.too.large') return res.status(413).render('error', { page: 'Too large', msg: 'That upload is too large. Please use a smaller file.' });
  console.error(err);
  res.status(500).render('error', { page: 'Error', msg: 'Something went wrong. Please try again.' });
});

module.exports = app; // exported so tests can run it
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('Running on http://localhost:' + port));
}
import { createClient } from "@libsql/client";
// OR if using CommonJS: const { createClient } = require("@libsql/client");



// Example query format for the rest of your routes:
// const result = await db.execute("SELECT * FROM donations");
