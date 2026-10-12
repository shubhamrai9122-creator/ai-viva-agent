// SQLite persistence (node:sqlite, no native deps). Every viva's state lives here,
// so any server process can handle any turn (stateless workers).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const AUDIO_DIR = path.join(DATA_DIR, 'audio');
fs.mkdirSync(AUDIO_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH || path.join(DATA_DIR, 'viva.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS vivas (
  id TEXT PRIMARY KEY, code TEXT UNIQUE, subject TEXT, topics TEXT, difficulty TEXT,
  phases TEXT, rubric TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY, viva_id TEXT, text TEXT, topic TEXT, kind TEXT, difficulty TEXT,
  expected TEXT, source TEXT, approved INTEGER DEFAULT 1, created_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, viva_id TEXT, student_id TEXT, student_name TEXT, language TEXT,
  consent_at TEXT, started_at INTEGER, ended_at INTEGER, status TEXT, state TEXT,
  score_status TEXT, score TEXT, ai_total REAL, needs_review INTEGER DEFAULT 0,
  review_reasons TEXT, override TEXT, final_total REAL,
  UNIQUE (viva_id, student_id)
);
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, text TEXT,
  t_start REAL, t_end REAL, phase TEXT, question_id TEXT, action TEXT, assessment TEXT,
  latency_ms INTEGER, meta TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, t REAL, type TEXT, detail TEXT
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, at TEXT, actor TEXT, action TEXT, detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_q_viva ON questions(viva_id);
`);

export const uid = (p = '') => p + crypto.randomBytes(8).toString('hex');
export const nowIso = () => new Date().toISOString();
const J = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };

export function getViva(id) {
  const v = db.prepare('SELECT * FROM vivas WHERE id = ? OR code = ?').get(id, id);
  if (!v) return null;
  return { ...v, topics: J(v.topics, []), phases: J(v.phases, []), rubric: J(v.rubric, []) };
}
export function listVivas() {
  return db.prepare(`SELECT v.*, (SELECT COUNT(*) FROM sessions s WHERE s.viva_id = v.id) AS sessions,
    (SELECT COUNT(*) FROM questions q WHERE q.viva_id = v.id AND q.approved = 1) AS approved_questions,
    (SELECT COUNT(*) FROM questions q WHERE q.viva_id = v.id AND q.approved = 0) AS pending_questions
    FROM vivas v ORDER BY created_at DESC`).all()
    .map(v => ({ ...v, topics: J(v.topics, []), phases: J(v.phases, []) }));
}
export function getQuestions(vivaId, onlyApproved = true) {
  return db.prepare(`SELECT * FROM questions WHERE viva_id = ? ${onlyApproved ? 'AND approved = 1' : ''} ORDER BY created_at, rowid`).all(vivaId);
}
export function insertQuestions(vivaId, qs, source, approved) {
  const stmt = db.prepare('INSERT INTO questions (id, viva_id, text, topic, kind, difficulty, expected, source, approved, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const out = [];
  for (const q of qs) {
    if (!q.text || !String(q.text).trim()) continue;
    const id = uid('q_');
    const kind = ['concept', 'depth', 'applied'].includes(q.kind) ? q.kind : 'concept';
    stmt.run(id, vivaId, String(q.text).trim(), q.topic || 'general', kind, q.difficulty || 'medium', q.expected || '', source, approved ? 1 : 0, nowIso());
    out.push(id);
  }
  return out;
}
export function getSession(id) {
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!s) return null;
  return { ...s, state: J(s.state, {}), score: J(s.score), override: J(s.override), review_reasons: J(s.review_reasons, []) };
}
export function saveState(id, state) {
  db.prepare('UPDATE sessions SET state = ? WHERE id = ?').run(JSON.stringify(state), id);
}
export function getTurns(sessionId) {
  return db.prepare('SELECT * FROM turns WHERE session_id = ? ORDER BY id').all(sessionId).map(t => ({ ...t, meta: J(t.meta, {}) }));
}
export function addTurn(t) {
  const r = db.prepare(`INSERT INTO turns (session_id, role, text, t_start, t_end, phase, question_id, action, assessment, latency_ms, meta)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(t.session_id, t.role, t.text, t.t_start ?? null, t.t_end ?? null, t.phase ?? null,
    t.question_id ?? null, t.action ?? null, t.assessment ?? null, t.latency_ms ?? null, JSON.stringify(t.meta || {}));
  return Number(r.lastInsertRowid);
}
export function addEvent(sessionId, t, type, detail = {}) {
  db.prepare('INSERT INTO events (session_id, t, type, detail) VALUES (?,?,?,?)').run(sessionId, t, type, JSON.stringify(detail));
}
export function getEvents(sessionId) {
  return db.prepare('SELECT * FROM events WHERE session_id = ? ORDER BY id').all(sessionId).map(e => ({ ...e, detail: J(e.detail, {}) }));
}
export function addAudit(sessionId, actor, action, detail) {
  db.prepare('INSERT INTO audit (session_id, at, actor, action, detail) VALUES (?,?,?,?,?)').run(sessionId, nowIso(), actor, action, JSON.stringify(detail));
}
export function getAudit(sessionId) {
  return db.prepare('SELECT * FROM audit WHERE session_id = ? ORDER BY id').all(sessionId).map(a => ({ ...a, detail: J(a.detail, {}) }));
}
