/**
 * SQLite 数据层（Node 22 内置 node:sqlite，零依赖）
 *
 * 表结构：
 *   sources  可搜索资源源（聚合搜索的数据源配置）
 *   settings 键值设置（AI 服务配置等）
 *   ai_logs  AI 操作记录（发现/更新网站的历史）
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

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

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
