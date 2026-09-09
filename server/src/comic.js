/**
 * 漫画模块：聚合第三方在线漫画站，支持搜索、章节列表、话图片地址解析
 *
 * 与小说/听书模块同一思路：第三方漫画站是 HTML/动态页面，后端代理解析
 * （源规则内聚在本文件每个源的 parse 函数里），前端拿结构化数据直接渲染。
 *
 * GET /api/comic/search?kw=        多源聚合搜索（返回书名/作者/封面/状态/来源）
 * GET /api/comic/book?src=&url=    章节列表（话）
 * GET /api/comic/images?src=&url=  某话的图片直链列表（按顺序）
 *
 * 安全：url 参数的 host 必须与已收录源一致（防 SSRF）。
 */
import * as cheerio from 'cheerio';
import { isDisabled } from './channel-sources.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT_MS = 12000;
const BOOK_TTL = 10 * 60 * 1000;      // 章节列表缓存
const CHAP_TTL = 30 * 60 * 1000;      // 话图片列表缓存（图片地址带时效时应短于此）
const bookCache = new Map();          // 书页url → { at, data }
const chapCache = new Map();          // 话页url → { at, data }

async function fetchPage(url, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Referer: `${new URL(url).origin}/`,
        Accept: 'text/html,application/xhtml+xml',
        ...(opts.headers || {})
      },
      ...(opts.method === 'POST' ? { method: 'POST', body: opts.body } : {})
    });
    const buf = Buffer.from(await res.arrayBuffer());
    let html = new TextDecoder('utf-8').decode(buf);
    if ((html.match(/\uFFFD/g) || []).length > 10) {
      try {
        const gbk = new TextDecoder('gbk').decode(buf);
        if ((gbk.match(/\uFFFD/g) || []).length < (html.match(/\uFFFD/g) || []).length) html = gbk;
      } catch { /* ignore */ }
    }
    return { status: res.status, html, finalUrl: res.url };
  } finally {
    clearTimeout(timer);
  }
}

function abs(src, base) {
  if (!src) return '';
  try { return new URL(src, base).href; } catch { return ''; }
}

async function cached(map, url, ttl, loader) {
  const hit = map.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const data = await loader();
  map.set(url, { at: Date.now(), data });
  return data;
}

/* ---------------- 源：W漫画（书库含斗破/凡人等主流国漫，图片无防盗链） ---------------- */

const wmanhua = {
  id: 'wmanhua',
  name: 'W漫画',
  base: 'https://www.wmanhua.com',

  async search(kw) {
    if (isDisabled('comic', this.id)) return [];
    const { html, status } = await fetchPage(`${this.base}/search?query=${encodeURIComponent(kw)}`);
    if (status >= 400) return [];
    const $ = cheerio.load(html);
    return $('.card-content').toArray().map(el => {
      const a = $(el).find('a[href^="/comic/"]').first();
      const img = $(el).find('img.lazy').first();
      const name = ($(el).find('h3.cardtitle').text() || img.attr('alt') || '').trim();
      const href = a.attr('href');
      if (!href || !name) return null;
      return {
        sourceId: this.id,
        sourceName: this.name,
        name,
        author: '',
        status: '',
        intro: '',
        cover: abs(img.attr('data-src') || img.attr('src'), this.base),
        bookUrl: new URL(href, this.base).href
      };
    }).filter(Boolean);
  },

  /** 书籍页只有最新 24 话预览；全量章节走 POST /comic/{contentId}（最新在前，需反转） */
  async book(bookUrl) {
    const { html } = await fetchPage(bookUrl);
    const $ = cheerio.load(html);
    const contentId = (html.match(/contentId\s*=\s*['"]?(\d+)/) || [])[1];
    if (!contentId) throw new Error('章节列表接口定位失败，该源暂不可用');

    const name = ($('h1').first().text() || '').trim() || undefined;
    const author = ($('.author').first().text() || '').replace(/作者[：:]\s*/, '').trim() || undefined;
    const status = ($('.status').first().text() || '').replace(/状态[：:]\s*/, '').trim() || undefined;
    const desc = $('meta[name="description"]').attr('content') || '';
    const pi = desc.indexOf('简介：');
    const intro = pi >= 0 ? desc.slice(pi + 3).trim() : '';
    const cover = abs($('img[data-src^="http"]').first().attr('data-src'), this.base) || undefined;

    const res = await fetch(`${this.base}/comic/${contentId}`, {
      method: 'POST',
      headers: { 'User-Agent': UA, Referer: `${this.base}/`, 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!res.ok) throw new Error('章节列表接口不可用');
    const j = await res.json();
    const list = j?.data?.chapters || [];
    if (!list.length) throw new Error('章节列表解析失败，该源暂不可用');
    const chapters = [...list].reverse().map(c => ({
      name: String(c.chapterName || '').trim(),
      url: `${this.base}/chapter/${contentId}-${c.id}.html`
    })).filter(c => c.name);
    return { name, author, status, intro, cover, chapters };
  },

  /** 章节页是明文内联 JS：var num=eval("N"); var pasd="https://imageN.../{guid}/"，图片为 pasd+i.webp */
  async images(chapterUrl) {
    const { html } = await fetchPage(chapterUrl);
    const num = parseInt((html.match(/var num\s*=\s*eval\("(\d+)"\)/) || [])[1], 10);
    const pasd = (html.match(/var pasd\s*=\s*"([^"]+)"/) || [])[1];
    if (!num || !pasd) throw new Error('本话图片解析失败');
    const images = Array.from({ length: num }, (_, i) => `${pasd}${i + 1}.webp`);
    return { images };
  }
};

/* ---------------- 源注册（多源预留） ---------------- */

const SOURCES = {
  wmanhua
};

function getSource(id) { return SOURCES[id]; }

/* ---------------- 对外 API ---------------- */

export async function comicSearch(kw) {
  const word = String(kw || '').trim();
  if (!word) throw new Error('缺少关键词 kw');
  const list = Object.values(SOURCES).filter(s => !isDisabled('comic', s.id));
  if (!list.length) throw new Error('暂无可用漫画源');
  const settled = await Promise.allSettled(list.map(s => s.search(word)));
  const comics = [];
  const failed = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') comics.push(...r.value);
    else failed.push(list[i].name);
  });
  // 同名同作者跨源聚合（为后续新源预留）
  const map = new Map();
  for (const c of comics) {
    const key = `${c.name}|${c.author || ''}`;
    if (!map.has(key)) {
      map.set(key, { key, name: c.name, author: c.author, status: c.status, latest: c.latest, intro: c.intro, cover: c.cover, sources: [] });
    }
    map.get(key).sources.push({ sourceId: c.sourceId, sourceName: c.sourceName, bookUrl: c.bookUrl });
  }
  return { kw: word, comics: [...map.values()], failed };
}

export async function comicBook(sourceId, bookUrl) {
  const src = getSource(sourceId);
  if (!src) throw new Error('未知漫画源');
  if (isDisabled('comic', sourceId)) throw new Error('该源已停用（站点目录可重新启用）');
  return cached(bookCache, bookUrl, BOOK_TTL, () => src.book(bookUrl));
}

export async function comicImages(sourceId, chapterUrl) {
  const src = getSource(sourceId);
  if (!src) throw new Error('未知漫画源');
  if (isDisabled('comic', sourceId)) throw new Error('该源已停用（站点目录可重新启用）');
  return cached(chapCache, chapterUrl, CHAP_TTL, () => src.images(chapterUrl));
}

/** 单源探测（站点目录「检测」用） */
export async function checkComicSource(id) {
  const src = getSource(id);
  if (!src) return { ok: false, info: '未知源' };
  try {
    const comics = await src.search('斗破苍穹');
    return { ok: comics.length > 0, info: comics.length ? `命中 · ${comics[0].name}` : '无结果' };
  } catch (e) {
    return { ok: false, info: e?.name === 'AbortError' ? '超时' : (e.message || '请求失败') };
  }
}

/** SSRF 校验：目标 URL 必须属于已收录源 */
export function isAllowedComicUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!/^https?:$/.test(u.protocol)) return false;
    return Object.values(SOURCES).some(s => {
      try { return new URL(s.base).host === u.host; } catch { return false; }
    });
  } catch {
    return false;
  }
}
