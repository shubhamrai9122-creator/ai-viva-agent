// Background scoring queue. Jobs are persisted as sessions.score_status so a restart
// resumes pending work; scoring never competes with live turns for the request path.
import { db, getSession, getViva, addAudit } from './db.js';
import { env } from './config.js';
import { scoreSession } from './scorer.js';

const pending = [];
let running = 0;

export function enqueueScoring(sessionId) {
  db.prepare("UPDATE sessions SET score_status = 'queued' WHERE id = ?").run(sessionId)
    .then(() => { if (!pending.includes(sessionId)) pending.push(sessionId); pump(); })
    .catch(err => console.error('[queue]', err.message));
}

export async function resumeQueue() {
  for (const r of await db.prepare("SELECT id FROM sessions WHERE score_status IN ('queued','running')").all()) enqueueScoring(r.id);
}

export const queueStats = () => ({ pending: pending.length, running });

// Serverless hosts (Vercel) freeze the function once the response is sent, so there the
// marking is awaited inside the request instead of running in the background.
export const SERVERLESS = !!process.env.VERCEL;
export async function scoreNow(sessionId) {
  await db.prepare("UPDATE sessions SET score_status = 'queued' WHERE id = ?").run(sessionId);
  await run(sessionId);
}

function pump() {
  while (running < env.scoringConcurrency && pending.length) {
    const id = pending.shift();
    running++;
    run(id).finally(() => { running--; pump(); });
  }
}

async function run(id, attempt = 1) {
  const s = await getSession(id);
  if (!s) return;
  const viva = await getViva(s.viva_id);
  await db.prepare("UPDATE sessions SET score_status = 'running' WHERE id = ?").run(id);
  try {
    const { result, needsReview, reasons } = await scoreSession(s, viva);
    const fresh = await getSession(id);
    const finalTotal = fresh.override ? fresh.override.total : result.total;
    await db.prepare("UPDATE sessions SET score = ?, ai_total = ?, final_total = ?, needs_review = ?, review_reasons = ?, score_status = 'done' WHERE id = ?")
      .run(JSON.stringify(result), result.total, finalTotal, needsReview ? 1 : 0, JSON.stringify(reasons), id);
    await addAudit(id, 'system', 'scored', { total: result.total, model: result.model, prompt_version: result.prompt_version, needsReview });
  } catch (err) {
    console.error('[scorer] failed', id, err?.status || err?.message);
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 5000 * attempt));
      return run(id, attempt + 1);
    }
    await db.prepare("UPDATE sessions SET score_status = 'failed', needs_review = 1, review_reasons = ? WHERE id = ?")
      .run(JSON.stringify([`Automatic scoring failed: ${err?.message || err}`]), id);
    await addAudit(id, 'system', 'score_failed', { error: String(err?.message || err) });
  }
}
