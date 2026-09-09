/**
 * 账号体系：注册 / 登录 / 会话令牌 / 角色权限
 *
 * - 密码用 node:crypto scrypt 加盐散列，不存明文
 * - 会话为随机 128bit token，存 sessions 表（30 天有效），前端以 Authorization: Bearer 携带
 * - 角色：首个注册的账号自动成为超级管理员（is_admin=1），可管理源与 AI；
 *   普通登录用户只能新增源
 */
import crypto from 'node:crypto';
import {
  createUser, getUserByUsername, getUserById, countUsers,
  createSession, getSession, deleteSession
} from './db.js';

const SESSION_TTL_SEC = 30 * 24 * 60 * 60;

export function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  } catch {
    return false;
  }
}

export function toPublic(u) {
  return { id: u.id, username: u.username, isAdmin: !!u.is_admin, createdAt: u.created_at * 1000 };
}

function issueToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  createSession(token, userId, Math.floor(Date.now() / 1000) + SESSION_TTL_SEC);
  return token;
}

export function register(username, password) {
  username = String(username || '').trim();
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,20}$/.test(username)) {
    throw new Error('用户名需 2~20 位，可用中文、字母、数字、下划线');
  }
  const pw = String(password || '');
  if (pw.length < 6 || pw.length > 64) throw new Error('密码需 6~64 位');
  if (getUserByUsername(username)) throw new Error('用户名已被注册');
  // 首个注册账号 = 超级管理员
  const isAdmin = countUsers() === 0;
  const u = createUser({ username, passHash: hashPassword(pw), isAdmin });
  return { user: toPublic(u), token: issueToken(u.id) };
}

export function login(username, password) {
  const u = getUserByUsername(String(username || '').trim());
  if (!u || !verifyPassword(password, u.pass_hash)) throw new Error('用户名或密码错误');
  return { user: toPublic(u), token: issueToken(u.id) };
}

export function logout(token) {
  if (token) deleteSession(token);
}

export function userForToken(token) {
  const s = getSession(token);
  if (!s) return null;
  return getUserById(s.user_id) || null;
}

export function tokenFromRequest(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

/* ---- 简单防爆破：同一 IP 10 分钟内最多 20 次失败 ---- */
const failLog = new Map();

function failKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function tooManyFails(req) {
  const a = failLog.get(failKey(req));
  return !!a && a.n >= 20 && Date.now() - a.t0 < 10 * 60 * 1000;
}

function noteFail(req) {
  const k = failKey(req);
  const a = failLog.get(k);
  if (!a || Date.now() - a.t0 >= 10 * 60 * 1000) failLog.set(k, { t0: Date.now(), n: 1 });
  else a.n += 1;
}

function clearFails(req) {
  failLog.delete(failKey(req));
}

/* ---- 中间件 ---- */

export function requireAuth(req, res, next) {
  const u = userForToken(tokenFromRequest(req));
  if (!u) return res.status(401).json({ error: '请先登录' });
  req.user = u;
  req.token = tokenFromRequest(req);
  next();
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: '该操作仅超级管理员可用' });
    next();
  });
}

/** 登录/注册路由用：防爆破 + 错误统一返回 400 */
export function withAuthGuard(handler) {
  return (req, res) => {
    if (tooManyFails(req)) return res.status(429).json({ error: '尝试过于频繁，请 10 分钟后再试' });
    try {
      const out = handler(req);
      clearFails(req);
      res.json(out);
    } catch (e) {
      noteFail(req);
      res.status(400).json({ error: e.message || '操作失败' });
    }
  };
}
