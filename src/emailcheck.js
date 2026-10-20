// Email address check before a sign-in code is sent, using ValidateEasy
// (https://validateeasy.com): syntax, mail server (MX), disposable domains and typos.
// It does not send email. Without VALIDATEEASY_API_KEY, or if the service is down,
// sign-in still works (fail open) so an outage never locks students out.

const API = process.env.VALIDATEEASY_API_URL || 'https://api.validateeasy.com';
const KEY = process.env.VALIDATEEASY_API_KEY || '';
export const EMAIL_CHECK = KEY ? 'validateeasy' : 'off';

const cache = new Map();   // email -> { at, result }; saves the monthly quota on resends
const TTL_MS = 60 * 60 * 1000;

/** Returns { ok: true } or { ok: false, error } with a student-friendly message. */
export async function checkEmailIsReal(email) {
  if (!KEY) return { ok: true, skipped: true };
  const hit = cache.get(email);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result;
  let data;
  try {
    const r = await fetch(`${API}/validate?email=${encodeURIComponent(email)}`, { headers: { 'X-Api-Key': KEY }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) { console.warn(`[emailcheck] ValidateEasy returned ${r.status}; allowing sign-in`); return { ok: true, skipped: true }; }
    data = await r.json();
  } catch (err) {
    console.warn('[emailcheck] ValidateEasy unreachable; allowing sign-in:', err?.message);
    return { ok: true, skipped: true };
  }
  const c = data.checks || {};
  let result = { ok: true };
  if (c.syntax === false) result = { ok: false, error: 'That email address isn\'t valid. Check it and try again.' };
  else if (c.disposable === true) result = { ok: false, error: 'Temporary or disposable email addresses can\'t be used. Use your college or personal email.' };
  else if (c.mx === false) result = { ok: false, error: 'That email domain can\'t receive mail. Check the part after the @.' };
  else if (c.typo === true) result = { ok: false, error: 'That address looks mistyped (for example gmial.com instead of gmail.com). Check it and try again.' };
  else if (data.status && !['valid', 'unknown', 'accept_all', 'catch_all', 'risky'].includes(String(data.status).toLowerCase())) {
    result = { ok: false, error: `That email address can't be used (${data.reason || data.result || data.status}).` };
  }
  cache.set(email, { at: Date.now(), result });
  return result;
}
