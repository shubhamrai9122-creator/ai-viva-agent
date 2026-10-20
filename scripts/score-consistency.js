// Scoring consistency: score each persona transcript N times; report per-dimension and total variance.
// Run `npm run personas` first. Usage: npm run consistency -- 5
import fs from 'node:fs';
import path from 'node:path';
process.env.DATA_DIR ||= path.resolve('test-results/db');
const { scoreSession } = await import('../src/scorer.js');
const { getSession, getViva } = await import('../src/db.js');
const runs = Number(process.argv[2] || 5);
const dir = path.resolve('test-results/personas');
const out = [];
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.session'))) {
  const sid = fs.readFileSync(path.join(dir, f), 'utf8').trim();
  const s = await getSession(sid); const v = await getViva(s.viva_id);
  const totals = [], dims = {};
  for (let i = 0; i < runs; i++) {
    const { result } = await scoreSession(s, v);
    totals.push(result.total);
    for (const d of result.dimensions) (dims[d.key] ||= []).push(d.score);
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const sd = a => Math.sqrt(mean(a.map(x => (x - mean(a)) ** 2)));
  out.push({ transcript: f.replace('.session', ''), runs, totals: totals.join(' / '), mean: +mean(totals).toFixed(1), stdev: +sd(totals).toFixed(2),
    range: +(Math.max(...totals) - Math.min(...totals)).toFixed(1), maxDimStdev: +Math.max(...Object.values(dims).map(sd)).toFixed(2) });
}
console.table(out);
fs.writeFileSync('test-results/consistency.json', JSON.stringify(out, null, 2));
