// Speech accuracy: word error rate over a CSV of (clip, accent, reference, hypothesis).
// Record >= 20 consented clips (Indian-accented English + Hinglish), put the human reference
// transcript and the STT output side by side, then: node scripts/wer.js data/samples/wer.csv
import fs from 'node:fs';
import { parseCSV } from '../src/questionbank.js';
const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);
export function wer(ref, hyp) {
  const r = norm(ref), h = norm(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return r.length ? d[r.length][h.length] / r.length : 0;
}
if (process.argv[2]) {
  const rows = parseCSV(fs.readFileSync(process.argv[2], 'utf8'));
  const out = rows.map(r => ({ clip: r.clip, accent: r.accent, wer: +wer(r.reference, r.hypothesis).toFixed(3) }));
  console.table(out);
  const groups = {};
  for (const o of out) (groups[o.accent] ||= []).push(o.wer);
  for (const [g, a] of Object.entries(groups)) console.log(`${g}: mean WER ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3)} over ${a.length} clips`);
}
