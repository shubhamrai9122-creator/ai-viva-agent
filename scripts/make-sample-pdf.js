// Builds a minimal text PDF (no dependencies). Used for the sample question paper and in tests.
// Usage: node scripts/make-sample-pdf.js  -> data/samples/ds-question-paper.pdf
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function makePdf(lines) {
  const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = 'BT /F1 12 Tf 15 TL 60 760 Td ' + lines.map(l => `(${esc(l)}) Tj T*`).join(' ') + ' ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export const SAMPLE_PAPER = [
  'MSOT - Data Structures - Viva Question Paper',
  'Time: 5 minutes        Max marks: 100',
  'Answer all questions orally.',
  '1. What is the difference between an array and a linked list? (5 marks)',
  '2. Explain how a hash table handles collisions using chaining',
  '   or open addressing.',
  '3. Why is a heap better than a sorted array for a priority queue?',
  '4. Compare quicksort and merge sort. When would you use each?',
  '5. Suppose you must find the shortest route between two stations in a metro map.',
  '   Which data structure and algorithm would you use?',
  '6. Define a binary search tree and the property it maintains.',
]

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  fs.writeFileSync(new URL('../data/samples/ds-question-paper.pdf', import.meta.url), makePdf(SAMPLE_PAPER));
  console.log('wrote data/samples/ds-question-paper.pdf');
}
