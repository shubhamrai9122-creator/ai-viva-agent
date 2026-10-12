// End-to-end API flow in mock mode: setup -> consent -> interview -> end -> scoring -> review -> override -> export.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'viva-api-'));
process.env.LLM_MODE = 'mock';
process.env.FACULTY_PASSCODE = 'test-key';
const { default: app } = await import('../server.js');
let server, base;
before(() => new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(() => server.close());
const F = { 'x-faculty-key': 'test-key' };
const call = async (p, body, headers = {}, method = body ? 'POST' : 'GET') => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() };
};

test('full viva lifecycle', async () => {
  assert.equal((await call('/api/faculty/vivas')).status, 401);
  const csv = fs.readFileSync(new URL('../data/samples/dbms-question-bank.csv', import.meta.url), 'utf8');
  const v = await call('/api/faculty/vivas', { subject: 'DBMS', code: 'TEST-1', topics: ['indexing'], bankText: csv, bankFormat: 'csv' }, F);
  assert.equal(v.status, 200); assert.equal(v.body.added, 11);

  const gen = await call(`/api/faculty/vivas/${v.body.id}/generate`, { syllabus: 'indexing' }, F);
  assert.ok(gen.body.added > 0);
  const qs = (await call(`/api/faculty/vivas/${v.body.id}/questions`, null, F)).body;
  assert.ok(qs.some(q => q.approved === 0 && q.source === 'ai-generated'), 'generated questions start unapproved');

  assert.equal((await call('/api/student/join', { code: 'TEST-1', studentId: 'S1' })).status, 400, 'consent required');
  const j = await call('/api/student/join', { code: 'TEST-1', studentId: 'S1', name: 'Asha', consent: true });
  assert.equal(j.status, 200);
  const sid = j.body.sessionId;
  const st = await call(`/api/student/sessions/${sid}/start`, {});
  assert.match(st.body.say, /project you built/);

  const t1 = await call(`/api/student/sessions/${sid}/turn`, { text: 'I built a library system with Postgres and Node', turnKey: 'k1', spokenMs: 4000 });
  const again = await call(`/api/student/sessions/${sid}/turn`, { text: 'I built a library system with Postgres and Node', turnKey: 'k1', spokenMs: 4000 });
  assert.deepEqual(again.body, t1.body, 'retried turn is idempotent');
  for (let i = 2; i < 8; i++) await call(`/api/student/sessions/${sid}/turn`, { text: i % 2 ? "I don't know" : 'word '.repeat(40), turnKey: 'k' + i });
  await call(`/api/student/sessions/${sid}/event`, { type: 'tab_hidden' });
  const audio = await fetch(`${base}/api/student/sessions/${sid}/audio?seg=1&t=0`, { method: 'POST', body: Buffer.from('fake-webm') });
  assert.equal(audio.status, 200);

  const rejoin = await call('/api/student/join', { code: 'TEST-1', studentId: 'S1', consent: true });
  assert.equal(rejoin.body.sessionId, sid); assert.equal(rejoin.body.resumed, true);

  await call(`/api/student/sessions/${sid}/end`, {});
  assert.equal((await call('/api/student/join', { code: 'TEST-1', studentId: 'S1', consent: true })).status, 409, 'no retake');

  let detail;
  for (let i = 0; i < 40; i++) { detail = (await call(`/api/faculty/sessions/${sid}`, null, F)).body; if (detail.session.score_status === 'done') break; await new Promise(r => setTimeout(r, 50)); }
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
  const cal = (await call('/api/faculty/calibration', null, F)).body;
  assert.equal(cal.n, 1);
});
