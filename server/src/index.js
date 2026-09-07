import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_SITES, HOT_KEYWORDS } from './sources.js';
import { aggregateSearch, fetchDetail, probeSourceApi } from './aggregate.js';
import {
  listSources, getSource, insertSource, updateSource, deleteSource,
  updateCheckResult, listAiLogs
} from './db.js';
import {
  getAiConfig, setAiConfig, aiDiscoverSources, aiAnalyzeHealth, aiTestConnection
} from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../../client/dist');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));

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

// 站点目录：数据库源 + 导航站 + 热门词
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

// 新增源
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

// 修改源
app.put('/api/sources/:id', (req, res) => {
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

// 删除源
app.delete('/api/sources/:id', (req, res) => {
  const ok = deleteSource(req.params.id);
  if (!ok) return res.status(404).json({ error: '源不存在' });
  res.json({ ok: true });
});

// 检测源可用性并写库（id=all 检测全部）
app.post('/api/sources/check', async (req, res) => {
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

/* ---------------- AI 功能 ---------------- */

app.get('/api/ai/config', (_req, res) => {
  const cfg = getAiConfig();
  res.json({
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    hasKey: !!cfg.apiKey,
    keyMasked: cfg.apiKey ? cfg.apiKey.slice(0, 6) + '****' : ''
  });
});

app.post('/api/ai/config', (req, res) => {
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
app.post('/api/ai/discover-sources', async (req, res) => {
  const autoAdd = !req.body || req.body.autoAdd !== false;
  const count = Math.min(Math.max(parseInt(req.body?.count) || 8, 3), 12);
  try {
    res.json(await aiDiscoverSources({ autoAdd, count }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// AI 体检分析
app.post('/api/ai/analyze', async (_req, res) => {
  try {
    res.json(await aiAnalyzeHealth());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/ai/logs', (_req, res) => {
  res.json({ logs: listAiLogs(30) });
});

/* ---------------- 前端静态托管（生产模式） ---------------- */

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
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
  console.log('  │   聚搜影视 已启动（SQLite + AI 已启用）   │');
  console.log(`  │   打开浏览器访问  http://localhost:${PORT}  │`);
  console.log('  ╰──────────────────────────────────────────╯');
  console.log('');
});
