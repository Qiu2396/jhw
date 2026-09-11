import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_SITES, HOT_KEYWORDS } from './sources.js';
import { aggregateSearch, fetchDetail, probeSourceApi } from './aggregate.js';
import {
  listSources, getSource, insertSource, updateSource, deleteSource,
  updateCheckResult, listAiLogs,
  upsertHistory, listHistories, deleteHistory, clearHistories,
  listResumeDocs, getResumeDoc, upsertResumeDoc, deleteResumeDoc
} from './db.js';
import {
  register, login, logout, toPublic, userForToken, tokenFromRequest,
  requireAuth, requireAdmin, withAuthGuard
} from './auth.js';
import {
  getAiConfig, setAiConfig, aiDiscoverSources, aiAnalyzeHealth, aiTestConnection
} from './ai.js';
import { searchMusic, musicUrl, musicLyric, musicPic, checkMusicSource } from './music.js';
import { novelSearch, novelToc, novelChapter, isAllowedNovelUrl, checkNovelSource } from './novel.js';
import { audiobookSearch, audiobookBook, audiobookPlay, isAllowedAudiobookUrl, checkAudiobookSource } from './audiobook.js';
import { comicSearch, comicBook, comicImages, isAllowedComicUrl, checkComicSource } from './comic.js';
import { wallpaperSearch, wallpaperDaily, wallpaperDetail, isAllowedWallpaperUrl, checkWallpaperSource } from './wallpaper.js';
import { listChannelSources, setDisabled } from './channel-sources.js';
import toolsRouter from './tools.js';
import { resourceSearch } from './resource.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../../client/dist');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));

// API 响应一律禁止缓存，避免浏览器用过期的旧数据
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

/* ---------------- 搜索 / 详情 ---------------- */

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: Date.now() });
});

app.get('/api/search', async (req, res) => {
  const kw = String(req.query.kw || '').trim();
  if (!kw) return res.status(400).json({ error: '缺少关键词 kw' });
  if (kw.length > 60) return res.status(400).json({ error: '关键词过长' });

  const started = Date.now();
  try {
    const result = await aggregateSearch(kw, {
      include: req.query.sources || '',
      exclude: req.query.exclude || ''
    });
    res.json({ ...result, tookMs: Date.now() - started });
  } catch (e) {
    res.status(500).json({ error: e.message || '搜索失败' });
  }
});

app.get('/api/detail', async (req, res) => {
  const sourceId = String(req.query.source || '').trim();
  const vodId = String(req.query.vid || '').trim();
  if (!sourceId || !vodId) return res.status(400).json({ error: '缺少参数 source / vid' });
  if (!/^\d+$/.test(vodId)) return res.status(400).json({ error: 'vid 不合法' });
  if (!getSource(sourceId)) return res.status(400).json({ error: `未知站点: ${sourceId}` });

  try {
    res.json(await fetchDetail(sourceId, vodId));
  } catch (e) {
    const msg = e?.name === 'AbortError' ? '源站请求超时' : (e.message || '获取详情失败');
    res.status(502).json({ error: msg });
  }
});

/* ---------------- 源管理（SQLite） ---------------- */

// 站点目录：数据库源 + 导航站 + 热门词（公开读取，管理操作按角色限制）
app.get('/api/sources', (_req, res) => {
  res.json({ sources: listSources(), navSites: NAV_SITES, hotKeywords: HOT_KEYWORDS });
});

function validateSourcePayload(body) {
  const name = String(body.name || '').trim();
  const api = String(body.api || '').trim();
  if (!name || name.length > 40) return { error: '名称必填且不超过 40 字' };
  if (!/^https?:\/\/.+/.test(api)) return { error: '接口地址必须以 http(s):// 开头' };
  if (body.web && !/^https?:\/\/.+/.test(String(body.web))) return { error: '前台地址必须以 http(s):// 开头' };
  return {
    data: {
      name,
      api,
      web: String(body.web || '').trim(),
      tags: Array.isArray(body.tags) ? body.tags.map(t => String(t).slice(0, 10)).slice(0, 4) : [],
      note: String(body.note || '').slice(0, 120),
      enabled: body.enabled !== false
    }
  };
}

// 新增源：游客与登录用户都可以（不强制登录）；管理操作仅超级管理员
app.post('/api/sources', (req, res) => {
  const v = validateSourcePayload(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  let id = String(req.body.id || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
  if (!id) {
    // 未指定 id 时从名称生成，冲突则加后缀
    id = 'src';
    let i = 1;
    while (getSource(id)) id = `src${++i}`;
  } else if (getSource(id)) {
    return res.status(409).json({ error: `标识 ${id} 已存在` });
  }
  const row = insertSource({ ...v.data, id, origin: 'user' });
  res.json(row);
});

// 修改源（仅超级管理员）
app.put('/api/sources/:id', requireAdmin, (req, res) => {
  if (!getSource(req.params.id)) return res.status(404).json({ error: '源不存在' });
  const v = validateSourcePayload({ ...req.body, api: req.body.api });
  if (v.error) return res.status(400).json({ error: v.error });
  const row = updateSource(req.params.id, {
    name: v.data.name, api: v.data.api, web: v.data.web,
    tags: v.data.tags, note: v.data.note,
    enabled: req.body.enabled !== undefined ? !!req.body.enabled : undefined
  });
  res.json(row);
});

// 删除源（仅超级管理员）
app.delete('/api/sources/:id', requireAdmin, (req, res) => {
  const ok = deleteSource(req.params.id);
  if (!ok) return res.status(404).json({ error: '源不存在' });
  res.json({ ok: true });
});

// 检测源可用性并写库（id=all 检测全部；仅超级管理员）
app.post('/api/sources/check', requireAdmin, async (req, res) => {
  const target = String((req.body && req.body.id) || 'all');
  const ids = target === 'all' ? listSources().map(s => s.id) : [target];
  const results = [];
  await Promise.all(ids.map(async id => {
    const s = getSource(id);
    if (!s) return;
    const r = await probeSourceApi(s.api);
    const row = updateCheckResult(id, { status: r.ok ? 'ok' : 'fail', ms: r.ms, info: r.info });
    results.push({ id, ok: r.ok, ms: r.ms, info: r.info, last_check_at: row.last_check_at });
  }));
  results.sort((a, b) => a.id.localeCompare(b.id));
  res.json({ results });
});

/* ---------------- AI 功能（配置与操作仅超级管理员） ---------------- */

app.get('/api/ai/config', requireAdmin, (_req, res) => {
  const cfg = getAiConfig();
  res.json({
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    hasKey: !!cfg.apiKey,
    keyMasked: cfg.apiKey ? cfg.apiKey.slice(0, 6) + '****' : ''
  });
});

app.post('/api/ai/config', requireAdmin, (req, res) => {
  const { baseUrl, apiKey, model } = req.body || {};
  setAiConfig({ baseUrl, apiKey, model });
  res.json({ ok: true });
});

app.post('/api/ai/test', async (_req, res) => {
  try {
    res.json(await aiTestConnection());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// AI 发现新源：LLM 推荐 → 逐个真实验证 → 可自动入库
app.post('/api/ai/discover-sources', requireAdmin, async (req, res) => {
  const autoAdd = !req.body || req.body.autoAdd !== false;
  const count = Math.min(Math.max(parseInt(req.body?.count) || 8, 3), 12);
  try {
    res.json(await aiDiscoverSources({ autoAdd, count }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// AI 体检分析
app.post('/api/ai/analyze', requireAdmin, async (_req, res) => {
  try {
    res.json(await aiAnalyzeHealth());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/ai/logs', requireAdmin, (_req, res) => {
  res.json({ logs: listAiLogs(30) });
});

/* ---------------- 账号体系 ---------------- */

app.post('/api/auth/register', withAuthGuard(req => register(req.body?.username, req.body?.password)));

app.post('/api/auth/login', withAuthGuard(req => login(req.body?.username, req.body?.password)));

app.post('/api/auth/logout', (req, res) => {
  logout(tokenFromRequest(req));
  res.json({ ok: true });
});

// 当前登录用户（未登录返回 user: null，前端据此恢复会话）
app.get('/api/auth/me', (req, res) => {
  const u = userForToken(tokenFromRequest(req));
  res.json({ user: u ? toPublic(u) : null });
});

/* ---------------- 个人播放/阅读记录（需登录） ---------------- */

const HISTORY_KINDS = ['video', 'music', 'audiobook', 'novel', 'comic'];

app.get('/api/history', requireAuth, (req, res) => {
  const kind = String(req.query.kind || '').trim();
  if (!HISTORY_KINDS.includes(kind)) return res.status(400).json({ error: 'kind 不合法' });
  res.json({ items: listHistories(req.user.id, kind, parseInt(req.query.limit) || 60) });
});

app.post('/api/history', requireAuth, (req, res) => {
  const { kind, key, title, subtitle, cover, payload } = req.body || {};
  if (!HISTORY_KINDS.includes(kind)) return res.status(400).json({ error: 'kind 不合法' });
  if (key === undefined || key === null || String(key).trim() === '') {
    return res.status(400).json({ error: '缺少 key' });
  }
  upsertHistory({
    userId: req.user.id, kind,
    key: String(key).slice(0, 300),
    title: String(title || '').slice(0, 200),
    subtitle: String(subtitle || '').slice(0, 200),
    cover: String(cover || '').slice(0, 500),
    payload: payload && typeof payload === 'object' ? payload : {}
  });
  res.json({ ok: true });
});

// 删除单条（注意先注册带 :key 的具体路由，再注册清空路由）
app.delete('/api/history/:kind/:key', requireAuth, (req, res) => {
  if (!HISTORY_KINDS.includes(req.params.kind)) return res.status(400).json({ error: 'kind 不合法' });
  res.json({ ok: deleteHistory(req.user.id, req.params.kind, req.params.key) });
});

app.delete('/api/history/:kind', requireAuth, (req, res) => {
  if (!HISTORY_KINDS.includes(req.params.kind)) return res.status(400).json({ error: 'kind 不合法' });
  res.json({ ok: clearHistories(req.user.id, req.params.kind) });
});

/* ---------------- 音乐（免费听歌，GDStudio 聚合） ---------------- */

app.get('/api/music/search', async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: '缺少关键词 name' });
  try {
    res.json({ songs: await searchMusic(name, parseInt(req.query.count) || 50) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/music/url', async (req, res) => {
  const songId = String(req.query.songId || '').trim();
  if (!/^[0-9]+$/.test(songId)) return res.status(400).json({ error: 'songId 不合法' });
  const br = Math.min(Math.max(parseInt(req.query.br) || 320000, 128000), 999000);
  try {
    res.json(await musicUrl(songId, br));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/music/lyric', async (req, res) => {
  const songId = String(req.query.songId || '').trim();
  if (!/^[0-9]+$/.test(songId)) return res.status(400).json({ error: 'songId 不合法' });
  try {
    res.json(await musicLyric(songId));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/music/pic', async (req, res) => {
  const songId = String(req.query.songId || '').trim();
  if (!/^[0-9]+$/.test(songId)) return res.status(400).json({ error: 'songId 不合法' });
  try {
    res.json(await musicPic(songId, Math.min(parseInt(req.query.size) || 300, 1300)));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ---------------- 小说（文字阅读，杰奇/笔趣阁模板站代理解析） ---------------- */

/* ---------------- 内置频道源（音乐/小说/听书/漫画，站点目录展示与管理） ---------------- */

const CHANNEL_CHECKERS = {
  music: () => checkMusicSource(),
  novel: (id) => checkNovelSource(id),
  audiobook: (id) => checkAudiobookSource(id),
  comic: (id) => checkComicSource(id),
  wallpaper: (id) => checkWallpaperSource(id)
};

// 公开读取：站点目录展示各频道内置源与启停状态
app.get('/api/channel-sources', (_req, res) => {
  res.json({ sources: listChannelSources() });
});

// 停用/启用（仅超级管理员）
app.post('/api/channel-sources/toggle', requireAdmin, (req, res) => {
  const { kind, id, disabled } = req.body || {};
  const known = listChannelSources().some(s => s.kind === kind && s.id === id);
  if (!known) return res.status(400).json({ error: '频道源不存在' });
  setDisabled(String(kind), String(id), !!disabled);
  const item = listChannelSources().find(s => s.kind === kind && s.id === id);
  res.json({ ok: true, item });
});

// 单源检测（仅超级管理员）
app.post('/api/channel-sources/check', requireAdmin, async (req, res) => {
  const { kind, id } = req.body || {};
  const checker = CHANNEL_CHECKERS[String(kind)];
  if (!checker || !listChannelSources().some(s => s.kind === String(kind) && s.id === String(id))) {
    return res.status(400).json({ error: '频道源不存在' });
  }
  try {
    const started = Date.now();
    const r = await checker(String(id));
    res.json({ ok: !!r.ok, info: r.info, ms: Date.now() - started });
  } catch (e) {
    res.json({ ok: false, info: e.message || '检测失败', ms: 0 });
  }
});

/* ---------------- 小说（文字阅读，杰奇/笔趣阁模板站代理解析） ---------------- */

app.get('/api/novel/search', async (req, res) => {
  const kw = String(req.query.kw || '').trim();
  if (!kw) return res.status(400).json({ error: '缺少关键词 kw' });
  if (kw.length > 40) return res.status(400).json({ error: '关键词过长' });
  try {
    res.json(await novelSearch(kw));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/novel/toc', async (req, res) => {
  const src = String(req.query.src || '').trim();
  const url = String(req.query.url || '').trim();
  if (!src || !url) return res.status(400).json({ error: '缺少参数 src / url' });
  if (!isAllowedNovelUrl(url)) return res.status(400).json({ error: 'url 不在收录源范围内' });
  try {
    res.json(await novelToc(src, url));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/novel/chapter', async (req, res) => {
  const src = String(req.query.src || '').trim();
  const url = String(req.query.url || '').trim();
  if (!src || !url) return res.status(400).json({ error: '缺少参数 src / url' });
  if (!isAllowedNovelUrl(url)) return res.status(400).json({ error: 'url 不在收录源范围内' });
  try {
    res.json(await novelChapter(src, url));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ---------------- 听书（有声小说，第三方站代理解析） ---------------- */

app.get('/api/audiobook/search', async (req, res) => {
  const kw = String(req.query.kw || '').trim();
  if (!kw) return res.status(400).json({ error: '缺少关键词 kw' });
  if (kw.length > 40) return res.status(400).json({ error: '关键词过长' });
  try {
    res.json(await audiobookSearch(kw));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/audiobook/book', async (req, res) => {
  const src = String(req.query.src || '').trim();
  const url = String(req.query.url || '').trim();
  if (!src || !url) return res.status(400).json({ error: '缺少参数 src / url' });
  if (!isAllowedAudiobookUrl(url)) return res.status(400).json({ error: 'url 不在收录源范围内' });
  try {
    res.json(await audiobookBook(src, url));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/audiobook/play', async (req, res) => {
  const src = String(req.query.src || '').trim();
  const url = String(req.query.url || '').trim();
  if (!src || !url) return res.status(400).json({ error: '缺少参数 src / url' });
  if (!isAllowedAudiobookUrl(url)) return res.status(400).json({ error: 'url 不在收录源范围内' });
  try {
    res.json(await audiobookPlay(src, url));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ---------------- 漫画（第三方站代理解析） ---------------- */

app.get('/api/comic/search', async (req, res) => {
  const kw = String(req.query.kw || '').trim();
  if (!kw) return res.status(400).json({ error: '缺少关键词 kw' });
  if (kw.length > 40) return res.status(400).json({ error: '关键词过长' });
  try {
    res.json(await comicSearch(kw));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/comic/book', async (req, res) => {
  const src = String(req.query.src || '').trim();
  const url = String(req.query.url || '').trim();
  if (!src || !url) return res.status(400).json({ error: '缺少参数 src / url' });
  if (!isAllowedComicUrl(url)) return res.status(400).json({ error: 'url 不在收录源范围内' });
  try {
    res.json(await comicBook(src, url));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/comic/images', async (req, res) => {
  const src = String(req.query.src || '').trim();
  const url = String(req.query.url || '').trim();
  if (!src || !url) return res.status(400).json({ error: '缺少参数 src / url' });
  if (!isAllowedComicUrl(url)) return res.status(400).json({ error: 'url 不在收录源范围内' });
  try {
    res.json(await comicImages(src, url));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ---------------- 壁纸（多源聚合搜索 + 必应每日 + 多分辨率下载） ---------------- */

app.get('/api/wallpaper/search', async (req, res) => {
  const kw = String(req.query.kw || '').trim();
  const cat = String(req.query.cat || '').trim();
  if (!kw && !cat) return res.status(400).json({ error: '缺少关键词 kw 或分类 cat' });
  try {
    res.json(await wallpaperSearch(kw, req.query.page, cat));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/wallpaper/daily', async (req, res) => {
  try {
    res.json(await wallpaperDaily(req.query.page));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/wallpaper/detail', async (req, res) => {
  const src = String(req.query.src || '').trim();
  const url = String(req.query.url || '').trim();
  if (!src || !url) return res.status(400).json({ error: '缺少参数 src / url' });
  if (src !== 'bing' && !isAllowedWallpaperUrl(url)) return res.status(400).json({ error: 'url 不在收录源范围内' });
  try {
    res.json(await wallpaperDetail(src, url));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 图片代理：仅用于「下载」（带附件文件名）；host 白名单防 SSRF
app.get('/api/wallpaper/img', async (req, res) => {
  const url = String(req.query.u || '').trim();
  if (!isAllowedWallpaperUrl(url)) return res.status(400).json({ error: 'url 不在收录源范围内' });
  try {
    const upstream = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' } });
    if (!upstream.ok || !upstream.body) return res.status(502).json({ error: `源站返回 ${upstream.status}` });
    const name = String(req.query.dl || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'wallpaper.jpg';
    const ext = (url.match(/\.(jpe?g|png|webp)(?:$|&)/i) || [])[1] || 'jpg';
    res.setHeader('Content-Type', upstream.headers.get('content-type') || `image/${ext}`);
    if (upstream.headers.get('content-length')) res.setHeader('Content-Length', upstream.headers.get('content-length'));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}.${ext}`);
    const { Readable } = await import('node:stream');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) {
    res.status(502).json({ error: e.message || '图片获取失败' });
  }
});

/* ---------------- 在线简历（多文档云同步，需登录；游客仅本机） ---------------- */

const DOC_ID_RE = /^[a-zA-Z0-9_-]{1,40}$/;

app.get('/api/resume', requireAuth, (req, res) => {
  res.json({ docs: listResumeDocs(req.user.id) });
});

app.get('/api/resume/:docId', requireAuth, (req, res) => {
  if (!DOC_ID_RE.test(req.params.docId)) return res.status(400).json({ error: 'docId 不合法' });
  const doc = getResumeDoc(req.user.id, req.params.docId);
  if (!doc) return res.status(404).json({ error: '简历不存在' });
  res.json(doc);
});

app.put('/api/resume/:docId', requireAuth, (req, res) => {
  const docId = String(req.params.docId || '');
  if (!DOC_ID_RE.test(docId)) return res.status(400).json({ error: 'docId 不合法' });
  const { title, data } = req.body || {};
  if (typeof data !== 'object' || data === null) return res.status(400).json({ error: 'data 缺失' });
  upsertResumeDoc(req.user.id, docId, { title: String(title || '未命名简历').slice(0, 60), data });
  res.json({ ok: true, updatedAt: Date.now() });
});

app.delete('/api/resume/:docId', requireAuth, (req, res) => {
  if (!DOC_ID_RE.test(req.params.docId)) return res.status(400).json({ error: 'docId 不合法' });
  res.json({ ok: deleteResumeDoc(req.user.id, req.params.docId) });
});

/* ---------------- 小工具（压缩图片 / PDF 转 Word / 抠图 / 抖音无水印） ---------------- */

app.use('/api/tools', toolsRouter);

/* ---------------- 全文资源搜索（公开索引聚合） ---------------- */

app.get('/api/resource/search', async (req, res) => {
  const kw = String(req.query.kw || '').trim();
  if (!kw) return res.status(400).json({ error: '缺少关键词 kw' });
  if (kw.length > 60) return res.status(400).json({ error: '关键词过长' });
  try {
    res.json(await resourceSearch(kw));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ---------------- 前端静态托管（生产模式） ---------------- */

if (fs.existsSync(DIST_DIR)) {
  // index.html 禁止缓存：否则发新版本后浏览器可能继续用旧壳加载旧 bundle
  app.use(express.static(DIST_DIR, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    }
  }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  console.error('[server error]', err);
  res.status(500).json({ error: '服务器内部错误' });
});

/* ---------------- 源自动巡检 ---------------- */

const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;   // 每 6 小时
const AUTO_CHECK_FIRST_DELAY_MS = 30 * 1000;          // 启动 30s 后首巡
let autoChecking = false;

async function runAutoCheck() {
  if (autoChecking) return;
  autoChecking = true;
  const started = Date.now();
  try {
    const all = listSources();
    await Promise.all(all.map(async s => {
      const r = await probeSourceApi(s.api);
      updateCheckResult(s.id, { status: r.ok ? 'ok' : 'fail', ms: r.ms, info: r.info });
    }));
    const after = listSources();
    const dead = after.filter(s => s.last_check_status !== 'ok').map(s => s.id);
    console.log(`[auto-check] 巡检完成 ${all.length} 源 / ${(Date.now() - started) / 1000}s${dead.length ? `，异常: ${dead.join(',')}` : '，全部正常'}`);
  } catch (e) {
    console.error('[auto-check] 巡检失败:', e.message);
  } finally {
    autoChecking = false;
  }
}

function startAutoCheck() {
  setTimeout(() => {
    runAutoCheck();
    setInterval(runAutoCheck, AUTO_CHECK_INTERVAL_MS);
  }, AUTO_CHECK_FIRST_DELAY_MS);
}

startAutoCheck();

app.listen(PORT, () => {
  console.log('');
  console.log('  ╭──────────────────────────────────────────╮');
  console.log('  │   聚搜王 已启动（SQLite + AI 已启用）   │');
  console.log(`  │   打开浏览器访问  http://localhost:${PORT}  │`);
  console.log('  ╰──────────────────────────────────────────╯');
  console.log('');
});
