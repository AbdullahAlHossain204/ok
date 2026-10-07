// Security headers + CSRF protection (no extra packages).
const crypto = require('crypto');
const PROD = process.env.NODE_ENV === 'production';

let SECRET = process.env.SESSION_SECRET;
if (!SECRET || SECRET.startsWith('change-me') || SECRET.length < 16) {
  if (PROD) { console.error('Set a long random SESSION_SECRET in .env before running in production.'); process.exit(1); }
  // Development only: keep a generated secret in the database so open forms still work after the server restarts
  const { db } = require('./db');
  db.exec('CREATE TABLE IF NOT EXISTS app_secrets (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  db.prepare("INSERT OR IGNORE INTO app_secrets(k,v) VALUES('csrf', ?)").run(crypto.randomBytes(32).toString('hex'));
  SECRET = db.prepare("SELECT v FROM app_secrets WHERE k='csrf'").get().v;
  console.warn('Note: set a real SESSION_SECRET in .env (20+ characters) before going live.');
}
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const tokenFor = sign; // exported for tests

function headers(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  });
  if (PROD) res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
}

// Every visitor gets a random csrf cookie; forms carry HMAC(secret, cookie). An attacker site can't read the cookie or forge the HMAC.
function csrfAttach(req, res, next) {
  let c = (req.headers.cookie || '').split(';').map((p) => p.trim()).find((p) => p.startsWith('csrf='));
  c = c ? c.slice(5) : null;
  if (!c || !/^[a-f0-9]{64}$/.test(c)) {
    c = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf', c, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 30 * 864e5 });
  }
  req.csrfCookie = c;
  if (req.path.startsWith('/admin')) res.set('Cache-Control', 'no-store'); // never reuse an old copy of a form page
  res.locals.csrfToken = sign(c);
  next();
}

function csrfVerify(req, res, next) {
  if (req.method !== 'POST') return next();
  const given = Buffer.from(String((req.body && req.body._csrf) || ''));
  const want = Buffer.from(sign(req.csrfCookie));
  if (given.length === want.length && crypto.timingSafeEqual(given, want)) return next();
  let backLink = '/admin';
  try { const u = new URL(req.get('referer') || ''); if (u.host === req.get('host') && u.pathname.startsWith('/')) backLink = u.pathname + u.search; } catch {}
  res.status(403).render('error', { page: 'Form expired', backLink, msg: 'Your form expired, so nothing was saved. This can happen if the page was open for a long time or the server restarted. Click the button to reload the form and try again.' });
}

module.exports = { headers, csrfAttach, csrfVerify, tokenFor };
