// Admin authentication: bcrypt passwords, random session tokens stored (hashed) in the database.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const COOKIE = 'sid', DAYS = 7;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const DUMMY = bcrypt.hashSync('not-a-real-password', 12); // keeps timing similar for unknown emails

const readCookie = (req, name) => {
  for (const p of (req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0 && p.slice(0, i).trim() === name) return decodeURIComponent(p.slice(i + 1).trim());
  }
  return null;
};

async function startSession(res, adminId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  await db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(sha(token), adminId, Date.now() + DAYS * 864e5);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: DAYS * 864e5 });
}

async function endSession(req, res) {
  const t = readCookie(req, COOKIE);
  if (t) await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(t));
  res.clearCookie(COOKIE);
}

// Runs on every request: sets req.admin if the cookie holds a valid session
async function loadAdmin(req, res, next) {
  const t = readCookie(req, COOKIE);
  req.admin = t ? (await db.prepare(`SELECT a.id, a.email FROM sessions s JOIN admins a ON a.id=s.admin_id
                              WHERE s.token_hash=? AND s.expires_at>?`).get(sha(t), Date.now())) || null : null;
  res.locals.admin = req.admin;
  next();
}

// Protects admin pages on the server
function requireAdmin(req, res, next) {
  if (req.admin) return next();
  res.set('Cache-Control', 'no-store');
  res.redirect('/admin/login');
}

// Login rate limit: 5 failed attempts per 15 minutes per IP
const fails = new Map(), MAX = 5, WINDOW = 15 * 60 * 1000;
const blocked = (ip) => { const f = fails.get(ip); return f && f.reset > Date.now() && f.count >= MAX; };
const recordFail = (ip) => { const f = fails.get(ip); if (!f || f.reset < Date.now()) fails.set(ip, { count: 1, reset: Date.now() + WINDOW }); else f.count++; };
const clearFails = (ip) => fails.delete(ip);

async function checkLogin(email, password) {
  const a = await db.prepare('SELECT * FROM admins WHERE email=?').get(String(email || '').trim().toLowerCase());
  const ok = await bcrypt.compare(String(password || ''), a ? a.password_hash : DUMMY);
  return a && ok ? a : null;
}

module.exports = { loadAdmin, requireAdmin, startSession, endSession, checkLogin, blocked, recordFail, clearFails };
