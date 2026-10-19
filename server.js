import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, uid, nowIso, getViva, listVivas, getQuestions, insertQuestions, getSession, saveState, getTurns, addTurn,
  addEvent, getEvents, addAudit, getAudit, AUDIO_DIR } from './src/db.js';
import { DEFAULT_PHASES, DEFAULT_RUBRIC, SLOT_SECONDS, MAX_ANSWER_SECONDS, env, MOCK } from './src/config.js';
import { greeting, initialState, nextTurn, totalSeconds, slotSeconds, timePhaseIndex, INTERVIEWER_PROMPT_VERSION } from './src/interviewer.js';
import { enqueueScoring, resumeQueue, queueStats } from './src/queue.js';
import { parseBank, generateBank } from './src/questionbank.js';
import { transcriptLines } from './src/scorer.js';
import { stats as llmStats } from './src/llm.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));

const elapsedOf = s => (Date.now() - s.started_at) / 1000;
const bad = (res, code, msg) => res.status(code).json({ error: msg });
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(err => { console.error(err); bad(res, 500, err.message || 'server error'); });

// ---------- health / metrics ----------
const latencies = [];
app.get('/api/health', (req, res) => {
  const sorted = [...latencies].sort((a, b) => a - b);
  const p = q => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
  const active = db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE status = 'active'").get().n;
  res.json({ ok: true, mode: MOCK ? 'mock' : 'llm', interviewerModel: env.interviewerModel, scorerModel: env.scorerModel,
    activeSessions: active, turnLatencyMs: { n: sorted.length, p50: p(0.5), p95: p(0.95) }, llm: llmStats, queue: queueStats(),
    memoryMB: Math.round(process.memoryUsage().rss / 1e6) });
});

// ---------- faculty auth (shared passcode for the MVP) ----------
function faculty(req, res, next) {
  if (req.get('x-faculty-key') !== env.facultyKey && req.query.key !== env.facultyKey) return bad(res, 401, 'faculty passcode required');
  next();
}

// ---------- faculty: viva setup ----------
app.get('/api/faculty/vivas', faculty, (req, res) => res.json(listVivas()));
app.get('/api/faculty/defaults', faculty, (req, res) => res.json({ phases: DEFAULT_PHASES, rubric: DEFAULT_RUBRIC }));

app.post('/api/faculty/vivas', faculty, wrap(async (req, res) => {
  const { subject, topics = [], difficulty = 'medium', phases, bankText, bankFormat, questions } = req.body;
  if (!subject) return bad(res, 400, 'subject required');
  const ph = Array.isArray(phases) && phases.length ? phases.map((p, i) => ({ ...DEFAULT_PHASES[i], ...p, seconds: Number(p.seconds) })) : DEFAULT_PHASES;
  if (ph.some(p => !Number.isFinite(p.seconds) || p.seconds < 0)) return bad(res, 400, 'phase timings must be positive numbers of seconds');
  // Phases plus the 30 s scoring hand-off must fit in the 15-minute slot.
  if (totalSeconds(ph) > SLOT_SECONDS - 30) return bad(res, 400, `phases must total at most ${SLOT_SECONDS - 30} seconds (14:30)`);
  const id = uid('v_');
  const code = String(req.body.code || subject.replace(/[^A-Za-z]/g, '').slice(0, 4) + '-' + Math.floor(1000 + Math.random() * 9000)).trim().toUpperCase();
  if (getViva(code)) return bad(res, 409, `viva code ${code} is already in use`);
  db.prepare('INSERT INTO vivas (id, code, subject, topics, difficulty, phases, rubric, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, code, subject, JSON.stringify(topics), difficulty, JSON.stringify(ph), JSON.stringify(DEFAULT_RUBRIC), nowIso());
  let added = 0;
  if (bankText) added += insertQuestions(id, parseBank(bankText, bankFormat), 'upload', true).length;
  if (Array.isArray(questions)) added += insertQuestions(id, questions, 'upload', true).length;
  res.json({ id, code, added });
}));

app.post('/api/faculty/vivas/:id/questions', faculty, wrap(async (req, res) => {
  const v = getViva(req.params.id); if (!v) return bad(res, 404, 'viva not found');
  const qs = req.body.bankText ? parseBank(req.body.bankText, req.body.bankFormat) : req.body.questions || [];
  res.json({ added: insertQuestions(v.id, qs, 'upload', true).length });
}));

app.post('/api/faculty/vivas/:id/generate', faculty, wrap(async (req, res) => {
  const v = getViva(req.params.id); if (!v) return bad(res, 404, 'viva not found');
  const qs = await generateBank({ subject: v.subject, topics: v.topics, difficulty: v.difficulty, syllabus: req.body.syllabus, count: req.body.count || 12 });
  const ids = insertQuestions(v.id, qs, 'ai-generated', false);
  res.json({ added: ids.length });
}));

app.get('/api/faculty/vivas/:id/questions', faculty, (req, res) => res.json(getQuestions(req.params.id, false)));
app.post('/api/faculty/questions/approve', faculty, (req, res) => {
  const { ids = [], approved = true } = req.body;
  const st = db.prepare('UPDATE questions SET approved = ? WHERE id = ?');
  for (const id of ids) st.run(approved ? 1 : 0, id);
  res.json({ updated: ids.length });
});
app.delete('/api/faculty/questions/:id', faculty, (req, res) => {
  db.prepare('DELETE FROM questions WHERE id = ? AND approved = 0').run(req.params.id);
  res.json({ ok: true });
});

// ---------- student: join, consent, interview ----------
// Lets the join page check the code up front and show the real duration in the rules.
app.get('/api/student/vivas/:code', (req, res) => {
  const v = getViva(String(req.params.code || '').trim().toUpperCase());
  if (!v) return bad(res, 404, 'Viva code not found');
  if (!getQuestions(v.id).length) return bad(res, 409, 'This viva has no approved questions yet');
  res.json(publicViva(v));
});

app.post('/api/student/join', wrap(async (req, res) => {
  const { code, studentId, name, consent, language = 'en-IN' } = req.body;
  const v = getViva(String(code || '').trim().toUpperCase()) || getViva(String(code || '').trim());
  if (!v) return bad(res, 404, 'Viva code not found');
  if (!studentId) return bad(res, 400, 'Student ID required');
  if (!consent) return bad(res, 400, 'Consent to recording is required to take the viva');
  if (!getQuestions(v.id).length) return bad(res, 409, 'This viva has no approved questions yet');
  const existing = db.prepare('SELECT id FROM sessions WHERE viva_id = ? AND student_id = ?').get(v.id, String(studentId).trim());
  if (existing) {
    const s = getSession(existing.id);
    if (s.status === 'ended') return bad(res, 409, 'You have already completed this viva');
    addEvent(s.id, s.started_at ? elapsedOf(s) : 0, 'rejoin', {});
    db.prepare('UPDATE sessions SET consent_at = ? WHERE id = ?').run(nowIso(), s.id);
    return res.json({ sessionId: s.id, resumed: !!s.started_at, viva: publicViva(v) });
  }
  const id = uid('s_');
  db.prepare(`INSERT INTO sessions (id, viva_id, student_id, student_name, language, consent_at, status, state, score_status)
    VALUES (?,?,?,?,?,?,'joined',?, 'pending')`).run(id, v.id, String(studentId).trim(), name || '', language, nowIso(), JSON.stringify(initialState()));
  addAudit(id, `student:${studentId}`, 'consented', { language });
  res.json({ sessionId: id, resumed: false, viva: publicViva(v) });
}));

const publicViva = v => ({ subject: v.subject, topics: v.topics, phases: v.phases.map(({ key, label, seconds }) => ({ key, label, seconds })),
  interviewSeconds: totalSeconds(v.phases), slotSeconds: slotSeconds(v.phases), maxAnswerSeconds: MAX_ANSWER_SECONDS });

function snapshot(s, v) {
  const el = s.started_at ? elapsedOf(s) : 0;
  const idx = Math.max(s.state.phaseIdx || 0, timePhaseIndex(v.phases, el));
  return { elapsed: el, interviewSeconds: totalSeconds(v.phases), phase: v.phases[Math.min(idx, v.phases.length - 1)].key, status: s.status };
}

app.post('/api/student/sessions/:id/start', wrap(async (req, res) => {
  const s = getSession(req.params.id); if (!s) return bad(res, 404, 'session not found');
  const v = getViva(s.viva_id);
  if (s.status === 'ended') return bad(res, 409, 'viva already ended');
  if (s.started_at) {
    // Rejoin: repeat the last examiner line; the clock keeps running (same time for everyone).
    const last = db.prepare("SELECT text FROM turns WHERE session_id = ? AND role = 'ai' ORDER BY id DESC LIMIT 1").get(s.id);
    return res.json({ say: `Welcome back. ${last?.text || ''}`, ...snapshot(s, v), done: false });
  }
  const startedAt = Date.now();
  db.prepare("UPDATE sessions SET started_at = ?, status = 'active' WHERE id = ?").run(startedAt, s.id);
  const say = greeting(v, s);
  addTurn({ session_id: s.id, role: 'ai', text: say, t_start: 0, phase: 'warmup', question_id: 'opener', action: 'greeting', meta: { prompt_version: INTERVIEWER_PROMPT_VERSION } });
  res.json({ say, ...snapshot(getSession(s.id), v), done: false });
}));

app.post('/api/student/sessions/:id/turn', wrap(async (req, res) => {
  const t0 = Date.now();
  const s = getSession(req.params.id); if (!s) return bad(res, 404, 'session not found');
  if (s.status !== 'active') return bad(res, 409, 'session not active');
  const { text = '', spokenMs = 0, turnKey, sttConfidence = null, clientLatencyMs = null, silence = false, capped = false } = req.body;
  // Idempotency: a retried request after a network drop gets the same answer.
  if (turnKey && s.state.lastTurnKey === turnKey && s.state.lastResponse) return res.json(s.state.lastResponse);
  const v = getViva(s.viva_id);
  const el = elapsedOf(s);
  const history = getTurns(s.id);
  const askedPhase = v.phases[Math.min(s.state.phaseIdx, v.phases.length - 1)].key;
  if (clientLatencyMs != null) {
    const lastAi = history.filter(h => h.role === 'ai').at(-1);
    if (lastAi) db.prepare("UPDATE turns SET meta = json_set(meta, '$.clientLatencyMs', ?) WHERE id = ?").run(clientLatencyMs, lastAi.id);
  }
  if (silence) addEvent(s.id, el, 'silence', {});
  if (capped) addEvent(s.id, el, 'answer_capped', { seconds: MAX_ANSWER_SECONDS });

  const r = await nextTurn({ viva: v, session: s, bank: getQuestions(v.id), history, answer: String(text).slice(0, 4000), elapsed: el });
  const latency = Date.now() - t0;
  latencies.push(latency); if (latencies.length > 5000) latencies.shift();
  const elAfter = elapsedOf(s);
  addTurn({ session_id: s.id, role: 'student', text: String(text).slice(0, 4000), t_start: Math.max(0, el - spokenMs / 1000), t_end: el,
    phase: askedPhase, question_id: s.state.q?.id, assessment: r.assessment, meta: { sttConfidence, silence, capped } });
  addTurn({ session_id: s.id, role: 'ai', text: r.say, t_start: elAfter, phase: r.phaseKey, question_id: r.questionId, action: r.action,
    latency_ms: latency, meta: { mode: r.mode, prompt_version: INTERVIEWER_PROMPT_VERSION, model: r.mode === 'llm' ? env.interviewerModel : r.mode } });
  if (r.state.bankExhaustedAt != null && s.state.bankExhaustedAt == null) addEvent(s.id, r.state.bankExhaustedAt, 'bank_exhausted', {});
  const response = { say: r.say, action: r.action, done: r.done, ...snapshot({ ...s, state: r.state }, v), serverLatencyMs: latency };
  saveState(s.id, { ...r.state, lastTurnKey: turnKey, lastResponse: response });
  res.json(response);
}));

app.post('/api/student/sessions/:id/event', (req, res) => {
  const s = getSession(req.params.id); if (!s) return bad(res, 404, 'session not found');
  const { type, detail } = req.body;
  if (!['tab_hidden', 'tab_visible', 'silence', 'paste', 'mic_muted', 'network_lost', 'network_restored', 'multiple_voices', 'stt_unavailable'].includes(type)) return bad(res, 400, 'unknown event');
  addEvent(s.id, s.started_at ? elapsedOf(s) : 0, type, detail || {});
  res.json({ ok: true });
});

// Audio is streamed up in ~5 s chunks and appended to disk immediately, so a crash or
// disconnect loses at most one chunk. Each (re)connection is a new segment file.
app.post('/api/student/sessions/:id/audio', express.raw({ type: () => true, limit: '5mb' }), (req, res) => {
  const s = getSession(req.params.id); if (!s) return bad(res, 404, 'session not found');
  const seg = String(req.query.seg || '0').replace(/[^0-9]/g, '');
  const file = path.join(AUDIO_DIR, `${s.id}_${seg}.webm`);
  if (!fs.existsSync(file)) addEvent(s.id, Number(req.query.t || 0), 'audio_segment', { seg, file: path.basename(file), startT: Number(req.query.t || 0) });
  fs.appendFileSync(file, req.body);
  res.json({ ok: true, bytes: req.body.length });
});

app.post('/api/student/sessions/:id/end', (req, res) => {
  const s = getSession(req.params.id); if (!s) return bad(res, 404, 'session not found');
  if (s.status === 'ended') return res.json({ ok: true });
  db.prepare("UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(Date.now(), s.id);
  addEvent(s.id, s.started_at ? elapsedOf(s) : 0, 'ended', { reason: req.body?.reason || 'completed' });
  enqueueScoring(s.id);
  res.json({ ok: true });
});

// Server-side hard limit: close any viva past its slot even if the browser vanished.
setInterval(() => {
  for (const r of db.prepare("SELECT s.id, s.started_at, v.phases FROM sessions s JOIN vivas v ON v.id = s.viva_id WHERE s.status = 'active'").all()) {
    const slot = slotSeconds(JSON.parse(r.phases));
    if ((Date.now() - r.started_at) / 1000 > slot + 60) {
      db.prepare("UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(Date.now(), r.id);
      addEvent(r.id, slot, 'ended', { reason: 'server_timeout' });
      enqueueScoring(r.id);
    }
  }
}, 30000).unref();

// ---------- faculty: review dashboard ----------
app.get('/api/faculty/sessions', faculty, (req, res) => {
  const rows = db.prepare(`SELECT s.id, s.student_id, s.student_name, s.status, s.score_status, s.ai_total, s.final_total, s.needs_review,
    s.started_at, s.ended_at, s.override, v.subject, v.code FROM sessions s JOIN vivas v ON v.id = s.viva_id ORDER BY s.started_at DESC`).all();
  res.json(rows.map(r => ({ ...r, overridden: !!r.override, override: undefined })));
});

app.get('/api/faculty/sessions/:id', faculty, (req, res) => {
  const s = getSession(req.params.id); if (!s) return bad(res, 404, 'session not found');
  const v = getViva(s.viva_id);
  const turns = getTurns(s.id);
  const events = getEvents(s.id);
  const bank = Object.fromEntries(getQuestions(v.id, false).map(q => [q.id, q]));
  res.json({
    session: { ...s, state: undefined }, viva: { subject: v.subject, code: v.code, phases: v.phases, rubric: v.rubric },
    transcript: transcriptLines(turns).map((l, i) => ({ ...l, question: bank[turns[i].question_id]?.text || null, questionId: turns[i].question_id,
      variantOf: /^(var|rev):/.test(turns[i].question_id || '') ? turns[i].question_id.split(':')[1] : null,
      action: turns[i].action, latencyMs: turns[i].latency_ms, meta: turns[i].meta })),
    events, audio: events.filter(e => e.type === 'audio_segment').map(e => ({ url: `/api/faculty/audio/${e.detail.file}`, startT: e.detail.startT })),
    audit: getAudit(s.id),
  });
});

app.get('/api/faculty/audio/:file', faculty, (req, res) => {
  const f = path.basename(req.params.file);
  const p = path.join(AUDIO_DIR, f);
  if (!fs.existsSync(p)) return bad(res, 404, 'no audio');
  res.type('audio/webm').sendFile(p);
});

app.post('/api/faculty/sessions/:id/override', faculty, (req, res) => {
  const s = getSession(req.params.id); if (!s) return bad(res, 404, 'session not found');
  const { reviewer, reason, total, dimensions } = req.body;
  if (!reviewer || !reason) return bad(res, 400, 'reviewer name and reason are required');
  const t = Number(total);
  if (!(t >= 0 && t <= 100)) return bad(res, 400, 'total must be 0-100');
  const ov = { reviewer, reason, total: t, dimensions: dimensions || null, at: nowIso(), previous: s.final_total };
  db.prepare('UPDATE sessions SET override = ?, final_total = ?, needs_review = 0 WHERE id = ?').run(JSON.stringify(ov), t, s.id);
  addAudit(s.id, `faculty:${reviewer}`, 'override', ov);
  res.json({ ok: true });
});

app.post('/api/faculty/sessions/:id/rescore', faculty, (req, res) => {
  const s = getSession(req.params.id); if (!s) return bad(res, 404, 'session not found');
  if (s.status !== 'ended') return bad(res, 409, 'session not ended');
  addAudit(s.id, 'faculty', 'rescore_requested', {});
  enqueueScoring(s.id);
  res.json({ ok: true });
});

app.get('/api/faculty/calibration', faculty, (req, res) => {
  const rows = db.prepare('SELECT ai_total, override FROM sessions WHERE override IS NOT NULL AND ai_total IS NOT NULL').all()
    .map(r => ({ ai: r.ai_total, faculty: JSON.parse(r.override).total }));
  const n = rows.length;
  if (!n) return res.json({ n: 0 });
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const ai = rows.map(r => r.ai), fa = rows.map(r => r.faculty);
  const ma = mean(ai), mf = mean(fa);
  const cov = rows.reduce((a, r) => a + (r.ai - ma) * (r.faculty - mf), 0);
  const sa = Math.sqrt(ai.reduce((a, x) => a + (x - ma) ** 2, 0)), sf = Math.sqrt(fa.reduce((a, x) => a + (x - mf) ** 2, 0));
  res.json({ n, meanAbsGap: +mean(rows.map(r => Math.abs(r.ai - r.faculty))).toFixed(2), meanSignedGap: +(ma - mf).toFixed(2),
    pearson: sa && sf ? +(cov / (sa * sf)).toFixed(3) : null, rows });
});

app.get('/api/faculty/export.csv', faculty, (req, res) => {
  const rows = db.prepare(`SELECT s.*, v.subject, v.code FROM sessions s JOIN vivas v ON v.id = s.viva_id ORDER BY v.code, s.student_id`).all();
  const keys = DEFAULT_RUBRIC.map(r => r.key);
  const esc = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const lines = [['viva_code', 'subject', 'student_id', 'name', 'status', 'ai_total', 'final_total', 'overridden_by', 'override_reason', 'needs_review', ...keys, 'prompt_version', 'scorer_model'].join(',')];
  for (const r of rows) {
    const sc = r.score ? JSON.parse(r.score) : null, ov = r.override ? JSON.parse(r.override) : null;
    lines.push([r.code, r.subject, r.student_id, r.student_name, r.status, r.ai_total, r.final_total, ov?.reviewer, ov?.reason, r.needs_review,
      ...keys.map(k => sc?.dimensions.find(d => d.key === k)?.score), sc?.prompt_version, sc?.model].map(esc).join(','));
  }
  res.type('text/csv').attachment('viva-results.csv').send(lines.join('\n'));
});

// Demo viva so a fresh install is usable immediately (disable with SEED_DEMO=0).
function seedDemo() {
  if (process.env.SEED_DEMO === '0' || getViva('DBMS-DEMO')) return;
  const id = uid('v_');
  db.prepare('INSERT INTO vivas (id, code, subject, topics, difficulty, phases, rubric, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, 'DBMS-DEMO', 'Database Management Systems', JSON.stringify(['normalization', 'indexing', 'transactions', 'sql']), 'medium',
      JSON.stringify(DEFAULT_PHASES), JSON.stringify(DEFAULT_RUBRIC), nowIso());
  const bank = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'data/samples/dbms-question-bank.json'), 'utf8'));
  insertQuestions(id, bank, 'sample', true);
  console.log('Seeded demo viva DBMS-DEMO');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  resumeQueue();
  seedDemo();
  app.listen(env.port, () => console.log(`AI Viva Agent on http://localhost:${env.port} (${MOCK ? 'MOCK mode: no ANTHROPIC_API_KEY' : 'LLM mode'})`));
}
export default app;
