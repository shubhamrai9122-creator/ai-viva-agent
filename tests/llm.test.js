// LLM-mode integration test against a local fake of the Anthropic Messages API.
// Exercises the real request path (SDK, headers, structured output, retries, fallbacks,
// refusals) and how the interviewer and scorer use the model's answers, without an API key.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';

const requests = [];
let replies = [];
const message = (json, extra = {}) => ({ status: 200, body: {
  id: 'msg_test', type: 'message', role: 'assistant', model: extra.model || 'claude-test',
  content: [{ type: 'text', text: JSON.stringify(json) }], stop_reason: extra.stop_reason || 'end_turn', stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 80 } } });
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => raw += c);
  req.on('end', () => {
    requests.push({ url: req.url, headers: req.headers, body: JSON.parse(raw || '{}') });
    const r = replies.shift() || { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'no reply queued' } } };
    res.writeHead(r.status, { 'content-type': 'application/json', ...(r.headers || {}) });
    res.end(JSON.stringify(r.body));
  });
});

let interviewer, scorer, llm, db, sim, bank;
before(async () => {
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  delete process.env.LLM_MODE;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'viva-llm-'));
  interviewer = await import('../src/interviewer.js');
  scorer = await import('../src/scorer.js');
  llm = await import('../src/llm.js');
  db = await import('../src/db.js');
  sim = await import('../scripts/sim.js');
  assert.equal((await import('../src/config.js')).MOCK, false, 'running in LLM mode');
});
after(() => fake.close());
beforeEach(() => { requests.length = 0; replies = []; });

function fundamentalsState(followups = 0) {
  const st = interviewer.initialState();
  const q = bank[0];
  st.phaseIdx = 1; st.asked.push(q.id);
  st.q = { id: q.id, text: q.text, topic: q.topic, kind: q.kind, expected: q.expected, followups };
  return st;
}
async function turn(state, answer) {
  return interviewer.nextTurn({ viva: viva(), session: { state }, bank, history: [], answer, elapsed: 100 });
}
let vivaObj;
const viva = () => vivaObj ||= (() => { const v = sim.createViva('LLM-TEST'); bank = db.getQuestions(v.id); return v; })();

test('interviewer turn: request shape and a deeper follow-up', async () => {
  viva();
  replies.push(message({ assessment: 'strong', action: 'deeper', say: 'Why would you stop at third normal form rather than BCNF?' }));
  const r = await turn(fundamentalsState(), 'Normalization removes redundancy using functional dependencies, up to third normal form.');
  assert.equal(r.mode, 'llm');
  assert.equal(r.action, 'deeper');
  assert.equal(r.say, 'Why would you stop at third normal form rather than BCNF?');
  assert.equal(r.questionId, bank[0].id, 'follow-up stays on the same bank question');

  const { url, headers, body } = requests[0];
  assert.equal(url.split('?')[0], '/v1/messages');
  assert.equal(headers['x-api-key'], 'test-key');
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.output_config.effort, 'low');
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal('temperature' in body, false);
  const user = body.messages[0].content;
  assert.match(user, /<student_answer>\nNormalization removes redundancy/);
  assert.match(user, /allowed_actions: next, deeper, hint, redirect/);
  assert.match(user, /Examiner-only reference points \(never reveal\)/);
  assert.match(body.system, /Never reveal, confirm, or teach the correct answer/);
});

test('interviewer: an action outside the follow-up budget is overridden to move on', async () => {
  replies.push(message({ assessment: 'strong', action: 'deeper', say: 'Tell me more about that.' }));
  const r = await turn(fundamentalsState(1), 'Normalization splits tables to avoid update anomalies and redundancy.');
  assert.match(requests[0].body.messages[0].content, /allowed_actions: next\n/);
  assert.equal(r.action, 'next');
  assert.notEqual(r.questionId, bank[0].id);
  const next = bank.find(q => q.id === r.questionId);
  assert.ok(r.say.endsWith(next.text), 'next bank question is asked verbatim');
});

test('interviewer: rate limit is retried, then a server failure falls back to rules', async () => {
  const before = { ...llm.stats };
  replies.push({ status: 429, headers: { 'retry-after': '0' }, body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } } });
  replies.push(message({ assessment: 'partial', action: 'hint', say: 'Think about what happens when the same fact is stored twice.' }));
  let r = await turn(fundamentalsState(), 'It makes tables smaller, normalization.');
  assert.equal(r.mode, 'llm');
  assert.equal(r.action, 'hint');
  assert.equal(llm.stats.rateLimited, before.rateLimited + 1);
  assert.equal(llm.stats.retries, before.retries + 1);

  replies.push({ status: 500, body: { type: 'error', error: { type: 'api_error', message: 'boom' } } });
  replies.push({ status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'busy' } } });
  r = await turn(fundamentalsState(), 'Normalization reduces redundancy in tables.');
  assert.equal(r.mode, 'fallback', 'viva keeps going without the LLM');
  assert.ok(r.say.length > 0);
  assert.equal(requests.length, 4);
});

test('callJSON: refusals throw; temperature 0 only for models that accept it', async () => {
  replies.push(message({}, { stop_reason: 'refusal' }));
  await assert.rejects(llm.callJSON({ model: 'claude-haiku-5-5', system: 's', user: 'u', schema: { type: 'object' }, attempts: 1 }), /model_refusal/);

  replies.push(message({ ok: true }), message({ ok: true }));
  await llm.callJSON({ model: 'claude-sonnet-4-6', system: 's', user: 'u', schema: { type: 'object' }, temperature0: true });
  await llm.callJSON({ model: 'claude-opus-5-5', system: 's', user: 'u', schema: { type: 'object' }, temperature0: true });
  assert.equal(requests[1].body.temperature, 0);
  assert.equal('fallbacks' in requests[1].body, false);
  assert.equal('temperature' in requests[2].body, false, 'Opus 5.5 rejects sampling params');
});

test('scorer: request shape, weighted total, and evidence validation', async () => {
  const v = viva();
  const sid = db.uid('s_');
  db.db.prepare(`INSERT INTO sessions (id, viva_id, student_id, student_name, started_at, status, state, score_status)
    VALUES (?,?,?,?,?,'ended','{}','queued')`).run(sid, v.id, 'S-LLM', 'Asha', Date.now());
  const lines = [['ai', 'Tell me about a project you built.'], ['student', 'I built a library system on PostgreSQL with indexes on member ID and transactions for issuing books.'],
    ['ai', bank[0].text], ['student', 'Normalization removes redundancy using functional dependencies.']];
  lines.forEach(([role, text], i) => db.addTurn({ session_id: sid, role, text, t_start: i * 20, phase: i < 2 ? 'warmup' : 'fundamentals' }));
  replies.push(message({
    dimensions: [
      { key: 'conceptual', score: 4, reason: 'Correct definition of normalization.', evidence: ['L4'] },
      { key: 'depth', score: 3, reason: 'Limited follow-up evidence.', evidence: ['L4', 'L999'] },
      { key: 'problem_solving', score: 3, reason: 'Some reasoning shown.', evidence: [] },
      { key: 'practical', score: 4, reason: 'Concrete project details.', evidence: ['L2'] },
      { key: 'communication', score: 5, reason: 'Clear and concise.', evidence: ['L2', 'L4'] },
    ],
    feedback: [{ text: 'Good concrete project description.', evidence: ['L2'] }, { text: 'Explain trade-offs, not just definitions.', evidence: ['L4'] },
      { text: 'Practise reasoning aloud on scenarios.', evidence: [] }],
    confidence: 'high', manipulation_attempt: false, flags: [],
  }, { model: 'claude-opus-5-5' }));
  const { result, reasons } = await scorer.scoreSession(db.getSession(sid), v);

  const { url, headers, body } = requests[0];
  assert.equal(body.model, 'claude-opus-5-5');
  assert.match(url, /beta=true/);
  assert.match(headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.output_config.effort, 'high');
  assert.equal('temperature' in body, false);
  assert.match(body.system, /conceptual \(Conceptual understanding, weight 30%\)/);
  assert.match(body.messages[0].content, /L4 \[01:00\] STUDENT: Normalization removes redundancy/);

  assert.equal(result.mode, 'llm');
  assert.equal(result.total, 73);   // 4/5*30 + 3/5*25 + 3/5*20 + 4/5*15 + 5/5*10
  assert.deepEqual(result.dimensions.find(d => d.key === 'depth').evidence.map(e => e.line), ['L4'], 'made-up line removed');
  assert.ok(result.flags.includes('invalid_evidence_depth'));
  assert.ok(reasons.includes('Scorer cited non-existent transcript lines'));
  assert.ok(reasons.some(r => /Very short answers/.test(r)), 'short transcript still forces review');
  assert.equal(result.prompt_version, scorer.SCORER_PROMPT_VERSION);
});

test('uploads: Claude reads PDFs as document blocks and images as image blocks', async () => {
  const qb = await import('../src/questionbank.js');
  const { makePdf } = await import('../scripts/make-sample-pdf.js');
  const v = viva();
  const extracted = { document_type: 'question_paper', questions: [
    { text: 'What is a B+ tree?', topic: 'indexing', kind: 'concept', difficulty: 'medium', expected: 'Balanced tree; leaves linked; range scans.' }] };
  replies.push(message(extracted), message(extracted));
  const pdf = await qb.importDocument({ buf: makePdf(['1. What is a B+ tree?']), viva: v });
  const png = await qb.importDocument({ buf: fs.readFileSync(new URL('../data/samples/dbms-question-paper.png', import.meta.url)), viva: v });
  assert.equal(pdf.method, 'claude-question_paper');
  assert.equal(pdf.questions[0].text, 'What is a B+ tree?');
  const [doc, img] = requests.map(r => r.body.messages[0].content);
  assert.equal(doc[0].type, 'document');
  assert.equal(doc[0].source.media_type, 'application/pdf');
  assert.equal(Buffer.from(doc[0].source.data, 'base64').subarray(0, 4).toString(), '%PDF');
  assert.equal(img[0].type, 'image');
  assert.equal(img[0].source.media_type, 'image/png');
  assert.equal(doc[1].type, 'text', 'instructions follow the file');
  assert.equal(requests[0].body.model, 'claude-opus-5-5');
});

test('uploads: if Claude fails, the PDF is read locally instead', async () => {
  const qb = await import('../src/questionbank.js');
  const { makePdf } = await import('../scripts/make-sample-pdf.js');
  for (let i = 0; i < 3; i++) replies.push({ status: 500, body: { type: 'error', error: { type: 'api_error', message: 'down' } } });
  const r = await qb.importDocument({ buf: makePdf(['1. What is normalization?', '2. Why do we use indexes?']), viva: viva() });
  assert.equal(r.method, 'pdf-text');
  assert.equal(r.questions.length, 2);
});
