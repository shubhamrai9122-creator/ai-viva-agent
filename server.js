import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, uid, nowIso, getViva, listVivas, getQuestions, insertQuestions, getSession, saveState, getTurns, addTurn,
  addEvent, getEvents, addAudit, getAudit, addAudioChunk, getAudio, DB_KIND } from './src/db.js';
import { DEFAULT_PHASES, DEFAULT_RUBRIC, QUICK_DEFAULTS, QUICK_RUBRIC, SLOT_SECONDS, MAX_ANSWER_SECONDS, env, MOCK } from './src/config.js';
import { greeting, initialState, nextTurn, totalSeconds, timePhaseIndex, INTERVIEWER_PROMPT_VERSION,
  isTimed, startTimed, nextTimedTurn, vivaSlotSeconds, phaseOfQuestion } from './src/interviewer.js';
import { enqueueScoring, resumeQueue, queueStats, scoreNow, SERVERLESS } from './src/queue.js';
import { parseBank, generateBank, importDocument, sniffType } from './src/questionbank.js';
import { requestCode, verifyCode, readToken, issueToken, normaliseEmail, checkEmail } from './src/auth.js';
import { EMAIL_MODE } from './src/mailer.js';
import { transcriptLines } from './src/scorer.js';
import { stats as llmStats } from './src/llm.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));

const elapsedOf = s => (Date.now() - s.started_at) / 1000;
const bad = (res, code, msg) => res.status(code).json({ error: msg });
// Express 4 doesn't catch errors from async handlers; this sends them back as JSON.
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(err => { console.error(err); bad(res, 500, err.message || 'server error'); });

// ---------- health / metrics ----------
const latencies = [];
app.get('/api/health', wrap(async (req, res) => {
  const sorted = [...latencies].sort((a, b) => a - b);
  const p = q => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
  const active = (await db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE status = 'active'").get()).n;
  res.json({ ok: true, mode: MOCK ? 'mock' : 'llm', emailMode: EMAIL_MODE, database: DB_KIND, interviewerModel: env.interviewerModel, scorerModel: env.scorerModel,
    activeSessions: active, turnLatencyMs: { n: sorted.length, p50: p(0.5), p95: p(0.95) }, llm: llmStats, queue: queueStats(),
    memoryMB: Math.round(process.memoryUsage().rss / 1e6) });
}));

// ---------- faculty auth (shared passcode for the MVP) ----------
function faculty(req, res, next) {
  if (req.get('x-faculty-key') !== env.facultyKey && req.query.key !== env.facultyKey) return bad(res, 401, 'faculty passcode required');
  next();
}

// ---------- faculty: viva setup ----------
app.get('/api/faculty/vivas', faculty, wrap(async (req, res) => res.json(await listVivas())));
app.get('/api/faculty/defaults', faculty, (req, res) => res.json({ phases: DEFAULT_PHASES, rubric: DEFAULT_RUBRIC }));

app.post('/api/faculty/vivas', faculty, wrap(async (req, res) => {
  const { subject, topics = [], difficulty = 'medium', phases, bankText, bankFormat, questions } = req.body;
  if (!subject) return bad(res, 400, 'subject required');
  // Quick (default): N questions x S seconds. Full: the 15-minute phased structure.
  const format = req.body.format === 'phased' ? 'phased' : 'timed';
  const questionCount = Number(req.body.questionCount ?? QUICK_DEFAULTS.questionCount);
  const secondsPerQuestion = Number(req.body.secondsPerQuestion ?? QUICK_DEFAULTS.secondsPerQuestion);
  if (format === 'timed') {
    if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 20) return bad(res, 400, 'number of questions must be between 1 and 20');
    if (!Number.isFinite(secondsPerQuestion) || secondsPerQuestion < 20 || secondsPerQuestion > 300) return bad(res, 400, 'time per question must be between 20 and 300 seconds');
    if (questionCount * secondsPerQuestion > SLOT_SECONDS - 30) return bad(res, 400, 'questions x time per question must be at most 14:30');
  }
  const ph = Array.isArray(phases) && phases.length ? phases.map((p, i) => ({ ...DEFAULT_PHASES[i], ...p, seconds: Number(p.seconds) })) : DEFAULT_PHASES;
  if (ph.some(p => !Number.isFinite(p.seconds) || p.seconds < 0)) return bad(res, 400, 'phase timings must be positive numbers of seconds');
  // Phases plus the 30 s scoring hand-off must fit in the 15-minute slot.
  if (format === 'phased' && totalSeconds(ph) > SLOT_SECONDS - 30) return bad(res, 400, `phases must total at most ${SLOT_SECONDS - 30} seconds (14:30)`);
  const id = uid('v_');
  const code = String(req.body.code || subject.replace(/[^A-Za-z]/g, '').slice(0, 4) + '-' + Math.floor(1000 + Math.random() * 9000)).trim().toUpperCase();
  if (await getViva(code)) return bad(res, 409, `viva code ${code} is already in use`);
  await db.prepare('INSERT INTO vivas (id, code, subject, topics, difficulty, phases, rubric, created_at, format, question_count, seconds_per_question) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, code, subject, JSON.stringify(topics), difficulty, JSON.stringify(ph), JSON.stringify(format === 'timed' ? QUICK_RUBRIC : DEFAULT_RUBRIC), nowIso(),
      format, format === 'timed' ? questionCount : null, format === 'timed' ? secondsPerQuestion : null);
  let added = 0;
  if (bankText) added += (await insertQuestions(id, parseBank(bankText, bankFormat), 'upload', true)).length;
  if (Array.isArray(questions)) added += (await insertQuestions(id, questions, 'upload', true)).length;
  res.json({ id, code, added });
}));

app.post('/api/faculty/vivas/:id/questions', faculty, wrap(async (req, res) => {
  const v = await getViva(req.params.id); if (!v) return bad(res, 404, 'viva not found');
  const qs = req.body.bankText ? parseBank(req.body.bankText, req.body.bankFormat) : req.body.questions || [];
  res.json({ added: (await insertQuestions(v.id, qs, 'upload', true)).length });
}));

app.post('/api/faculty/vivas/:id/generate', faculty, wrap(async (req, res) => {
  const v = await getViva(req.params.id); if (!v) return bad(res, 404, 'viva not found');
  const qs = await generateBank({ subject: v.subject, topics: v.topics, difficulty: v.difficulty, syllabus: req.body.syllabus, count: req.body.count || 12 });
  const ids = await insertQuestions(v.id, qs, 'ai-generated', false);
  res.json({ added: ids.length });
}));

// PDF / PNG / JPG question paper or syllabus -> draft questions awaiting approval.
app.post('/api/faculty/vivas/:id/import', faculty, express.raw({ type: () => true, limit: '15mb' }), wrap(async (req, res) => {
  const v = await getViva(req.params.id); if (!v) return bad(res, 404, 'viva not found');
  if (!Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 400, 'empty file');
  const type = sniffType(req.body);
  if (!type) return bad(res, 400, 'Unsupported file. Upload a PDF, PNG or JPG (or CSV/JSON for a ready-made bank).');
  try {
    const { questions, method } = await importDocument({ buf: req.body, viva: v });
    const ids = await insertQuestions(v.id, questions, `${type.kind}-import`, false);
    res.json({ added: ids.length, method });
  } catch (err) {
    if (err.status) return bad(res, err.status, err.message);
    throw err;
  }
}));

app.get('/api/faculty/vivas/:id/questions', faculty, wrap(async (req, res) => res.json(await getQuestions(req.params.id, false))));
app.post('/api/faculty/questions/approve', faculty, wrap(async (req, res) => {
  const { ids = [], approved = true } = req.body;
  if (ids.length) await db.batch(ids.map(id => ['UPDATE questions SET approved = ? WHERE id = ?', [approved ? 1 : 0, id]]));
  res.json({ updated: ids.length });
}));
app.delete('/api/faculty/questions/:id', faculty, wrap(async (req, res) => {
  await db.prepare('DELETE FROM questions WHERE id = ? AND approved = 0').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- student sign-in (email one-time code) ----------
app.post('/api/auth/request-code', wrap(async (req, res) => {
  const r = await requestCode(req.body?.email);
  if (r.error) { if (r.retryAfter) res.set('retry-after', String(r.retryAfter)); return bad(res, r.status, r.error); }
  res.json({ ok: true, email: r.email, delivery: EMAIL_MODE, ...(r.demoCode ? { demoCode: r.demoCode } : {}) });
}));
app.post('/api/auth/verify', wrap(async (req, res) => {
  const r = await verifyCode(req.body?.email, req.body?.code);
  if (r.error) return bad(res, r.status, r.error);
  res.json(r);
}));
app.get('/api/auth/me', (req, res) => {
  const email = readToken(req.get('x-student-token'));
  if (!email) return bad(res, 401, 'not signed in');
  res.json({ email });
});
// Faculty can mint a student token for load tests and demos (never needed by real students).
app.post('/api/faculty/student-token', faculty, (req, res) => {
  const email = normaliseEmail(req.body?.email);
  const err = checkEmail(email); if (err) return bad(res, 400, err);
  res.json({ token: issueToken(email), email });
});

function studentAuth(req, res, next) {
  const email = readToken(req.get('x-student-token'));
  if (!email) return bad(res, 401, 'Please sign in with your email first');
  req.studentEmail = email;
  next();
}
// Every viva request must come from the student who started it. The loaded session is
// passed along so handlers don't read it twice.
const ownSession = wrap(async (req, res, next) => {
  const s = await getSession(req.params.id);
  if (!s) return bad(res, 404, 'session not found');
  if (s.student_email !== req.studentEmail) return bad(res, 403, 'This viva belongs to a different student');
  req.session = s;
  next();
});
app.all('/api/student/sessions/:id/*', studentAuth, ownSession);

// ---------- student: join, consent, interview ----------
// Viva codes shown on the student page so they can pick one (LIST_VIVA_CODES=0 hides them).
app.get('/api/student/vivas', wrap(async (req, res) => {
  if (process.env.LIST_VIVA_CODES === '0') return res.json([]);
  const vivas = (await listVivas()).filter(v => v.approved_questions > 0).sort((a, b) => a.created_at.localeCompare(b.created_at));   // oldest (DS-DEMO) first
  res.json(vivas.map(v => ({ code: v.code, subject: v.subject, format: v.format, questionCount: v.questionCount, secondsPerQuestion: v.secondsPerQuestion })));
}));

// Lets the join page check the code up front and show the real duration in the rules.
app.get('/api/student/vivas/:code', wrap(async (req, res) => {
  const v = await getViva(String(req.params.code || '').trim().toUpperCase());
  if (!v) return bad(res, 404, 'Viva code not found');
  if (!(await getQuestions(v.id)).length) return bad(res, 409, 'This viva has no approved questions yet');
  res.json(publicViva(v));
}));

app.post('/api/student/join', studentAuth, wrap(async (req, res) => {
  const { code, studentId, name, consent, language = 'en-IN' } = req.body;
  const email = req.studentEmail;
  const v = (await getViva(String(code || '').trim().toUpperCase())) || (await getViva(String(code || '').trim()));
  if (!v) return bad(res, 404, 'Viva code not found');
  if (!studentId) return bad(res, 400, 'Student ID required');
  if (!consent) return bad(res, 400, 'Consent to recording is required to take the viva');
  if (!(await getQuestions(v.id)).length) return bad(res, 409, 'This viva has no approved questions yet');
  // One attempt per student: matched by verified email, and a student ID can't be reused by another email.
  const byId = await db.prepare('SELECT id, student_email FROM sessions WHERE viva_id = ? AND student_id = ?').get(v.id, String(studentId).trim());
  if (byId && byId.student_email !== email) return bad(res, 409, 'This student ID has already been used for this viva with a different email. Contact your examiner.');
  const existing = (await db.prepare('SELECT id FROM sessions WHERE viva_id = ? AND student_email = ?').get(v.id, email)) || byId;
  if (existing) {
    const s = await getSession(existing.id);
    if (s.status === 'ended') return bad(res, 409, 'You have already completed this viva');
    await addEvent(s.id, s.started_at ? elapsedOf(s) : 0, 'rejoin', {});
    await db.prepare('UPDATE sessions SET consent_at = ? WHERE id = ?').run(nowIso(), s.id);
    return res.json({ sessionId: s.id, resumed: !!s.started_at, viva: publicViva(v) });
  }
  const id = uid('s_');
  await db.prepare(`INSERT INTO sessions (id, viva_id, student_id, student_name, student_email, language, consent_at, status, state, score_status)
    VALUES (?,?,?,?,?,?,?,'joined',?, 'pending')`).run(id, v.id, String(studentId).trim(), name || '', email, language, nowIso(), JSON.stringify(initialState()));
  await addAudit(id, `student:${email}`, 'consented', { language, studentId: String(studentId).trim() });
  res.json({ sessionId: id, resumed: false, viva: publicViva(v) });
}));

const publicViva = v => isTimed(v)
  ? { subject: v.subject, topics: v.topics, format: 'timed', questionCount: v.questionCount, secondsPerQuestion: v.secondsPerQuestion, phases: [],
    interviewSeconds: v.questionCount * v.secondsPerQuestion, slotSeconds: vivaSlotSeconds(v), maxAnswerSeconds: v.secondsPerQuestion }
  : { subject: v.subject, topics: v.topics, format: 'phased', phases: v.phases.map(({ key, label, seconds }) => ({ key, label, seconds })),
    interviewSeconds: totalSeconds(v.phases), slotSeconds: vivaSlotSeconds(v), maxAnswerSeconds: MAX_ANSWER_SECONDS };

function snapshot(s, v) {
  const el = s.started_at ? elapsedOf(s) : 0;
  if (isTimed(v)) return { elapsed: el, interviewSeconds: vivaSlotSeconds(v), questionNumber: s.state.qNum || 1, questionCount: v.questionCount, status: s.status };
  const idx = Math.max(s.state.phaseIdx || 0, timePhaseIndex(v.phases, el));
  return { elapsed: el, interviewSeconds: totalSeconds(v.phases), phase: v.phases[Math.min(idx, v.phases.length - 1)].key, status: s.status };
}

app.post('/api/student/sessions/:id/start', wrap(async (req, res) => {
  const s = req.session;
  const v = await getViva(s.viva_id);
  if (s.status === 'ended') return bad(res, 409, 'viva already ended');
  if (s.started_at) {
    // Rejoin: repeat the last examiner line; the clock keeps running (same time for everyone).
    const last = await db.prepare("SELECT text FROM turns WHERE session_id = ? AND role = 'ai' ORDER BY id DESC LIMIT 1").get(s.id);
    return res.json({ say: `Welcome back. ${last?.text || ''}`, ...snapshot(s, v), done: false });
  }
  const startedAt = Date.now();
  await db.prepare("UPDATE sessions SET started_at = ?, status = 'active' WHERE id = ?").run(startedAt, s.id);
  const started = { ...s, started_at: startedAt, status: 'active' };
  if (isTimed(v)) {
    const t = startTimed(v, s, await getQuestions(v.id));
    await saveState(s.id, t.state);
    await addTurn({ session_id: s.id, role: 'ai', text: t.say, t_start: 0, phase: t.phaseKey, question_id: t.questionId, action: 'greeting', meta: { prompt_version: INTERVIEWER_PROMPT_VERSION } });
    return res.json({ say: t.say, ...snapshot({ ...started, state: t.state }, v), done: false });
  }
  const say = greeting(v, s);
  await addTurn({ session_id: s.id, role: 'ai', text: say, t_start: 0, phase: 'warmup', question_id: 'opener', action: 'greeting', meta: { prompt_version: INTERVIEWER_PROMPT_VERSION } });
  res.json({ say, ...snapshot(started, v), done: false });
}));

app.post('/api/student/sessions/:id/turn', wrap(async (req, res) => {
  const t0 = Date.now();
  const s = req.session;
  if (s.status !== 'active') return bad(res, 409, 'session not active');
  const { text = '', spokenMs = 0, turnKey, sttConfidence = null, clientLatencyMs = null, silence = false, capped = false } = req.body;
  // Idempotency: a retried request after a network drop gets the same answer.
  if (turnKey && s.state.lastTurnKey === turnKey && s.state.lastResponse) return res.json(s.state.lastResponse);
  const [v, history] = await Promise.all([getViva(s.viva_id), getTurns(s.id)]);
  const el = elapsedOf(s);
  const askedPhase = isTimed(v) ? phaseOfQuestion(s.state.q) : v.phases[Math.min(s.state.phaseIdx, v.phases.length - 1)].key;
  if (clientLatencyMs != null) {
    const lastAi = history.filter(h => h.role === 'ai').at(-1);
    if (lastAi) await db.prepare("UPDATE turns SET meta = json_set(meta, '$.clientLatencyMs', ?) WHERE id = ?").run(clientLatencyMs, lastAi.id);
  }
  if (silence) await addEvent(s.id, el, 'silence', {});
  if (capped) await addEvent(s.id, el, 'answer_capped', { seconds: isTimed(v) ? v.secondsPerQuestion : MAX_ANSWER_SECONDS });

  const r = await (isTimed(v) ? nextTimedTurn : nextTurn)({ viva: v, session: s, bank: await getQuestions(v.id), history, answer: String(text).slice(0, 4000), elapsed: el });
  const latency = Date.now() - t0;
  latencies.push(latency); if (latencies.length > 5000) latencies.shift();
  const elAfter = elapsedOf(s);
  await addTurn({ session_id: s.id, role: 'student', text: String(text).slice(0, 4000), t_start: Math.max(0, el - spokenMs / 1000), t_end: el,
    phase: askedPhase, question_id: s.state.q?.id, assessment: r.assessment, meta: { sttConfidence, silence, capped } });
  await addTurn({ session_id: s.id, role: 'ai', text: r.say, t_start: elAfter, phase: r.phaseKey, question_id: r.questionId, action: r.action,
    latency_ms: latency, meta: { mode: r.mode, prompt_version: INTERVIEWER_PROMPT_VERSION, model: r.mode === 'llm' ? env.interviewerModel : r.mode } });
  if (r.state.bankExhaustedAt != null && s.state.bankExhaustedAt == null) await addEvent(s.id, r.state.bankExhaustedAt, 'bank_exhausted', {});
  const response = { say: r.say, action: r.action, done: r.done, ...snapshot({ ...s, state: r.state }, v), serverLatencyMs: latency };
  await saveState(s.id, { ...r.state, lastTurnKey: turnKey, lastResponse: response });
  res.json(response);
}));

app.post('/api/student/sessions/:id/event', wrap(async (req, res) => {
  const s = req.session;
  const { type, detail } = req.body;
  if (!['tab_hidden', 'tab_visible', 'silence', 'paste', 'mic_muted', 'network_lost', 'network_restored', 'multiple_voices', 'stt_unavailable'].includes(type)) return bad(res, 400, 'unknown event');
  await addEvent(s.id, s.started_at ? elapsedOf(s) : 0, type, detail || {});
  res.json({ ok: true });
}));

// Audio is streamed up in ~5 s chunks and stored straight away, so a crash or disconnect
// loses at most one chunk. Each (re)connection starts a new segment.
app.post('/api/student/sessions/:id/audio', express.raw({ type: () => true, limit: '5mb' }), wrap(async (req, res) => {
  const s = req.session;
  if (!Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 400, 'empty audio chunk');
  const seg = String(req.query.seg || '0').replace(/[^0-9]/g, '') || '0';
  const startT = Number(req.query.t || 0);
  if (await addAudioChunk(s.id, seg, req.body)) await addEvent(s.id, startT, 'audio_segment', { seg, startT });
  res.json({ ok: true, bytes: req.body.length });
}));

app.post('/api/student/sessions/:id/end', wrap(async (req, res) => {
  const s = req.session;
  if (s.status === 'ended') return res.json({ ok: true });
  await db.prepare("UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(Date.now(), s.id);
  await addEvent(s.id, s.started_at ? elapsedOf(s) : 0, 'ended', { reason: req.body?.reason || 'completed' });
  if (SERVERLESS) await scoreNow(s.id); else enqueueScoring(s.id);
  res.json({ ok: true });
}));

// Server-side hard limit: close any viva past its slot even if the browser vanished.
async function closeAbandoned() {
  for (const r of await db.prepare("SELECT id, started_at, viva_id FROM sessions WHERE status = 'active'").all()) {
    const slot = vivaSlotSeconds(await getViva(r.viva_id));
    if ((Date.now() - r.started_at) / 1000 > slot + 60) {
      await db.prepare("UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(Date.now(), r.id);
      await addEvent(r.id, slot, 'ended', { reason: 'server_timeout' });
      if (SERVERLESS) await scoreNow(r.id); else enqueueScoring(r.id);
    }
  }
}
if (!SERVERLESS) setInterval(() => closeAbandoned().catch(err => console.error('[sweep]', err.message)), 30000).unref();

// ---------- faculty: review dashboard ----------
app.get('/api/faculty/sessions', faculty, wrap(async (req, res) => {
  if (SERVERLESS) await closeAbandoned();   // no background timers on serverless: sweep when faculty look
  const rows = await db.prepare(`SELECT s.id, s.student_id, s.student_name, s.student_email, s.status, s.score_status, s.ai_total, s.final_total, s.needs_review,
    s.started_at, s.ended_at, s.override, v.subject, v.code FROM sessions s JOIN vivas v ON v.id = s.viva_id ORDER BY s.started_at DESC`).all();
  res.json(rows.map(r => ({ ...r, overridden: !!r.override, override: undefined })));
}));

app.get('/api/faculty/sessions/:id', faculty, wrap(async (req, res) => {
  const s = await getSession(req.params.id); if (!s) return bad(res, 404, 'session not found');
  const v = await getViva(s.viva_id);
  const [turns, events, questions, audit] = await Promise.all([getTurns(s.id), getEvents(s.id), getQuestions(v.id, false), getAudit(s.id)]);
  const bank = Object.fromEntries(questions.map(q => [q.id, q]));
  res.json({
    session: { ...s, state: undefined }, viva: { subject: v.subject, code: v.code, phases: v.phases, rubric: v.rubric },
    transcript: transcriptLines(turns).map((l, i) => ({ ...l, question: bank[turns[i].question_id]?.text || null, questionId: turns[i].question_id,
      variantOf: /^(var|rev):/.test(turns[i].question_id || '') ? turns[i].question_id.split(':')[1] : null,
      action: turns[i].action, latencyMs: turns[i].latency_ms, meta: turns[i].meta })),
    events, audio: events.filter(e => e.type === 'audio_segment').map(e => ({ url: `/api/faculty/audio/${s.id}/${e.detail.seg}`, startT: e.detail.startT })),
    audit,
  });
}));

app.get('/api/faculty/audio/:sessionId/:seg', faculty, wrap(async (req, res) => {
  const audio = await getAudio(req.params.sessionId, String(req.params.seg).replace(/[^0-9]/g, ''));
  if (!audio) return bad(res, 404, 'no audio');
  res.type('audio/webm').send(audio);
}));

app.post('/api/faculty/sessions/:id/override', faculty, wrap(async (req, res) => {
  const s = await getSession(req.params.id); if (!s) return bad(res, 404, 'session not found');
  const { reviewer, reason, total, dimensions } = req.body;
  if (!reviewer || !reason) return bad(res, 400, 'reviewer name and reason are required');
  const t = Number(total);
  if (!(t >= 0 && t <= 100)) return bad(res, 400, 'total must be 0-100');
  const ov = { reviewer, reason, total: t, dimensions: dimensions || null, at: nowIso(), previous: s.final_total };
  await db.prepare('UPDATE sessions SET override = ?, final_total = ?, needs_review = 0 WHERE id = ?').run(JSON.stringify(ov), t, s.id);
  await addAudit(s.id, `faculty:${reviewer}`, 'override', ov);
  res.json({ ok: true });
}));

app.post('/api/faculty/sessions/:id/rescore', faculty, wrap(async (req, res) => {
  const s = await getSession(req.params.id); if (!s) return bad(res, 404, 'session not found');
  if (s.status !== 'ended') return bad(res, 409, 'session not ended');
  await addAudit(s.id, 'faculty', 'rescore_requested', {});
  if (SERVERLESS) await scoreNow(s.id); else enqueueScoring(s.id);
  res.json({ ok: true });
}));

app.get('/api/faculty/calibration', faculty, wrap(async (req, res) => {
  const rows = (await db.prepare('SELECT ai_total, override FROM sessions WHERE override IS NOT NULL AND ai_total IS NOT NULL').all())
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
}));

app.get('/api/faculty/export.csv', faculty, wrap(async (req, res) => {
  const rows = await db.prepare(`SELECT s.*, v.subject, v.code FROM sessions s JOIN vivas v ON v.id = s.viva_id ORDER BY v.code, s.student_id`).all();
  const keys = DEFAULT_RUBRIC.map(r => r.key);
  const esc = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const lines = [['viva_code', 'subject', 'student_id', 'name', 'email', 'status', 'ai_total', 'final_total', 'overridden_by', 'override_reason', 'needs_review', ...keys, 'prompt_version', 'scorer_model'].join(',')];
  for (const r of rows) {
    const sc = r.score ? JSON.parse(r.score) : null, ov = r.override ? JSON.parse(r.override) : null;
    lines.push([r.code, r.subject, r.student_id, r.student_name, r.student_email, r.status, r.ai_total, r.final_total, ov?.reviewer, ov?.reason, r.needs_review,
      ...keys.map(k => sc?.dimensions.find(d => d.key === k)?.score), sc?.prompt_version, sc?.model].map(esc).join(','));
  }
  res.type('text/csv').attachment('viva-results.csv').send(lines.join('\n'));
}));

// Demo vivas so a fresh install is usable immediately (disable with SEED_DEMO=0).
const DEMO_VIVAS = [
  { code: 'DS-DEMO', format: 'timed', questionCount: 5, secondsPerQuestion: 60 },
  { code: 'DS-PRACTICE', format: 'timed', questionCount: 3, secondsPerQuestion: 60 },
  { code: 'DS-FULL', format: 'phased' },
];
async function seedDemo() {
  if (process.env.SEED_DEMO === '0') return;
  const topics = ['arrays and linked lists', 'stacks', 'queues', 'hashing', 'trees', 'heaps', 'graphs', 'sorting'];
  const bank = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'data/samples/ds-question-bank.json'), 'utf8'));
  for (const d of DEMO_VIVAS) {
    if (await getViva(d.code)) continue;
    const id = uid('v_');
    const timed = d.format === 'timed';
    await db.prepare('INSERT INTO vivas (id, code, subject, topics, difficulty, phases, rubric, created_at, format, question_count, seconds_per_question) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, d.code, 'Data Structures', JSON.stringify(topics), 'medium', JSON.stringify(DEFAULT_PHASES), JSON.stringify(timed ? QUICK_RUBRIC : DEFAULT_RUBRIC), nowIso(),
        d.format, timed ? d.questionCount : null, timed ? d.secondsPerQuestion : null);
    await insertQuestions(id, bank, 'sample', true);
    console.log(`Seeded demo viva ${d.code}`);
  }
}

if (SERVERLESS) await seedDemo().catch(err => console.error('[seed]', err.message));   // two instances racing: the code is UNIQUE, so one insert simply fails

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await resumeQueue();
  await seedDemo();
  app.listen(env.port, () => console.log(`AI Viva Agent on http://localhost:${env.port} (${MOCK ? 'MOCK mode: no ANTHROPIC_API_KEY' : 'LLM mode'}, ${DB_KIND} database)`));
}
export default app;
