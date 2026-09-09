/**
 * SQLite 数据层（Node 22 内置 node:sqlite，零依赖）
 *
 * 表结构：
 *   sources  可搜索资源源（聚合搜索的数据源配置）
 *   settings 键值设置（AI 服务配置等）
 *   ai_logs  AI 操作记录（发现/更新网站的历史）
 *   users / sessions     账号体系（注册用户与会话令牌）
 *   histories            个人播放/阅读记录（按 kind 区分频道）
 *
 * 数据库文件：server/data/app.db（首次启动自动创建并灌入种子源）
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_SOURCES } from './sources.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// FV_DB_PATH 仅供测试隔离用（默认 data/app.db）
const db = new DatabaseSync(process.env.FV_DB_PATH || path.join(DATA_DIR, 'app.db'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS sources (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    api           TEXT NOT NULL,
    web           TEXT DEFAULT '',
    tags          TEXT DEFAULT '[]',
    enabled       INTEGER DEFAULT 1,
    note          TEXT DEFAULT '',
    origin        TEXT DEFAULT 'user',
    last_check_at INTEGER DEFAULT 0,
    last_check_status TEXT DEFAULT '',
    last_check_ms     INTEGER DEFAULT 0,
    last_check_info   TEXT DEFAULT '',
    created_at    INTEGER DEFAULT (unixepoch()),
    updated_at    INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS ai_logs (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    action  TEXT NOT NULL,
    summary TEXT DEFAULT '',
    detail  TEXT DEFAULT '[]',
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT UNIQUE NOT NULL,
    pass_hash  TEXT NOT NULL,
    is_admin   INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS histories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    item_key   TEXT NOT NULL,
    title      TEXT DEFAULT '',
    subtitle   TEXT DEFAULT '',
    cover      TEXT DEFAULT '',
    payload    TEXT DEFAULT '{}',
    updated_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(user_id, kind, item_key)
  );

  CREATE TABLE IF NOT EXISTS resume_docs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    doc_id     TEXT NOT NULL,
    title      TEXT DEFAULT '未命名简历',
    data       TEXT DEFAULT '{}',
    updated_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(user_id, doc_id)
  );
`);

/* 种子迁移：表空时灌入内置源 */
const seedCount = db.prepare('SELECT COUNT(*) AS c FROM sources').get().c;
if (seedCount === 0) {
  const ins = db.prepare(
    'INSERT OR IGNORE INTO sources (id, name, api, web, tags, enabled, note, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const s of SEED_SOURCES) {
    ins.run(s.id, s.name, s.api, s.web || '', JSON.stringify(s.tags || []), s.enabled ? 1 : 0, s.note || '', 'builtin');
  }
}

function rowToSource(r) {
  if (!r) return null;
  let tags = [];
  try { tags = JSON.parse(r.tags || '[]'); } catch { /* 忽略坏数据 */ }
  return { ...r, tags, enabled: !!r.enabled };
}

/* ---------------- sources CRUD ---------------- */

export function listSources() {
  return db.prepare('SELECT * FROM sources ORDER BY origin, id').all().map(rowToSource);
}

export function listEnabledSources() {
  return db.prepare('SELECT * FROM sources WHERE enabled = 1 ORDER BY origin, id').all().map(rowToSource);
}

export function getSource(id) {
  return rowToSource(db.prepare('SELECT * FROM sources WHERE id = ?').get(id));
}

export function insertSource({ id, name, api, web = '', tags = [], enabled = true, note = '', origin = 'user' }) {
  db.prepare(
    'INSERT INTO sources (id, name, api, web, tags, enabled, note, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name, api, web, JSON.stringify(tags), enabled ? 1 : 0, note, origin);
  return getSource(id);
}

export function updateSource(id, fields) {
  const allow = ['name', 'api', 'web', 'tags', 'enabled', 'note'];
  const sets = [];
  const vals = [];
  for (const k of allow) {
    if (fields[k] === undefined) continue;
    sets.push(`${k} = ?`);
    vals.push(k === 'tags' ? JSON.stringify(fields.tags) : (k === 'enabled' ? (fields.enabled ? 1 : 0) : fields[k]));
  }
  if (!sets.length) return getSource(id);
  sets.push('updated_at = unixepoch()');
  vals.push(id);
  db.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getSource(id);
}

export function deleteSource(id) {
  return db.prepare('DELETE FROM sources WHERE id = ?').run(id).changes > 0;
}

export function updateCheckResult(id, { status, ms, info }) {
  db.prepare(
    `UPDATE sources SET last_check_at = unixepoch(), last_check_status = ?, last_check_ms = ?, last_check_info = ?
     WHERE id = ?`
  ).run(status, ms, info || '', id);
  return getSource(id);
}

/* ---------------- users / sessions（账号体系） ---------------- */

export function countUsers() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
}

export function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(String(username));
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function createUser({ username, passHash, isAdmin = false }) {
  const r = db.prepare('INSERT INTO users (username, pass_hash, is_admin) VALUES (?, ?, ?)')
    .run(username, passHash, isAdmin ? 1 : 0);
  return getUserById(r.lastInsertRowid);
}

export function createSession(token, userId, expiresAtSec) {
  // 顺手清掉该用户已过期的会话，防止表无限膨胀
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < unixepoch()').run(userId);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAtSec);
}

export function getSession(token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(String(token));
  if (!s || s.expires_at < Date.now() / 1000) return null;
  return s;
}

export function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(String(token));
}

/* ---------------- histories（个人播放/阅读记录） ---------------- */

export function upsertHistory({ userId, kind, key, title = '', subtitle = '', cover = '', payload = {} }) {
  db.prepare(
    `INSERT INTO histories (user_id, kind, item_key, title, subtitle, cover, payload, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(user_id, kind, item_key) DO UPDATE SET
       title = excluded.title, subtitle = excluded.subtitle, cover = excluded.cover,
       payload = excluded.payload, updated_at = excluded.updated_at`
  ).run(userId, kind, String(key), String(title), String(subtitle), String(cover), JSON.stringify(payload || {}));
}

export function listHistories(userId, kind, limit = 60) {
  return db.prepare(
    'SELECT * FROM histories WHERE user_id = ? AND kind = ? ORDER BY updated_at DESC, id DESC LIMIT ?'
  ).all(userId, String(kind), Math.min(Math.max(limit, 1), 100))
    .map(r => {
      let payload = {};
      try { payload = JSON.parse(r.payload || '{}'); } catch { /* 忽略坏数据 */ }
      return {
        kind: r.kind, key: r.item_key, title: r.title, subtitle: r.subtitle,
        cover: r.cover, payload, ts: r.updated_at * 1000
      };
    });
}

export function deleteHistory(userId, kind, key) {
  return db.prepare('DELETE FROM histories WHERE user_id = ? AND kind = ? AND item_key = ?')
    .run(userId, String(kind), String(key)).changes > 0;
}

export function clearHistories(userId, kind) {
  return db.prepare('DELETE FROM histories WHERE user_id = ? AND kind = ?')
    .run(userId, String(kind)).changes > 0;
}

/* ---------------- resume docs（在线简历，多文档云同步） ---------------- */

export function listResumeDocs(userId) {
  return db.prepare(
    'SELECT doc_id, title, updated_at FROM resume_docs WHERE user_id = ? ORDER BY updated_at DESC'
  ).all(userId).map(r => ({ docId: r.doc_id, title: r.title, updatedAt: r.updated_at * 1000 }));
}

export function getResumeDoc(userId, docId) {
  const r = db.prepare('SELECT doc_id, title, data, updated_at FROM resume_docs WHERE user_id = ? AND doc_id = ?')
    .get(userId, String(docId));
  if (!r) return null;
  let data = {};
  try { data = JSON.parse(r.data || '{}'); } catch { /* 忽略坏数据 */ }
  return { docId: r.doc_id, title: r.title, data, updatedAt: r.updated_at * 1000 };
}

export function upsertResumeDoc(userId, docId, { title, data }) {
  db.prepare(
    `INSERT INTO resume_docs (user_id, doc_id, title, data, updated_at)
     VALUES (?, ?, ?, ?, unixepoch())
     ON CONFLICT(user_id, doc_id) DO UPDATE SET
       title = excluded.title, data = excluded.data, updated_at = excluded.updated_at`
  ).run(userId, String(docId), String(title || '未命名简历'), JSON.stringify(data || {}));
}

export function deleteResumeDoc(userId, docId) {
  return db.prepare('DELETE FROM resume_docs WHERE user_id = ? AND doc_id = ?')
    .run(userId, String(docId)).changes > 0;
}

/* ---------------- settings ---------------- */

export function getSetting(key) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : '';
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

/* ---------------- ai logs ---------------- */

export function addAiLog(action, summary, detail = []) {
  const r = db.prepare('INSERT INTO ai_logs (action, summary, detail) VALUES (?, ?, ?)')
    .run(action, summary, JSON.stringify(detail));
  return r.lastInsertRowid;
}

export function listAiLogs(limit = 30) {
  return db.prepare('SELECT * FROM ai_logs ORDER BY id DESC LIMIT ?').all(limit)
    .map(r => {
      let detail = [];
      try { detail = JSON.parse(r.detail || '[]'); } catch { /* 忽略坏数据 */ }
      return { ...r, detail, created_at: r.created_at * 1000 };
    });
}
