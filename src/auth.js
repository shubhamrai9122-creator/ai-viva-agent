// Student email sign-in: a 6-digit one-time code, then a signed token (HMAC) that the
// browser sends with every viva request. No passwords are stored.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR, nowIso } from './db.js';
import { sendLoginCode } from './mailer.js';
import { checkEmailIsReal } from './emailcheck.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_AFTER_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

// Signing secret: AUTH_SECRET if set, otherwise a random one kept in the data folder so
// tokens survive restarts.
function loadSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const file = path.join(DATA_DIR, '.auth-secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}
const SECRET = loadSecret();

db.exec(`
CREATE TABLE IF NOT EXISTS students (email TEXT PRIMARY KEY, verified_at TEXT, last_login_at TEXT);
CREATE TABLE IF NOT EXISTS login_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, code_hash TEXT, expires_at INTEGER, attempts INTEGER DEFAULT 0, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_codes_email ON login_codes(email);
`);

const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}
export function checkEmail(email) {
  if (!EMAIL_RE.test(email) || email.length > 200) return 'Enter a valid email address';
  if (ALLOWED_DOMAINS.length && !ALLOWED_DOMAINS.includes(email.split('@')[1])) return `Use your institute email (${ALLOWED_DOMAINS.map(d => '@' + d).join(' or ')})`;
  return null;
}

const hashCode = (email, code) => crypto.createHmac('sha256', SECRET).update(`${email}:${code}`).digest('hex');

/** Returns { ok } or { error, status, retryAfter }. */
export async function requestCode(rawEmail) {
  const email = normaliseEmail(rawEmail);
  const bad = checkEmail(email);
  if (bad) return { error: bad, status: 400 };
  const real = await checkEmailIsReal(email);   // ValidateEasy: real, non-disposable address?
  if (!real.ok) return { error: real.error, status: 400 };
  const last = db.prepare('SELECT created_at FROM login_codes WHERE email = ? ORDER BY id DESC LIMIT 1').get(email);
  if (last && Date.now() - last.created_at < RESEND_AFTER_MS) {
    return { error: 'Please wait a few seconds before asking for another code', status: 429, retryAfter: Math.ceil((RESEND_AFTER_MS - (Date.now() - last.created_at)) / 1000) };
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  db.prepare('DELETE FROM login_codes WHERE email = ?').run(email);
  db.prepare('INSERT INTO login_codes (email, code_hash, expires_at, created_at) VALUES (?,?,?,?)').run(email, hashCode(email, code), Date.now() + CODE_TTL_MS, Date.now());
  await sendLoginCode(email, code);
  return { ok: true, email };
}

/** Returns { token, email } or { error, status }. */
export function verifyCode(rawEmail, rawCode) {
  const email = normaliseEmail(rawEmail);
  const code = String(rawCode || '').replace(/\D/g, '');
  const row = db.prepare('SELECT * FROM login_codes WHERE email = ? ORDER BY id DESC LIMIT 1').get(email);
  if (!row || row.expires_at < Date.now()) return { error: 'This code has expired. Ask for a new one.', status: 400 };
  if (row.attempts >= MAX_ATTEMPTS) return { error: 'Too many wrong attempts. Ask for a new code.', status: 429 };
  db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
  const ok = code.length === 6 && crypto.timingSafeEqual(Buffer.from(hashCode(email, code)), Buffer.from(row.code_hash));
  if (!ok) return { error: 'That code is not right. Check the email and try again.', status: 400 };
  db.prepare('DELETE FROM login_codes WHERE email = ?').run(email);
  db.prepare(`INSERT INTO students (email, verified_at, last_login_at) VALUES (?,?,?)
    ON CONFLICT(email) DO UPDATE SET last_login_at = excluded.last_login_at`).run(email, nowIso(), nowIso());
  return { token: issueToken(email), email };
}

export function issueToken(email) {
  const payload = Buffer.from(JSON.stringify({ email: normaliseEmail(email), exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** Returns the verified email for a token, or null. */
export function readToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { email, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return exp > Date.now() ? email : null;
  } catch { return null; }
}
