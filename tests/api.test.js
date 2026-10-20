// End-to-end API flow in mock mode: setup -> email sign-in -> consent -> interview -> end ->
// scoring -> review -> override -> export, plus PDF / image import.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'viva-api-'));
process.env.LLM_MODE = 'mock';
process.env.FACULTY_PASSCODE = 'test-key';
delete process.env.SMTP_HOST;
const { default: app } = await import('../server.js');
const { outbox } = await import('../src/mailer.js');
const { makePdf, SAMPLE_PAPER } = await import('../scripts/make-sample-pdf.js');
let server, base;
before(() => new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(() => server.close());
const F = { 'x-faculty-key': 'test-key' };
const call = async (p, body, headers = {}, method = body ? 'POST' : 'GET') => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() };
};
// Sign in the way a student does: request a code, read it from the (console-mode) outbox, verify.
async function signIn(email) {
  const r = await call('/api/auth/request-code', { email });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const code = outbox.filter(m => m.to === email.toLowerCase()).at(-1).code;
  const v = await call('/api/auth/verify', { email, code });
  assert.equal(v.status, 200);
  return { 'x-student-token': v.body.token };
}

test('email sign-in', async () => {
  assert.equal((await call('/api/auth/request-code', { email: 'not-an-email' })).status, 400);
  assert.equal((await call('/api/auth/request-code', { email: 'Riya@Example.com' })).status, 200);
  assert.equal((await call('/api/auth/request-code', { email: 'riya@example.com' })).status, 429, 'resend cooldown');
  const code = outbox.at(-1).code;
  assert.match(code, /^\d{6}$/);
  const wrong = code === '000000' ? '111111' : '000000';
  assert.equal((await call('/api/auth/verify', { email: 'riya@example.com', code: wrong })).status, 400);
  const ok = await call('/api/auth/verify', { email: 'RIYA@example.com', code });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.email, 'riya@example.com');
  assert.equal((await call('/api/auth/verify', { email: 'riya@example.com', code })).status, 400, 'code is single-use');
  assert.equal((await call('/api/auth/me', null, { 'x-student-token': ok.body.token })).body.email, 'riya@example.com');
  assert.equal((await call('/api/auth/me', null, { 'x-student-token': ok.body.token + 'x' })).status, 401, 'tampered token rejected');

  // Brute force: 5 wrong attempts lock the code.
  await call('/api/auth/request-code', { email: 'guess@example.com' });
  const real = outbox.at(-1).code;
  for (let i = 0; i < 5; i++) await call('/api/auth/verify', { email: 'guess@example.com', code: String((Number(real) + 1 + i) % 1e6).padStart(6, '0') });
  assert.equal((await call('/api/auth/verify', { email: 'guess@example.com', code: real })).status, 429, 'locked after 5 wrong attempts');
});

test('full viva lifecycle', async () => {
  assert.equal((await call('/api/faculty/vivas')).status, 401);
  const csv = fs.readFileSync(new URL('../data/samples/ds-question-bank.csv', import.meta.url), 'utf8');
  const v = await call('/api/faculty/vivas', { subject: 'Data Structures', code: 'TEST-1', format: 'phased', topics: ['hashing'], bankText: csv, bankFormat: 'csv' }, F);
  assert.equal(v.status, 200); assert.equal(v.body.added, 16);

  const gen = await call(`/api/faculty/vivas/${v.body.id}/generate`, { syllabus: 'hashing' }, F);
  assert.ok(gen.body.added > 0);
  const qs = (await call(`/api/faculty/vivas/${v.body.id}/questions`, null, F)).body;
  assert.ok(qs.some(q => q.approved === 0 && q.source === 'ai-generated'), 'generated questions start unapproved');

  assert.equal((await call('/api/student/vivas/NOPE-0')).status, 404, 'unknown code rejected up front');
  const pub = (await call('/api/student/vivas/test-1')).body;
  assert.equal(pub.subject, 'Data Structures'); assert.equal(pub.format, 'phased'); assert.equal(pub.slotSeconds, 900); assert.equal(pub.interviewSeconds, 870);
  assert.equal((await call('/api/faculty/vivas', { subject: 'Dup', code: 'test-1' }, F)).status, 409, 'duplicate code rejected');
  assert.equal((await call('/api/faculty/vivas', { subject: 'Long', format: 'phased', phases: [{ seconds: 900 }] }, F)).status, 400, 'phases over 14:30 rejected');
  assert.equal((await call('/api/faculty/vivas', { subject: 'Long', questionCount: 20, secondsPerQuestion: 60 }, F)).status, 400, 'quick viva over 14:30 rejected');

  assert.equal((await call('/api/student/join', { code: 'TEST-1', studentId: 'S1', consent: true })).status, 401, 'sign-in required');
  const S = await signIn('asha@example.com');
  assert.equal((await call('/api/student/join', { code: 'TEST-1', studentId: 'S1' }, S)).status, 400, 'consent required');
  const j = await call('/api/student/join', { code: 'TEST-1', studentId: 'S1', name: 'Asha', consent: true }, S);
  assert.equal(j.status, 200);
  const sid = j.body.sessionId;
  const st = await call(`/api/student/sessions/${sid}/start`, {}, S);
  assert.match(st.body.say, /project you built/);

  const other = await signIn('intruder@example.com');
  assert.equal((await call(`/api/student/sessions/${sid}/turn`, { text: 'hi' }, other)).status, 403, "can't answer someone else's viva");
  assert.equal((await call('/api/student/join', { code: 'TEST-1', studentId: 'S1', consent: true }, other)).status, 409, "can't reuse someone else's student ID");

  const t1 = await call(`/api/student/sessions/${sid}/turn`, { text: 'I built a library system with Postgres and Node', turnKey: 'k1', spokenMs: 4000 }, S);
  const again = await call(`/api/student/sessions/${sid}/turn`, { text: 'I built a library system with Postgres and Node', turnKey: 'k1', spokenMs: 4000 }, S);
  assert.deepEqual(again.body, t1.body, 'retried turn is idempotent');
  for (let i = 2; i < 8; i++) await call(`/api/student/sessions/${sid}/turn`, { text: i % 2 ? "I don't know" : 'word '.repeat(40), turnKey: 'k' + i }, S);
  await call(`/api/student/sessions/${sid}/event`, { type: 'tab_hidden' }, S);
  const audio = await fetch(`${base}/api/student/sessions/${sid}/audio?seg=1&t=0`, { method: 'POST', headers: S, body: Buffer.from('fake-webm') });
  assert.equal(audio.status, 200);

  const rejoin = await call('/api/student/join', { code: 'TEST-1', studentId: 'S1', consent: true }, S);
  assert.equal(rejoin.body.sessionId, sid); assert.equal(rejoin.body.resumed, true);

  await call(`/api/student/sessions/${sid}/end`, {}, S);

  // A student who skips everything on a small bank, answering instantly: the bank runs out at
  // 0 s elapsed, which must still be flagged (0 is a valid time).
  await call('/api/faculty/vivas', { subject: 'Tiny', code: 'TINY-1', format: 'phased', topics: ['stacks'],
    questions: [{ text: 'What is a stack?', topic: 'stacks', kind: 'concept' }] }, F);
  const S2 = await signIn('ravi@example.com');
  const j2 = (await call('/api/student/join', { code: 'TINY-1', studentId: 'S2', consent: true }, S2)).body;
  await call(`/api/student/sessions/${j2.sessionId}/start`, {}, S2);
  for (let i = 0, done = false; i < 40 && !done; i++) done = (await call(`/api/student/sessions/${j2.sessionId}/turn`, { text: "I don't know", turnKey: 't' + i }, S2)).body.done;
  await call(`/api/student/sessions/${j2.sessionId}/end`, {}, S2);
  let d2;
  for (let i = 0; i < 40; i++) { d2 = (await call(`/api/faculty/sessions/${j2.sessionId}`, null, F)).body; if (d2.session.score_status === 'done') break; await new Promise(r => setTimeout(r, 50)); }
  assert.ok(d2.events.some(e => e.type === 'bank_exhausted'), 'bank_exhausted event logged');
  assert.ok(d2.session.review_reasons.some(r => /Question bank ran out/.test(r)), 'forces review');
  assert.ok(d2.transcript.some(l => l.questionId?.startsWith('rev:') && l.variantOf), 'second chances are traceable');
  assert.ok(d2.transcript.some(l => l.questionId?.startsWith('var:') && l.variantOf), 'follow-ons are traceable');
  assert.equal((await call('/api/student/join', { code: 'TEST-1', studentId: 'S1', consent: true }, S)).status, 409, 'no retake');

  let detail;
  for (let i = 0; i < 40; i++) { detail = (await call(`/api/faculty/sessions/${sid}`, null, F)).body; if (detail.session.score_status === 'done') break; await new Promise(r => setTimeout(r, 50)); }
  assert.equal(detail.session.student_email, 'asha@example.com');
  const sc = detail.session.score;
  assert.equal(sc.dimensions.length, 5);
  assert.ok(sc.prompt_version && sc.prompt_hash);
  const lines = new Set(detail.transcript.map(l => l.line));
  for (const d of sc.dimensions) for (const e of d.evidence) assert.ok(lines.has(e.line), 'evidence cites real lines');
  assert.equal(detail.session.needs_review, 1, 'heuristic scores always need review');
  assert.equal(detail.audio.length, 1);

  assert.equal((await call(`/api/faculty/sessions/${sid}/override`, { total: 70 }, F)).status, 400, 'override needs name + reason');
  await call(`/api/faculty/sessions/${sid}/override`, { reviewer: 'Dr Rao', reason: 'Strong applied reasoning missed by STT', total: 72 }, F);
  detail = (await call(`/api/faculty/sessions/${sid}`, null, F)).body;
  assert.equal(detail.session.final_total, 72);
  assert.ok(detail.audit.some(a => a.action === 'override' && a.actor === 'faculty:Dr Rao'));

  const csvOut = await call('/api/faculty/export.csv?key=test-key');
  assert.match(csvOut.body, /"S1"/);
  assert.match(csvOut.body, /"asha@example.com"/);
  const cal = (await call('/api/faculty/calibration', null, F)).body;
  assert.equal(cal.n, 1);
});

test('PDF question paper and image uploads become draft questions', async () => {
  const v = (await call('/api/faculty/vivas', { subject: 'Data Structures', code: 'IMPORT-1', topics: ['arrays and linked lists', 'hashing', 'trees', 'heaps', 'sorting'] }, F)).body;
  const upload = (buf, type) => fetch(`${base}/api/faculty/vivas/${v.id}/import`, { method: 'POST', headers: { ...F, 'content-type': type }, body: buf })
    .then(async r => ({ status: r.status, body: await r.json() }));

  const pdf = await upload(makePdf(SAMPLE_PAPER), 'application/pdf');
  assert.equal(pdf.status, 200, JSON.stringify(pdf.body));
  assert.equal(pdf.body.added, 6);
  const qs = (await call(`/api/faculty/vivas/${v.id}/questions`, null, F)).body;
  assert.ok(qs.every(q => q.approved === 0 && q.source === 'pdf-import'), 'imported questions wait for approval');
  assert.ok(qs.some(q => /shortest route between two stations.*Which data structure/.test(q.text)), 'wrapped question kept whole');
  assert.equal(qs.find(q => /^What is the difference between an array/.test(q.text)).topic, 'arrays and linked lists');
  assert.equal(qs.find(q => /heap better/.test(q.text)).topic, 'heaps');

  const syllabus = await upload(makePdf(['Unit 1: Arrays, linked lists', 'Unit 2: Trees and graphs']), 'application/pdf');
  assert.ok(syllabus.body.added > 0 && syllabus.body.method === 'syllabus', 'a syllabus with no questions generates drafts');

  assert.equal((await upload(Buffer.from('just some text'), 'text/plain')).status, 400, 'unsupported type rejected');
  assert.equal((await upload(Buffer.from('%PDF-1.4 broken'), 'application/pdf')).status >= 400, true, 'corrupt PDF handled');
});

test('quick viva: 5 questions, 1 minute each, marked on 4 dimensions', async () => {
  const bank = fs.readFileSync(new URL('../data/samples/ds-question-bank.json', import.meta.url), 'utf8');
  const v = await call('/api/faculty/vivas', { subject: 'Data Structures', code: 'QUICK-1', topics: ['stacks', 'hashing', 'graphs'], bankText: bank, bankFormat: 'json' }, F);
  assert.equal(v.status, 200);
  const pub = (await call('/api/student/vivas/QUICK-1')).body;
  assert.equal(pub.format, 'timed'); assert.equal(pub.questionCount, 5); assert.equal(pub.secondsPerQuestion, 60);
  const S = await signIn('meera@example.com');
  const sid = (await call('/api/student/join', { code: 'QUICK-1', studentId: 'Q1', name: 'Meera', consent: true }, S)).body.sessionId;
  const st = (await call(`/api/student/sessions/${sid}/start`, {}, S)).body;
  assert.match(st.say, /There are 5 questions.*Question 1\./);
  assert.equal(st.questionNumber, 1); assert.equal(st.questionCount, 5);
  let r, n = 0;
  do { r = (await call(`/api/student/sessions/${sid}/turn`, { text: 'A stack is last in first out and a queue is first in first out, used for breadth first search and scheduling', turnKey: 'q' + n }, S)).body; n++; }
  while (!r.done && n < 10);
  assert.equal(n, 5, 'viva ends after the 5th answer');
  await call(`/api/student/sessions/${sid}/end`, {}, S);
  let d;
  for (let i = 0; i < 40; i++) { d = (await call(`/api/faculty/sessions/${sid}`, null, F)).body; if (d.session.score_status === 'done') break; await new Promise(res => setTimeout(res, 50)); }
  assert.deepEqual(d.session.score.dimensions.map(x => x.key), ['conceptual', 'depth', 'problem_solving', 'communication']);
  assert.equal(d.transcript.filter(l => l.role === 'STUDENT').length, 5);
});
