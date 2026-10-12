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
  'Normalization reduces redundancy by splitting tables based on functional dependencies so that updates do not cause anomalies, and we go up to third normal form usually.',
  'A clustered index stores the rows in the order of the key so there is only one, while a non clustered index is a separate B plus tree that points to the rows.',
  "I don't know.",
  'I think it is about locking, maybe.',
  'Atomicity means all or nothing, consistency keeps constraints valid, isolation means concurrent transactions do not see each other partially, and durability uses the write ahead log so committed data survives a crash.',
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
    const j = await post('/api/student/join', { code, studentId: `LT-${Date.now()}-${i}`, name: `Bot ${i}`, consent: true });
    const sid = j.sessionId;
    await post(`/api/student/sessions/${sid}/start`, {});
    const seg = Date.now();
    const audioTimer = setInterval(() => {
      fetch(`${BASE}/api/student/sessions/${sid}/audio?seg=${seg}&t=0`, { method: 'POST', body: audio })
        .then(r => { m.audioOk += r.ok; m.audioErr += !r.ok; }).catch(() => m.audioErr++);
    }, 5000);
    let done = false, n = 0;
    while (!done && Date.now() < deadline) {
      await sleep(2000 + Math.random() * 4000);   // compressed speak + think time
      const t0 = performance.now();
      try {
        const r = await post(`/api/student/sessions/${sid}/turn`, { text: ANSWERS[(i + n++) % ANSWERS.length], spokenMs: 8000, turnKey: `${sid}-${n}` });
        m.lat.push(performance.now() - t0); m.turns++;
        done = r.done;
      } catch { m.turnErr++; }
    }
    clearInterval(audioTimer);
    await post(`/api/student/sessions/${sid}/end`, { reason: 'loadtest' });
    m.completed++;
  } catch (e) { m.dropped++; m.errors.push(e.message); }
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
const results = [];
for (const users of LEVELS) {
  // Compressed viva so sessions cycle through every phase during the test window.
  const secs = MINUTES * 60;
  const phases = [['warmup', 0.07], ['fundamentals', 0.27], ['depth', 0.33], ['applied', 0.2], ['wrapup', 0.1]].map(([key, f]) => ({ key, seconds: Math.round(secs * f) }));
  const v = await post('/api/faculty/vivas', { subject: 'Load test', topics: ['normalization', 'indexing', 'transactions'], phases,
    bankText: fs.readFileSync(new URL('../data/samples/dbms-question-bank.json', import.meta.url), 'utf8'), bankFormat: 'json' }, { 'x-faculty-key': KEY });
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
