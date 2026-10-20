// Load test: N concurrent synthetic students drive the real HTTP API (join -> start -> turns
// with think time -> audio chunks every 5 s -> end), against a running server.
// Usage: node scripts/loadtest.js --users 50,100,150 --minutes 2 [--url http://localhost:3000]
import fs from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg('url', 'http://localhost:3000');
const LEVELS = arg('users', '50,100,150').split(',').map(Number);
const MINUTES = Number(arg('minutes', '2'));
const KEY = process.env.FACULTY_PASSCODE || 'faculty123';
const ANSWERS = [
  'An array stores elements in contiguous memory so indexing is constant time, while a linked list uses nodes with pointers, so inserting in the middle is cheap but access is linear.',
  'A hash table maps keys to buckets with a hash function; a collision is when two keys land in the same bucket, and we handle it with chaining or open addressing.',
  "I don't know.",
  'I think it is about using a stack, maybe.',
  'Breadth-first search uses a queue and visits nodes level by level, so it finds the shortest path in an unweighted graph; depth-first search uses a stack or recursion and goes deep first.',
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = async (p, body, headers = {}) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${p} ${r.status}`);
  return r.json();
};

async function student(code, i, deadline, m) {
  const audio = Buffer.alloc(40_000, i % 255);   // ~5 s of opus audio is ~30-40 KB
  try {
    // Bots skip the email step: faculty can mint student tokens for load tests.
    const studentId = `LT-${Date.now()}-${i}`;
    const { token } = await post('/api/faculty/student-token', { email: `${studentId.toLowerCase()}@loadtest.example` }, { 'x-faculty-key': KEY });
    const S = { 'x-student-token': token };
    const j = await post('/api/student/join', { code, studentId, name: `Bot ${i}`, consent: true }, S);
    const sid = j.sessionId;
    await post(`/api/student/sessions/${sid}/start`, {}, S);
    const seg = Date.now();
    const audioTimer = setInterval(() => {
      fetch(`${BASE}/api/student/sessions/${sid}/audio?seg=${seg}&t=0`, { method: 'POST', headers: S, body: audio })
        .then(r => { m.audioOk += r.ok; m.audioErr += !r.ok; }).catch(() => m.audioErr++);
    }, 5000);
    let done = false, n = 0;
    while (!done && Date.now() < deadline) {
      await sleep(2000 + Math.random() * 4000);   // compressed speak + think time
      const t0 = performance.now();
      try {
        const r = await post(`/api/student/sessions/${sid}/turn`, { text: ANSWERS[(i + n++) % ANSWERS.length], spokenMs: 8000, turnKey: `${sid}-${n}` }, S);
        m.lat.push(performance.now() - t0); m.turns++;
        done = r.done;
      } catch { m.turnErr++; }
    }
    clearInterval(audioTimer);
    await post(`/api/student/sessions/${sid}/end`, { reason: 'loadtest' }, S);
    m.completed++;
  } catch (e) { m.dropped++; m.errors.push(e.message); }
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
const results = [];
for (const users of LEVELS) {
  // Compressed viva so sessions cycle through every phase during the test window.
  const secs = MINUTES * 60;
  const phases = [['warmup', 0.07], ['fundamentals', 0.27], ['depth', 0.33], ['applied', 0.2], ['wrapup', 0.1]].map(([key, f]) => ({ key, seconds: Math.round(secs * f) }));
  const v = await post('/api/faculty/vivas', { subject: 'Load test', format: 'phased', topics: ['arrays and linked lists', 'stacks', 'hashing', 'graphs'], phases,
    bankText: fs.readFileSync(new URL('../data/samples/ds-question-bank.json', import.meta.url), 'utf8'), bankFormat: 'json' }, { 'x-faculty-key': KEY });
  const m = { lat: [], turns: 0, turnErr: 0, completed: 0, dropped: 0, audioOk: 0, audioErr: 0, errors: [] };
  const deadline = Date.now() + secs * 1000 + 15000;
  const healthSamples = [];
  const hTimer = setInterval(async () => { try { healthSamples.push(await (await fetch(BASE + '/api/health')).json()); } catch {} }, 3000);
  const t0 = Date.now();
  // Ramp up over 10 s like students joining a slot.
  await Promise.all(Array.from({ length: users }, (_, i) => sleep((i / users) * 10000).then(() => student(v.code, i, deadline, m))));
  clearInterval(hTimer);
  const row = { users, wallSec: Math.round((Date.now() - t0) / 1000), turns: m.turns, p50ms: Math.round(pct(m.lat, 0.5)), p95ms: Math.round(pct(m.lat, 0.95)),
    maxMs: Math.round(Math.max(0, ...m.lat)), turnErrors: m.turnErr, audioChunks: m.audioOk, audioErrors: m.audioErr, completed: m.completed, dropped: m.dropped,
    peakRssMB: Math.max(0, ...healthSamples.map(h => h.memoryMB)), mode: healthSamples[0]?.mode };
  console.log(row);
  results.push(row);
}
console.table(results);
fs.mkdirSync('test-results', { recursive: true });
fs.writeFileSync('test-results/loadtest.json', JSON.stringify(results, null, 2));
