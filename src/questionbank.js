// Question bank import (CSV/JSON/PDF/image) and AI generation from a syllabus (pending faculty approval).
import fs from 'node:fs';
import path from 'node:path';
import { env, MOCK } from './config.js';
import { callJSON } from './llm.js';
import { DATA_DIR } from './db.js';

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

// ---------- Import from a PDF or an image (question paper or syllabus) ----------
// With an API key, Claude reads the file directly (PDF document block / image block).
// Without one, or if the call fails, text is extracted locally (pdf.js for PDFs, Tesseract
// OCR for images) and question-like lines are picked out. Imported questions always start
// unapproved so faculty can check them.

export function sniffType(buf) {
  if (buf.length > 4 && buf.subarray(0, 4).toString('latin1') === '%PDF') return { kind: 'pdf', mediaType: 'application/pdf' };
  if (buf.length > 8 && buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return { kind: 'image', mediaType: 'image/png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'image', mediaType: 'image/jpeg' };
  return null;
}

export async function pdfText(buf) {
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const { items } = await (await pdf.getPage(i)).getTextContent();
    // Rebuild lines from text items, so numbered questions stay on their own lines.
    let line = '', lastY = null;
    const lines = [];
    for (const it of items) {
      const y = it.transform?.[5];
      if (lastY != null && y != null && Math.abs(y - lastY) > 2 && line.trim()) { lines.push(line); line = ''; }
      line += it.str;
      if (it.hasEOL) { lines.push(line); line = ''; }
      lastY = y ?? lastY;
    }
    if (line.trim()) lines.push(line);
    pages.push(lines.join('\n'));
  }
  return pages.join('\n');
}

export async function ocrText(buf) {
  const { createWorker } = await import('tesseract.js');
  const cachePath = path.join(DATA_DIR, 'ocr-cache');
  fs.mkdirSync(cachePath, { recursive: true });
  const worker = await createWorker('eng', 1, { cachePath });
  try { return (await worker.recognize(buf)).data.text || ''; }
  finally { await worker.terminate(); }
}

const VERB = /^(explain|describe|define|compare|discuss|differentiate|distinguish|what|why|how|when|which|where|list|state|give|outline|justify|design|suppose|consider|imagine|write|illustrate|analy[sz]e|evaluate|derive|mention|name|identify|can you|is it|are there|do you|does)\b/i;
const NUM = /^(?:q(?:uestion)?\s*\.?\s*)?\(?(?:\d{1,3}|[a-h]|[ivx]{1,4})[).:]\s+|^[•▪●\-*]\s+/i;
const MARKS = /\s*[([]?\s*\d{1,2}\s*(?:marks?|m)\s*[)\]]?\s*$|\s*[([]\s*\d{1,2}\s*[)\]]\s*$/i;

// The viva topic a question mentions first ("heap" -> heaps, "hash table" -> hashing).
export function topicFor(text, topics) {
  const words = String(text).toLowerCase().match(/[a-z]+/g) || [];
  let best = null;
  for (const t of topics) {
    const stems = (t.toLowerCase().match(/[a-z]+/g) || []).filter(w => w.length >= 4).map(w => w.slice(0, 4));
    let hits = 0, first = Infinity;
    words.forEach((w, i) => { if (stems.some(st => w.startsWith(st))) { hits++; first = Math.min(first, i); } });
    if (hits && (!best || first < best.first || (first === best.first && hits > best.hits))) best = { t, hits, first };
  }
  return best ? best.t : 'general';
}

/** Pick question-like lines out of extracted text. */
export function questionsFromText(text, topics = [], difficulty = 'medium') {
  const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const numbered = lines.some(l => NUM.test(l));
  const blocks = [];
  let inQuestion = false;
  for (const line of lines) {
    const prev = blocks.at(-1);
    if (NUM.test(line)) { blocks.push(line); inQuestion = true; continue; }
    // Numbered papers: unnumbered lines continue the current question (wrapped or multi-part).
    // Unnumbered text: a line continues the previous one only if that looks unfinished.
    const continues = numbered ? inQuestion : (prev && !/[?.:)\]]$/.test(prev) && !VERB.test(line));
    if (continues && prev) blocks[blocks.length - 1] = `${prev} ${line}`;
    else blocks.push(line);
  }
  const seen = new Set();
  const out = [];
  for (let b of blocks) {
    b = b.replace(NUM, '').replace(MARKS, '').trim();
    const words = b.split(/\s+/).length;
    if (words < 3 || b.length < 12 || b.length > 400) continue;
    if (!(/\?$/.test(b) || VERB.test(b))) continue;
    if (/^(answer|attempt|time|max(imum)? marks|instructions?|note)\b/i.test(b)) continue;
    const key = b.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = /\b(scenario|suppose|imagine|design|debug\w*|troubleshoot\w*|case study|given (?:a|the)|consider a|how would you)\b/i.test(b) ? 'applied'
      : /^(what is|what are|define|explain|describe|state|list|name|mention)\b/i.test(b) ? 'concept'
      : /\b(why|trade-?offs?|compar\w*|differen\w*|advantages?|disadvantages?|justify|evaluate|when would)\b/i.test(b) ? 'depth' : 'concept';
    const topic = topicFor(b, topics);
    out.push({ text: /[?.]$/.test(b) ? b : `${b}.`, topic, kind, difficulty, expected: '' });
  }
  return out;
}

// "Unit 2: Indexing, B+ trees" -> ["Indexing", "B+ trees"]
export function topicsFromSyllabus(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:unit|module|chapter|topic|week)\s*[\w.]*\s*[:.\-–]\s*(.+)$/i);
    if (m) out.push(...m[1].split(/[,;]| and /).map(s => s.replace(/\(.*?\)/g, '').trim()).filter(s => s && s.length < 40));
  }
  return [...new Set(out)].slice(0, 8);
}

const IMPORT_SCHEMA = {
  type: 'object',
  properties: {
    document_type: { type: 'string', enum: ['question_paper', 'syllabus', 'other'] },
    questions: SCHEMA.properties.questions,
  },
  required: ['document_type', 'questions'],
  additionalProperties: false,
};

async function claudeImport({ buf, type, viva, count }) {
  const data = buf.toString('base64');
  const file = type.kind === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: type.mediaType, data } };
  const { data: out } = await callJSON({
    model: env.scorerModel, maxTokens: 16000, effort: 'medium', timeoutMs: 180000, schema: IMPORT_SCHEMA,
    system: 'You prepare oral viva question banks for university technical exams. Questions must be answerable aloud in under 90 seconds, with no code writing required. "expected" lists the key points a strong answer covers (examiner-only).',
    user: [file, { type: 'text', text: `Subject: ${viva.subject}\nTopics: ${viva.topics.join(', ') || '(not set)'}\nDifficulty: ${viva.difficulty}\n\n` +
      'The attached file is either a question paper or a syllabus / notes.\n' +
      '- If it contains exam or viva questions, extract each one faithfully (fix only obvious scanning or line-break errors) and classify it.\n' +
      `- If it has no questions, write ${count} questions from its content: about 50% concept, 30% depth (why / trade-offs), 20% applied (short scenario or debugging problem).\n` +
      'Use the given topics where they fit; otherwise name the topic from the file.' }],
  });
  return { questions: out.questions, method: `claude-${out.document_type}` };
}

/** Returns { questions, method }. Throws with .status 400 for unsupported files. */
export async function importDocument({ buf, viva, count = 12 }) {
  const type = sniffType(buf);
  if (!type) throw Object.assign(new Error('Unsupported file. Upload a PDF, PNG or JPG.'), { status: 400 });
  if (!MOCK) {
    try { return await claudeImport({ buf, type, viva, count }); }
    catch (err) { console.warn('[import] Claude failed, extracting locally:', err?.status || err?.message); }
  }
  let text;
  try { text = type.kind === 'pdf' ? await pdfText(buf) : await ocrText(buf); }
  catch (err) {
    console.warn('[import] could not read file:', err?.message);
    throw Object.assign(new Error(`Could not read this ${type.kind === 'pdf' ? 'PDF' : 'image'}. It may be damaged or password-protected.`), { status: 422 });
  }
  if (!text.trim()) throw Object.assign(new Error(type.kind === 'pdf'
    ? 'No text found in this PDF. If it is a scanned document, upload the pages as PNG or JPG images instead.'
    : 'No text could be read from this image. Try a clearer, straight-on photo.'), { status: 422 });
  const questions = questionsFromText(text, viva.topics, viva.difficulty);
  if (questions.length) return { questions, method: type.kind === 'pdf' ? 'pdf-text' : 'ocr' };
  // No questions in the file: treat it as a syllabus.
  const topics = viva.topics.length ? viva.topics : topicsFromSyllabus(text);
  return { questions: await generateBank({ subject: viva.subject, topics, difficulty: viva.difficulty, syllabus: text, count }), method: 'syllabus' };
}
