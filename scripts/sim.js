// Shared simulation helpers: run a full viva in-process against the real interviewer
// controller (LLM if ANTHROPIC_API_KEY is set, otherwise mock) with simulated time.
import { DEFAULT_PHASES, DEFAULT_RUBRIC } from '../src/config.js';
import { db, uid, nowIso, insertQuestions, getSession, getViva, getQuestions, getTurns, addTurn, saveState } from '../src/db.js';
import { greeting, initialState, nextTurn } from '../src/interviewer.js';
import fs from 'node:fs';

export function createViva(code = 'SIM-' + Math.floor(Math.random() * 1e6), phases = DEFAULT_PHASES) {
  const id = uid('v_');
  db.prepare('INSERT INTO vivas (id, code, subject, topics, difficulty, phases, rubric, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, code, 'Data Structures', JSON.stringify(['arrays and linked lists', 'stacks', 'queues', 'hashing', 'trees', 'heaps', 'graphs', 'sorting']), 'medium', JSON.stringify(phases), JSON.stringify(DEFAULT_RUBRIC), nowIso());
  insertQuestions(id, JSON.parse(fs.readFileSync(new URL('../data/samples/ds-question-bank.json', import.meta.url))), 'sample', true);
  return getViva(id);
}

const speakSec = text => (text || '').split(/\s+/).filter(Boolean).length / 2.6;   // ~155 wpm TTS / speech

/** persona(ctx) -> answer text, where ctx = { question, aiText, action, n } */
export async function simulateViva(viva, studentId, persona) {
  const id = uid('s_');
  const startedAt = Date.now();
  db.prepare(`INSERT INTO sessions (id, viva_id, student_id, student_name, language, consent_at, started_at, status, state, score_status)
    VALUES (?,?,?,?,?,?,?,'active',?, 'pending')`).run(id, viva.id, studentId, studentId, 'en-IN', nowIso(), startedAt, JSON.stringify(initialState()));
  let s = getSession(id);
  let elapsed = 0;
  const bank = getQuestions(viva.id);
  let ai = greeting(viva, s);
  addTurn({ session_id: id, role: 'ai', text: ai, t_start: 0, phase: 'warmup', question_id: 'opener', action: 'greeting' });
  elapsed += speakSec(ai);
  const latencies = [];
  for (let n = 0; n < 80; n++) {
    s = getSession(id);
    const q = s.state.q;
    const answer = await persona({ question: q, aiText: ai, n });
    const aStart = elapsed + 1;
    elapsed = aStart + Math.min(90, speakSec(answer)) + 2.2;   // + end-of-speech wait
    const t0 = Date.now();
    const r = await nextTurn({ viva, session: s, bank, history: getTurns(id), answer, elapsed });
    const lat = Date.now() - t0; latencies.push(lat);
    addTurn({ session_id: id, role: 'student', text: answer, t_start: aStart, t_end: elapsed, phase: viva.phases[s.state.phaseIdx]?.key, question_id: q?.id, assessment: r.assessment });
    elapsed += lat / 1000;
    addTurn({ session_id: id, role: 'ai', text: r.say, t_start: elapsed, phase: r.phaseKey, question_id: r.questionId, action: r.action, latency_ms: lat, meta: { mode: r.mode } });
    saveState(id, r.state);
    ai = r.say;
    elapsed += speakSec(r.say);
    if (r.done) break;
  }
  db.prepare("UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(startedAt + elapsed * 1000, id);
  return { sessionId: id, elapsed, latencies };
}

export function transcriptMarkdown(sessionId) {
  const fmt = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.round(t % 60)).padStart(2, '0')}`;
  return getTurns(sessionId).map((t, i) => `- L${i + 1} [${fmt(t.t_start || 0)}] **${t.role === 'ai' ? 'EXAMINER' : 'STUDENT'}**` +
    `${t.role === 'ai' ? ` _(${t.action}${t.question_id ? ', ' + t.question_id : ''})_` : ` _(${t.assessment})_`}: ${t.text}`).join('\n');
}
