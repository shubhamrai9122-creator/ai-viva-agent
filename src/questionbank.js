// Question bank import (CSV/JSON) and AI generation from a syllabus (pending faculty approval).
import { env, MOCK } from './config.js';
import { callJSON } from './llm.js';

export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(x => x.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(x => x.trim())) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}

export function parseBank(text, format) {
  const f = format || (text.trim().startsWith('[') || text.trim().startsWith('{') ? 'json' : 'csv');
  if (f === 'json') {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : data.questions || [];
  }
  return parseCSV(text);
}

const SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' }, topic: { type: 'string' },
          kind: { type: 'string', enum: ['concept', 'depth', 'applied'] },
          difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
          expected: { type: 'string' },
        },
        required: ['text', 'topic', 'kind', 'difficulty', 'expected'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

export async function generateBank({ subject, topics, difficulty, syllabus, count = 12 }) {
  if (MOCK) {
    const out = [];
    for (const t of topics) {
      out.push({ text: `Explain ${t} in your own words. Why does it matter?`, topic: t, kind: 'concept', difficulty, expected: `Core definition and purpose of ${t}.` });
      out.push({ text: `What are the main trade-offs or failure modes of ${t}?`, topic: t, kind: 'depth', difficulty, expected: `Trade-offs, limits and edge cases of ${t}.` });
    }
    out.push({ text: `A production system using ${topics[0] || subject} suddenly becomes slow. How would you debug it step by step?`, topic: topics[0] || subject, kind: 'applied', difficulty, expected: 'Reproduce, measure, isolate, hypothesise, fix, verify.' });
    return out.slice(0, Math.max(count, topics.length * 2 + 1));
  }
  const { data } = await callJSON({
    model: env.scorerModel, maxTokens: 8000, effort: 'medium', timeoutMs: 120000, schema: SCHEMA,
    system: 'You write oral viva questions for university technical exams. Questions must be answerable aloud in under 90 seconds, with no code writing required. "expected" lists the key points a strong answer covers (examiner-only).',
    user: `Subject: ${subject}\nTopics: ${topics.join(', ')}\nDifficulty: ${difficulty}\nSyllabus:\n${syllabus || '(none provided)'}\n\nWrite ${count} questions: about 50% concept, 30% depth (why / trade-offs), 20% applied (short scenario or debugging problem). Spread them across the topics.`,
  });
  return data.questions;
}
