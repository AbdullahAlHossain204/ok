import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname manually for ES Modules compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import local application dependencies (Notice the explicit .js extension)
import { db, totals } from './db.js';
import { list } from './publicData.js';
import { monthly } from './reportData.js';
import { bars } from './charts.js';
import { today, taka, fmtDate } from './money.js';
import auth from './auth.js';
import security from './security.js';
import { donationLink } from './whatsapp.js';

// Import Route modules
import publicRouter from './routes/public.js';
import dashboardRouter from './routes/dashboard.js';
import reportsRouter from './routes/reports.js';
import donorsRouter from './routes/donors.js';
import donationsRouter from './routes/donations.js';
import expensesRouter from './routes/expenses.js';
import settingsRouter from './routes/settings.js';
import fundsRouter from './routes/funds.js';
import transactionsRouter from './routes/transactions.js';

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1); 
}

app.use(security.headers);
app.use('/img', express.static('public/img', { maxAge: '7d' }));
app.use(express.static('public'));

app.use((req, res, next) => {
  res.locals.taka = taka;
  res.locals.fmtDate = fmtDate;
  res.locals.site = db.prepare('SELECT id,name,name_bn,short_name,address,phone,description,title,logo_v FROM settings WHERE id=1').get();
  res.locals.path = req.path;
  res.locals.base = req.protocol + '://' + req.get('host');
  res.locals.waLink = (t) => (t.status === 'COMPLETED' ? donationLink(t, res.locals.site.short_name || res.locals.site.name) : null);
  next();
});

const small = express.urlencoded({ extended: false, limit: '20kb' });
const big = express.urlencoded({ extended: false, limit: '400kb' });
app.use((req, res, next) => (req.path.startsWith('/admin/settings') ? big : small)(req, res, next)); 

app.use(security.csrfAttach);
app.use(security.csrfVerify);
app.use(auth.loadAdmin);

// Public logo image 
app.get('/logo', (req, res) => {
  const r = db.prepare('SELECT logo, logo_type FROM settings WHERE id=1').get();
  if (!r || !r.logo) return res.status(404).end();
  res.set({ 'Content-Type': r.logo_type, 'Cache-Control': 'public, max-age=86400' }).end(Buffer.from(r.logo));
});

// ---------- Public Routes ----------
app.get('/', (req, res) => res.render('home', { 
  t: totals(), 
  page: 'Home', 
  hero: true, 
  year: today().slice(0, 4),
  chart: bars([{ name: 'Collection', color: '#0b4d3a', values: monthly(today().slice(0, 4)).credit }], 'Monthly collection this year'),
  donations: list({ kind: 'donations', per: 5 }).rows 
}));
app.use(publicRouter);

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
    if (!a) { 
      auth.recordFail(ip); 
      return res.status(401).render('admin/login', { error: 'Incorrect email or password.', email: String(req.body.email || '').slice(0, 100) }); 
    }
    auth.clearFails(ip);
    auth.startSession(res, a.id);
    res.redirect('/admin');
  } catch (e) { next(e); }
});

app.post('/admin/logout', (req, res) => { auth.endSession(req, res); res.redirect('/admin/login'); });

// ---------- Everything below here needs a logged-in admin ----------
app.use('/admin', auth.requireAdmin);

const FLASH = { 
  added: 'Donation added successfully.', updated: 'Donation updated successfully.', deleted: 'Transaction deleted successfully.',
  expense_added: 'Expense added successfully.', expense_updated: 'Expense updated successfully.',
  settings_saved: 'Settings saved successfully.', logo_saved: 'Logo updated successfully.', logo_removed: 'Logo removed.',
  cat_added: 'Category added successfully.', cat_renamed: 'Category renamed successfully.', cat_deleted: 'Category deleted successfully.',
  fund_added: 'Fund added successfully.', fund_updated: 'Fund updated successfully.', fund_deleted: 'Fund deleted successfully.' 
};

app.use('/admin', (req, res, next) => { res.set('Cache-Control', 'no-store'); res.locals.flash = FLASH[req.query.ok] || null; next(); });
app.use('/admin', dashboardRouter);
app.use('/admin/reports', reportsRouter);
app.use('/admin/donors', donorsRouter);
app.use('/admin/donations', donationsRouter);
app.use('/admin/expenses', expensesRouter);
app.use('/admin/settings', settingsRouter);
app.use('/admin/funds', fundsRouter);
app.use('/admin/transactions', transactionsRouter);

// ---------- Errors ----------
app.use((req, res) => res.status(404).render('error', { page: 'Not found', msg: 'Page not found.' }));
app.use((err, req, res, next) => {
  if (err.status === 413 || err.type === 'entity.too.large') return res.status(413).render('error', { page: 'Too large', msg: 'That upload is too large. Please use a smaller file.' });
  console.error(err);
  res.status(500).render('error', { page: 'Error', msg: 'Something went wrong. Please try again.' });
});

// Export default app instance
export default app;

// Listen only if the script is executed directly
if (process.argv[1] === __filename) {
  const port = process.env.PORT || 10000; // Updated to default to Render's port
  app.listen(port, '0.0.0.0', () => console.log('Running on http://localhost:' + port));
}
