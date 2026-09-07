import { listEnabledSources, getSource } from './db.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT_MS = 12000;

/** fetch 并解码为文本：优先 UTF-8，出现替换符时回退 GBK（部分 macCMS 站为 GBK 编码） */
async function fetchText(url, signal) {
  const res = await fetch(url, { signal, headers: { 'User-Agent': UA, 'Referer': new URL(url).origin } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('\uFFFD')) {
    try {
      const gbk = new TextDecoder('gbk').decode(buf);
      if (!gbk.includes('\uFFFD')) text = gbk;
    } catch { /* ICU 不支持时忽略，保留 UTF-8 结果 */ }
  }
  return text;
}

async function fetchJson(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const text = await fetchText(url, ctl.signal);
    // 有些站异常时返回 HTML 错误页，先探测
    const start = text.indexOf('{');
    if (start > 0) {
      try { return JSON.parse(text.slice(start)); } catch { /* fallthrough */ }
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/** 调用 macCMS 搜索接口，返回标准化后的条目数组 */
async function searchSource(source, kw) {
  const url = `${source.api}?${new URLSearchParams({ ac: 'videolist', wd: kw })}`;
  const json = await fetchJson(url);
  const list = Array.isArray(json.list) ? json.list : [];
  return list
    .filter(v => v && v.vod_name)
    .map(v => ({
      sourceId: source.id,
      sourceName: source.name,
      vodId: String(v.vod_id),
      title: String(v.vod_name).trim(),
      sub: (v.vod_sub || '').trim(),
      year: String(v.vod_year || '').trim(),
      type: (v.type_name || '').trim(),
      remarks: (v.vod_remarks || '').trim(),
      cover: (v.vod_pic || '').trim(),
      updatedAt: (v.vod_time || '').trim()
    }));
}

/** 调用 macCMS 详情接口，解析出播放源与剧集（m3u8 地址） */
export async function fetchDetail(sourceId, vodId) {
  const source = getSource(sourceId);
  if (!source) throw new Error(`未知站点: ${sourceId}`);
  const url = `${source.api}?${new URLSearchParams({ ac: 'detail', ids: String(vodId) })}`;
  const json = await fetchJson(url);
  const v = (json.list || [])[0];
  if (!v) throw new Error('未找到影片详情');

  const froms = String(v.vod_play_from || '').split('$$$').filter(Boolean);
  const groups = String(v.vod_play_url || '').split('$$$').filter(Boolean);
  const plays = groups.map((group, i) => {
    const episodes = group.split('#')
      .map(seg => {
        const idx = seg.lastIndexOf('$');
        if (idx <= 0) return null;
        return { name: seg.slice(0, idx).trim(), url: seg.slice(idx + 1).trim() };
      })
      .filter(Boolean);
    return { from: froms[i] || `线路${i + 1}`, episodes };
  }).filter(p => p.episodes.length > 0);

  return {
    sourceId,
    sourceName: source.name,
    vodId: String(v.vod_id),
    title: String(v.vod_name || '').trim(),
    year: String(v.vod_year || '').trim(),
    type: (v.type_name || '').trim(),
    remarks: (v.vod_remarks || '').trim(),
    cover: (v.vod_pic || '').trim(),
    actor: (v.vod_actor || '').trim(),
    director: (v.vod_director || '').trim(),
    blurb: (v.vod_blurb || '').trim(),
    plays
  };
}

/**
 * 聚合搜索：并发查询各启用源，按「标准化标题+年份」去重聚合
 * 返回 groups（聚合结果）与 failed（失败源）
 */
export async function aggregateSearch(kw, { include, exclude } = {}) {
  const targets = getSourceList({ include, exclude });
  const settled = await Promise.allSettled(targets.map(s => searchSource(s, kw)));

  const failed = [];
  const byKey = new Map();

  settled.forEach((r, i) => {
    const source = targets[i];
    if (r.status === 'rejected') {
      const reason = r.reason?.name === 'AbortError' ? '超时' : (r.reason?.message || '未知错误');
      failed.push({ id: source.id, name: source.name, error: reason });
      return;
    }
    for (const item of r.value) {
      const key = normalizeTitle(item.title) + '|' + item.year;
      let g = byKey.get(key);
      if (!g) {
        g = {
          key,
          title: item.title,
          year: item.year,
          type: item.type,
          cover: item.cover,
          remarks: item.remarks,
          updatedAt: item.updatedAt,
          sources: []
        };
        byKey.set(key, g);
      }
      if (!g.cover && item.cover) g.cover = item.cover;
      if (item.remarks && !g.remarks) g.remarks = item.remarks;
      // 同一源可能出现多条同名条目（如不同分篇），全部保留
      g.sources.push({
        sourceId: item.sourceId,
        sourceName: item.sourceName,
        vodId: item.vodId,
        remarks: item.remarks,
        sub: item.sub,
        updatedAt: item.updatedAt
      });
    }
  });

  const kwNorm = normalizeTitle(kw);
  const groups = [...byKey.values()].sort((a, b) => {
    const exactA = normalizeTitle(a.title) === kwNorm ? 1 : 0;
    const exactB = normalizeTitle(b.title) === kwNorm ? 1 : 0;
    if (exactA !== exactB) return exactB - exactA;
    if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
    return a.title.localeCompare(b.title, 'zh');
  });

  return { kw, groups, failed };
}

function getSourceList({ include, exclude } = {}) {
  if (include) {
    const set = new Set(include.split(',').map(x => x.trim()).filter(Boolean));
    // include 模式用于定点检测，不受 enabled 限制
    return [...set].map(id => getSource(id)).filter(Boolean);
  }
  let list = listEnabledSources();
  if (exclude) {
    const set = new Set(exclude.split(',').map(x => x.trim()).filter(Boolean));
    list = list.filter(s => !set.has(s.id));
  }
  return list;
}

/** 标题标准化：去空白/全角符号差异/常见后缀干扰，用于跨源去重 */
function normalizeTitle(title) {
  return String(title)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·・:：，,。.!！？?~～]/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '');
}

/**
 * 探测一个 macCMS 接口是否可用（供「站点目录」检测与 AI 新源验证共用）
 * 依次尝试测试关键词，接口返回列表即认为可用。
 */
export async function probeSourceApi(api, testKeywords = ['凡人修仙传', '斗破苍穹']) {
  const started = Date.now();
  let lastInfo = '无结果';
  for (const kw of testKeywords) {
    try {
      const url = `${api}?${new URLSearchParams({ ac: 'videolist', wd: kw })}`;
      const json = await fetchJson(url);
      const list = Array.isArray(json.list) ? json.list : [];
      if (json.code === 1 && list.length > 0 && list[0].vod_name) {
        const exact = list.some(v => (v.vod_name || '').includes(kw));
        return { ok: true, ms: Date.now() - started, info: `${exact ? '命中' : '可用'} · ${list[0].vod_name}` };
      }
      lastInfo = `接口通但无结果(total=${json.total ?? '?'})`;
    } catch (e) {
      lastInfo = e?.name === 'AbortError' ? '超时' : (e.message || '请求失败');
    }
  }
  return { ok: false, ms: Date.now() - started, info: lastInfo };
}
