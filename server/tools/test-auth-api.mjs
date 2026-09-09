/**
 * 账号体系 + 历史记录 + 源权限 API 集成测试（用独立测试库，跑完即删）
 * 用法：node tools/test-auth-api.mjs
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 3311;
const BASE = `http://localhost:${PORT}`;
const DB = fileURLToPath(new URL('../data/test-auth.db', import.meta.url));

process.env.FV_DB_PATH = DB;
process.env.PORT = String(PORT);
await import('../src/index.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(1200);

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
}

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data };
}

console.log('--- 账号注册 / 登录 ---');
{
  const r1 = await req('POST', '/api/auth/register', { body: { username: '超级管理员', password: 'abc12345' } });
  check('中文用户名注册成功且成为超管', r1.status === 200 && r1.data.user?.isAdmin === true, JSON.stringify(r1.data));

  const r2 = await req('POST', '/api/auth/register', { body: { username: 'xiaoming', password: 'abc12345' } });
  check('第二个注册为普通用户', r2.status === 200 && r2.data.user?.isAdmin === false);

  const r3 = await req('POST', '/api/auth/register', { body: { username: 'x', password: 'abc12345' } });
  check('过短用户名被拒', r3.status === 400);

  const r4 = await req('POST', '/api/auth/register', { body: { username: 'xiaoming', password: 'zzzzzz' } });
  check('重复用户名被拒', r4.status === 400);

  const r5 = await req('POST', '/api/auth/register', { body: { username: 'ok123', password: '123' } });
  check('过短密码被拒', r5.status === 400);

  const l1 = await req('POST', '/api/auth/login', { body: { username: '超级管理员', password: 'abc12345' } });
  check('中文用户名登录成功', l1.status === 200 && !!l1.data.token);

  const l2 = await req('POST', '/api/auth/login', { body: { username: '超级管理员', password: 'wrong!' } });
  check('错误密码被拒', l2.status === 400);

  globalThis.adminTok = l1.data.token;
  globalThis.userTok = r2.data.token;
}
{
  const me = await req('GET', '/api/auth/me', { token: globalThis.adminTok });
  check('me 返回超管身份', me.data.user?.isAdmin === true && me.data.user?.username === '超级管理员');

  const meAnon = await req('GET', '/api/auth/me');
  check('未登录 me 返回 null', meAnon.data.user === null);

  const bad = await req('GET', '/api/auth/me', { token: 'not-a-token' });
  check('无效令牌 me 返回 null', bad.data.user === null);
}

console.log('--- 历史记录 ---');
{
  const put = await req('POST', '/api/history', {
    token: globalThis.userTok,
    body: { kind: 'audiobook', key: '斗破苍穹|主播A', title: '斗破苍穹', subtitle: '主播A · 第12集', cover: 'http://x/c.jpg', payload: { chapterIdx: 11, chapterUrl: 'http://x/12' } }
  });
  check('写入听书记录', put.status === 200);

  await req('POST', '/api/history', {
    token: globalThis.userTok,
    body: { kind: 'music', key: 'song-1', title: '成都', subtitle: '赵雷', payload: { name: '成都' } }
  });
  await req('POST', '/api/history', {
    token: globalThis.userTok,
    body: { kind: 'novel', key: '凡人修仙传|忘语', title: '凡人修仙传', subtitle: '第3章', payload: { chapterIdx: 2 } }
  });
  // 同 key 再写 → 更新不重复
  await req('POST', '/api/history', {
    token: globalThis.userTok,
    body: { kind: 'audiobook', key: '斗破苍穹|主播A', title: '斗破苍穹', subtitle: '主播A · 第13集', payload: { chapterIdx: 12 } }
  });

  const list = await req('GET', '/api/history?kind=audiobook', { token: globalThis.userTok });
  check('听书记录列表且同 key 去重更新', list.data.items?.length === 1 && list.data.items[0].subtitle.includes('第13集'), JSON.stringify(list.data.items));

  const all = await req('GET', '/api/history?kind=music', { token: globalThis.userTok });
  check('听歌记录列表', all.data.items?.length === 1 && all.data.items[0].title === '成都');

  const badKind = await req('GET', '/api/history?kind=hack', { token: globalThis.userTok });
  check('非法 kind 被拒', badKind.status === 400);

  const noAuth = await req('GET', '/api/history?kind=music');
  check('未登录读历史 401', noAuth.status === 401);

  const del = await req('DELETE', `/api/history/${encodeURIComponent('audiobook')}/${encodeURIComponent('斗破苍穹|主播A')}`, { token: globalThis.userTok });
  check('删除单条记录', del.status === 200 && del.data.ok === true);

  const after = await req('GET', '/api/history?kind=audiobook', { token: globalThis.userTok });
  check('删除后列表为空', after.data.items?.length === 0);

  await req('POST', '/api/history', { token: globalThis.userTok, body: { kind: 'comic', key: 'k1', title: 't1' } });
  await req('POST', '/api/history', { token: globalThis.userTok, body: { kind: 'comic', key: 'k2', title: 't2' } });
  const clear = await req('DELETE', '/api/history/comic', { token: globalThis.userTok });
  const afterClear = await req('GET', '/api/history?kind=comic', { token: globalThis.userTok });
  check('清空漫画记录', clear.status === 200 && afterClear.data.items?.length === 0);

  const iso = await req('GET', '/api/history?kind=music', { token: globalThis.adminTok });
  check('记录按用户隔离（超管看不到普通用户的）', iso.data.items?.length === 0);
}

console.log('--- 源权限 ---');
{
  const anonAdd = await req('POST', '/api/sources', { body: { name: '游客的源', api: 'https://example.com/api' } });
  check('游客（不登录）可新增源', anonAdd.status === 200, JSON.stringify(anonAdd.data));
  const anonEdit = await req('PUT', `/api/sources/${anonAdd.data.id}`, { body: { name: '游客改名', api: 'https://example.com/api' } });
  check('游客修改源被拒(401)', anonEdit.status === 401);
  const anonDel = await req('DELETE', `/api/sources/${anonAdd.data.id}`);
  check('游客删除源被拒(401)', anonDel.status === 401);
  // 清掉游客源，避免影响后续断言
  await req('DELETE', `/api/sources/${anonAdd.data.id}`, { token: globalThis.adminTok });

  const userAdd = await req('POST', '/api/sources', {
    token: globalThis.userTok,
    body: { name: '小明的源', api: 'https://example.com/api', tags: ['测试'] }
  });
  check('普通用户可新增源', userAdd.status === 200 && userAdd.data.name === '小明的源');

  const userEdit = await req('PUT', `/api/sources/${userAdd.data.id}`, { token: globalThis.userTok, body: { name: '改名', api: 'https://example.com/api' } });
  check('普通用户修改源 403', userEdit.status === 403);

  const userDel = await req('DELETE', `/api/sources/${userAdd.data.id}`, { token: globalThis.userTok });
  check('普通用户删除源 403', userDel.status === 403);

  const userCheck = await req('POST', '/api/sources/check', { token: globalThis.userTok, body: { id: 'bf' } });
  check('普通用户检测源 403', userCheck.status === 403);

  const adminEdit = await req('PUT', `/api/sources/${userAdd.data.id}`, { token: globalThis.adminTok, body: { name: '超管改名', api: 'https://example.com/api' } });
  check('超管可修改源', adminEdit.status === 200 && adminEdit.data.name === '超管改名');

  const adminDel = await req('DELETE', `/api/sources/${userAdd.data.id}`, { token: globalThis.adminTok });
  check('超管可删除源', adminDel.status === 200 && adminDel.data.ok === true);
}

console.log('--- AI 权限 ---');
{
  const aiCfg = await req('GET', '/api/ai/config', { token: globalThis.userTok });
  check('普通用户读 AI 配置 403', aiCfg.status === 403);
  const aiCfgAdmin = await req('GET', '/api/ai/config', { token: globalThis.adminTok });
  check('超管读 AI 配置 200', aiCfgAdmin.status === 200);
  const anonDiscover = await req('POST', '/api/ai/discover-sources', { body: { autoAdd: false } });
  check('未登录 AI 发现 401/403', anonDiscover.status === 401 || anonDiscover.status === 403);
}

console.log('--- 登出 ---');
{
  const lo = await req('POST', '/api/auth/logout', { token: globalThis.userTok });
  const me = await req('GET', '/api/auth/me', { token: globalThis.userTok });
  check('登出后会话失效', lo.status === 200 && me.data.user === null);
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
