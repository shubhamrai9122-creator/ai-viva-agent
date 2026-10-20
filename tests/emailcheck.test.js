// ValidateEasy email check, against a local fake of its API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const seen = [];
const fake = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  seen.push({ path: url.pathname, email: url.searchParams.get('email'), key: req.headers['x-api-key'] });
  const email = url.searchParams.get('email');
  const checks = { syntax: true, mx: true, disposable: false, role: false, free_provider: true, typo: false };
  if (email.endsWith('@mailinator.com')) checks.disposable = true;
  if (email.endsWith('@nomail.example')) checks.mx = false;
  if (email.endsWith('@gmial.com')) checks.typo = true;
  if (email.startsWith('down@')) { res.writeHead(503); return res.end('{}'); }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ email, status: checks.disposable || !checks.mx || checks.typo || !checks.syntax ? 'invalid' : 'valid', checks, reason: 'test' }));
});
let check;
before(async () => {
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  process.env.VALIDATEEASY_API_URL = `http://127.0.0.1:${fake.address().port}`;
  process.env.VALIDATEEASY_API_KEY = 'test-key';
  ({ checkEmailIsReal: check } = await import('../src/emailcheck.js'));
});
after(() => fake.close());

test('real addresses pass; disposable, dead-domain and mistyped ones are rejected', async () => {
  assert.equal((await check('asha@gmail.com')).ok, true);
  assert.match((await check('x@mailinator.com')).error, /disposable/);
  assert.match((await check('x@nomail.example')).error, /can't receive mail/);
  assert.match((await check('x@gmial.com')).error, /mistyped/);
  assert.equal(seen[0].path, '/validate');
  assert.equal(seen[0].email, 'asha@gmail.com');
  assert.equal(seen[0].key, 'test-key');
});

test('results are cached, and an outage never blocks sign-in', async () => {
  const before = seen.length;
  await check('asha@gmail.com');
  assert.equal(seen.length, before, 'second check served from cache');
  assert.deepEqual(await check('down@college.edu'), { ok: true, skipped: true });
});
