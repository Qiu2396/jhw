/**
 * 全文资源搜索：聚合多个公开的资源索引实例，一次输入返回合并去重结果
 *
 * 结果统一归一化为：{ name, panType, url, password, from }
 * 聚合策略：各实例并发查询、按链接归一化去重；关键词命中的排前面。
 *
 * 接入的公开实例（2026-09 实测可用）：
 *  - PanSou 官方演示 so.252035.xyz：聚合最强（10+ 网盘类型/磁力），CDN 偶发抖动需重试
 *  - 泽索搜 zreso.cn：最稳定；链接为 /api/wash?t=uuid 需二次解析真实地址
 *  - 谷哥搜 gugeso.com：SSE 流 + 链接批量解密（夸克补充源）
 *
 * GET /api/resource/search?kw=关键词
 * 说明：本模块只做公开索引的聚合转发与格式归一，不存储任何资源。
 */
import express from 'express';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map();                 // kw → { at, data }

const router = express.Router();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchText(url, { timeoutMs = 12000, headers = {} } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, opts) {
  return JSON.parse(await fetchText(url, opts));
}

const PAN_TYPE = {
  quark: '夸克', baidu: '百度', aliyun: '阿里', ali: '阿里', '115': '115', '123': '123盘',
  xunlei: '迅雷', tianyi: '天翼', uc: 'UC', mobile: '移动', guangya: '光大', magnet: '磁力',
  ed2k: '电驴', pikpak: 'PikPak'
};

/** 去重键：host+path 归一（去提取码参数、阿里系双域视为同域） */
function urlKey(u) {
  try {
    const x = new URL(u);
    const host = x.host.replace(/aliyundrive\.com$/, 'alipan.com');
    return host + x.pathname.replace(/\/+$/, '');
  } catch {
    return u;
  }
}

/* ---------------- 实例 1：PanSou（so.252035.xyz） ---------------- */

async function pansouSearch(kw) {
  const url = `https://so.252035.xyz/api/search?kw=${encodeURIComponent(kw)}`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const j = JSON.parse(await fetchText(url, { timeoutMs: 15000 }));
      const merged = j?.data?.merged_by_type || {};
      const out = [];
      for (const [type, list] of Object.entries(merged)) {
        for (const it of list || []) {
          if (!it?.url) continue;
          out.push({
            name: String(it.note || it.url).trim(),
            url: it.url,
            password: it.password || '',
            panType: PAN_TYPE[type] || type,
            from: 'PanSou'
          });
        }
      }
      return out.slice(0, 60);
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(1000 + attempt * 500);   // CDN 偶发抖动，重试 1-2 次
    }
  }
  throw lastErr;
}

/* ---------------- 实例 2：泽索搜（zreso.cn） ---------------- */

async function zresoSearch(kw) {
  const j = JSON.parse(await fetchText(
    `https://zreso.cn/api/search?q=${encodeURIComponent(kw)}&sort=latest`, { timeoutMs: 12000 }
  ));
  const list = (j?.data?.results || []).slice(0, 30);
  // 并发解析混淆链接（/api/wash?t=uuid → 真实地址）
  const resolved = await Promise.allSettled(list.map(async r => {
    const link = (r.links || [])[0];
    if (!link?.url) return null;
    let url = link.url;
    if (url.startsWith('/api/wash')) {
      const w = JSON.parse(await fetchText(`https://zreso.cn${url}`, { timeoutMs: 8000 }));
      if (!w?.raw_url) return null;
      url = w.raw_url;
    }
    return {
      name: String(r.title || '').trim(),
      url,
      password: link.password || '',
      panType: r.cloud_type_name || PAN_TYPE[link.type] || link.type || '链接',
      from: '泽索搜'
    };
  }));
  return resolved.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
}

/* ---------------- 实例 3：谷哥搜（gugeso.com） ---------------- */

async function gugesoSearch(kw) {
  const text = await fetchText(
    `https://gugeso.com/api/other/web_search?title=${encodeURIComponent(kw)}`,
    { timeoutMs: 12000, headers: { Referer: 'https://gugeso.com/' } }
  );
  const items = [];
  for (const line of text.split('\n')) {
    const mm = line.match(/^data:\s*(\{.*\})\s*$/);
    if (mm) { try { items.push(JSON.parse(mm[1])); } catch { /* ignore */ } }
  }
  const enc = items.map(i => i.url).filter(Boolean).slice(0, 10);
  if (!enc.length) return [];
  const dr = await fetch('https://gugeso.com/api/other/decrypt_urls', {
    method: 'POST',
    headers: { 'User-Agent': UA, Referer: 'https://gugeso.com/', 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls: enc })
  });
  if (!dr.ok) return [];
  const dj = await dr.json();
  const urls = dj?.data?.urls || [];
  return items
    .map(it => ({ name: String(it.title || '').trim(), url: '', password: '', panType: '夸克', from: '谷哥搜' }))
    .map((it, i) => ({ ...it, url: urls[i] || '' }))
    .filter(it => it.url && it.name);
}

/* ---------------- 实例注册与聚合 ---------------- */

const INSTANCES = [
  { name: 'PanSou', search: pansouSearch },
  { name: '泽索搜', search: withRetry(zresoSearch) },
  { name: '谷哥搜', search: withRetry(gugesoSearch) }
];

/** 偶发超时兜底：整体重试一次（PanSou 自带重试不叠加） */
function withRetry(fn) {
  return async (kw) => {
    try { return await fn(kw); }
    catch (e) { await sleep(800); return fn(kw); }
  };
}

export async function resourceSearch(kw) {
  const word = String(kw || '').trim();
  if (!word) throw new Error('缺少关键词 kw');
  if (word.length > 60) throw new Error('关键词过长');

  const hit = cache.get(word);
  if (hit && Date.now() - hit.at < CACHE_TTL) return { ...hit.data, cached: true };

  const settled = await Promise.allSettled(INSTANCES.map(ins => ins.search(word)));
  const failed = [];
  const seen = new Set();
  let results = [];
  settled.forEach((r, i) => {
    if (r.status !== 'fulfilled') { failed.push(INSTANCES[i].name); return; }
    for (const item of r.value) {
      const key = urlKey(item.url);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(item);
    }
  });
  // 名称命中关键词的排前面
  const wl = word.toLowerCase();
  results.sort((a, b) => (a.name.toLowerCase().includes(wl) ? 0 : 1) - (b.name.toLowerCase().includes(wl) ? 0 : 1));

  const data = { kw: word, results, failed, sources: INSTANCES.length };
  cache.set(word, { at: Date.now(), data });
  return data;
}

export default router;
