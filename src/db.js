// Persistence. Every viva's state lives in the database, so any server process (or any
// serverless instance) can handle any request.
//   - Local / single server: SQLite file via node:sqlite (no native dependencies).
//   - Vercel / serverless: Turso (libSQL, SQLite-compatible) when TURSO_DATABASE_URL is set,
//     so all instances share one database.
// Both are exposed through the same async API: db.prepare(sql).get/all/run(...args).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// On Vercel only /tmp is writable (used for small caches such as OCR language data).
export const DATA_DIR = path.resolve(process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/ai-viva' : 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

const REMOTE_URL = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || '';
export const DB_KIND = REMOTE_URL ? 'turso' : 'sqlite';

const clean = args => args.map(a => (a === undefined ? null : a));

async function localAdapter() {
  const { DatabaseSync } = await import('node:sqlite');
  const sqlite = new DatabaseSync(process.env.DB_PATH || path.join(DATA_DIR, 'viva.db'));
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  const cache = new Map();
  const stmt = sql => { let s = cache.get(sql); if (!s) { s = sqlite.prepare(sql); cache.set(sql, s); } return s; };
  return {
    get: async (sql, args) => stmt(sql).get(...clean(args)),
    all: async (sql, args) => stmt(sql).all(...clean(args)),
    run: async (sql, args) => { const r = stmt(sql).run(...clean(args)); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; },
    exec: async sql => sqlite.exec(sql),
    batch: async items => { sqlite.exec('BEGIN'); try { for (const [sql, args] of items) stmt(sql).run(...clean(args)); sqlite.exec('COMMIT'); } catch (e) { sqlite.exec('ROLLBACK'); throw e; } },
  };
}

async function remoteAdapter() {
  const { createClient } = await import('@libsql/client/web');
  const client = createClient({ url: REMOTE_URL.replace(/^libsql:\/\//, 'https://'), authToken: process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN });
  const rows = rs => rs.rows.map(r => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));
  return {
    get: async (sql, args) => rows(await client.execute({ sql, args: clean(args) }))[0],
    all: async (sql, args) => rows(await client.execute({ sql, args: clean(args) })),
    run: async (sql, args) => { const rs = await client.execute({ sql, args: clean(args) }); return { changes: rs.rowsAffected, lastInsertRowid: Number(rs.lastInsertRowid ?? 0) }; },
    exec: async sql => client.executeMultiple(sql),
    batch: async items => { await client.batch(items.map(([sql, args]) => ({ sql, args: clean(args) })), 'write'); },
  };
}

const adapter = REMOTE_URL ? await remoteAdapter() : await localAdapter();
export const db = {
  prepare: sql => ({ get: (...a) => adapter.get(sql, a), all: (...a) => adapter.all(sql, a), run: (...a) => adapter.run(sql, a) }),
  exec: sql => adapter.exec(sql),
  batch: items => adapter.batch(items),
};

await db.exec(`
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
CREATE TABLE IF NOT EXISTS audio_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, seg TEXT, data BLOB
);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_q_viva ON questions(viva_id);
CREATE INDEX IF NOT EXISTS idx_audio_session ON audio_chunks(session_id, seg);
`);

// Migrations for databases created by earlier versions.
if (!(await db.prepare('PRAGMA table_info(sessions)').all()).some(c => c.name === 'student_email')) {
  await db.exec('ALTER TABLE sessions ADD COLUMN student_email TEXT');
}
await db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(viva_id, student_email)');
const vivaCols = (await db.prepare('PRAGMA table_info(vivas)').all()).map(c => c.name);
if (!vivaCols.includes('format')) await db.exec("ALTER TABLE vivas ADD COLUMN format TEXT DEFAULT 'phased'");
if (!vivaCols.includes('question_count')) await db.exec('ALTER TABLE vivas ADD COLUMN question_count INTEGER');
if (!vivaCols.includes('seconds_per_question')) await db.exec('ALTER TABLE vivas ADD COLUMN seconds_per_question INTEGER');

export const uid = (p = '') => p + crypto.randomBytes(8).toString('hex');
export const nowIso = () => new Date().toISOString();
const J = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
const vivaRow = v => ({ ...v, topics: J(v.topics, []), phases: J(v.phases, []), rubric: J(v.rubric, []),
  format: v.format || 'phased', questionCount: v.question_count, secondsPerQuestion: v.seconds_per_question });

export async function getViva(id) {
  const v = await db.prepare('SELECT * FROM vivas WHERE id = ? OR code = ?').get(id, id);
  return v ? vivaRow(v) : null;
}
export async function listVivas() {
  return (await db.prepare(`SELECT v.*, (SELECT COUNT(*) FROM sessions s WHERE s.viva_id = v.id) AS sessions,
    (SELECT COUNT(*) FROM questions q WHERE q.viva_id = v.id AND q.approved = 1) AS approved_questions,
    (SELECT COUNT(*) FROM questions q WHERE q.viva_id = v.id AND q.approved = 0) AS pending_questions
    FROM vivas v ORDER BY created_at DESC`).all()).map(vivaRow);
}
export async function getQuestions(vivaId, onlyApproved = true) {
  return db.prepare(`SELECT * FROM questions WHERE viva_id = ? ${onlyApproved ? 'AND approved = 1' : ''} ORDER BY created_at, rowid`).all(vivaId);
}
export async function insertQuestions(vivaId, qs, source, approved) {
  const sql = 'INSERT INTO questions (id, viva_id, text, topic, kind, difficulty, expected, source, approved, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)';
  const items = [], ids = [];
  for (const q of qs) {
    if (!q.text || !String(q.text).trim()) continue;
    const id = uid('q_');
    const kind = ['concept', 'depth', 'applied'].includes(q.kind) ? q.kind : 'concept';
    items.push([sql, [id, vivaId, String(q.text).trim(), q.topic || 'general', kind, q.difficulty || 'medium', q.expected || '', source, approved ? 1 : 0, nowIso()]]);
    ids.push(id);
  }
  if (items.length) await db.batch(items);   // one round trip, all-or-nothing
  return ids;
}
export async function getSession(id) {
  const s = await db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!s) return null;
  return { ...s, state: J(s.state, {}), score: J(s.score), override: J(s.override), review_reasons: J(s.review_reasons, []) };
}
export async function saveState(id, state) {
  await db.prepare('UPDATE sessions SET state = ? WHERE id = ?').run(JSON.stringify(state), id);
}
export async function getTurns(sessionId) {
  return (await db.prepare('SELECT * FROM turns WHERE session_id = ? ORDER BY id').all(sessionId)).map(t => ({ ...t, meta: J(t.meta, {}) }));
}
export async function addTurn(t) {
  const r = await db.prepare(`INSERT INTO turns (session_id, role, text, t_start, t_end, phase, question_id, action, assessment, latency_ms, meta)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(t.session_id, t.role, t.text, t.t_start ?? null, t.t_end ?? null, t.phase ?? null,
    t.question_id ?? null, t.action ?? null, t.assessment ?? null, t.latency_ms ?? null, JSON.stringify(t.meta || {}));
  return r.lastInsertRowid;
}
export async function addEvent(sessionId, t, type, detail = {}) {
  await db.prepare('INSERT INTO events (session_id, t, type, detail) VALUES (?,?,?,?)').run(sessionId, t, type, JSON.stringify(detail));
}
export async function getEvents(sessionId) {
  return (await db.prepare('SELECT * FROM events WHERE session_id = ? ORDER BY id').all(sessionId)).map(e => ({ ...e, detail: J(e.detail, {}) }));
}
export async function addAudit(sessionId, actor, action, detail) {
  await db.prepare('INSERT INTO audit (session_id, at, actor, action, detail) VALUES (?,?,?,?,?)').run(sessionId, nowIso(), actor, action, JSON.stringify(detail));
}
export async function getAudit(sessionId) {
  return (await db.prepare('SELECT * FROM audit WHERE session_id = ? ORDER BY id').all(sessionId)).map(a => ({ ...a, detail: J(a.detail, {}) }));
}
// Recordings: 5 s chunks stored in order; a segment is replayed by joining its chunks.
export async function addAudioChunk(sessionId, seg, data) {
  const first = !(await db.prepare('SELECT 1 FROM audio_chunks WHERE session_id = ? AND seg = ? LIMIT 1').get(sessionId, seg));
  await db.prepare('INSERT INTO audio_chunks (session_id, seg, data) VALUES (?,?,?)').run(sessionId, seg, data);
  return first;
}
export async function getAudio(sessionId, seg) {
  const rows = await db.prepare('SELECT data FROM audio_chunks WHERE session_id = ? AND seg = ? ORDER BY id').all(sessionId, seg);
  return rows.length ? Buffer.concat(rows.map(r => Buffer.from(r.data))) : null;
}
