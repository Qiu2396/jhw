/**
 * 小说模块：聚合「笔趣阁/杰奇模板」文字小说站，支持搜索、目录、正文
 *
 * 每个源一套解析规则（CSS 选择器，格式沿用开源项目 so-novel 的规则体系，见 src/novel-rules.json）。
 * 与视频源不同，小说站是 HTML 页面，因此走「代理解析」：后端抓取并按规则提取数据。
 *
 * GET /api/novel/search?kw=书名或作者   多源搜索（只返回精确命中）
 * GET /api/novel/toc?src=id&url=书页    章节目录
 * GET /api/novel/chapter?src=id&url=章节页  标题 + 正文
 *
 * 安全：url 参数的 host 必须与已收录源一致（防 SSRF）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'novel-rules.json'), 'utf8'));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT_MS = 12000;

function getRule(srcId) {
  return RULES.find(r => r.id === srcId);
}

/** 抓取页面并自动识别 UTF-8/GBK 编码 */
async function fetchPage(url, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const host = new URL(url).host;
    const referer = `${new URL(url).origin}/`;
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Referer: referer,
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

/** 把规则里的 data 模板 "{searchkey: %s}" 展开为表单字段 */
function parseData(tpl, kw, enc) {
  const body = tpl.replace(/^\{|\}$/g, '');
  const enc2 = (s) => {
    if (enc !== 'gbk') return encodeURIComponent(s);
    const buf = iconv.encode(s, 'gbk');
    return [...buf].map(b => '%' + b.toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  const out = {};
  for (const pair of body.split(',')) {
    const [k, v] = pair.split(':').map(x => x && x.trim());
    if (!k) continue;
    out[k] = (v || '').replace(/%s/g, enc2(kw));
  }
  return out;
}

/** 章节正文清洗：去广告标签/广告文案，还原段落 */
function cleanContent($, rule) {
  if (rule.chapter.filterTag) {
    for (const tag of rule.chapter.filterTag.split(',').map(t => t.trim()).filter(Boolean)) {
      $(tag).remove();
    }
  }
  let text = $(rule.chapter.content).html() || '';
  text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '');
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  if (rule.chapter.filterTxt) {
    for (const pat of rule.chapter.filterTxt.split('|')) {
      try { text = text.replace(new RegExp(pat, 'g'), ''); } catch { /* 跳过坏正则 */ }
    }
  }
  return text.split('\n').map(l => l.trim().replace(/^　+/g, '')).filter(Boolean).join('\n');
}

/** 单源搜索（返回精确/模糊命中列表） */
async function searchOneSource(rule, kw) {
  const fields = parseData(rule.search.data || '{}', kw, rule.searchEnc || 'utf8');
  const body = Object.entries(fields).map(([k, v]) => `${k}=${v.replace(/ /g, '+')}`).join('&');
  const isPost = rule.search.method === 'post';
  const url = isPost
    ? rule.search.url
    : `${rule.search.url}${rule.search.url.includes('?') ? '&' : '?'}${body}`;
  const { html, status, finalUrl } = await fetchPage(url, isPost
    ? { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    : {});
  if (status >= 400) return [];
  const $ = cheerio.load(html);
  return $(rule.search.result).toArray().map(el => {
    const nameEl = $(el).find(rule.search.bookName);
    const href = nameEl.attr('href');
    if (!href) return null;
    return {
      sourceId: rule.id,
      sourceName: rule.name,
      bookName: (nameEl.text() || '').trim(),
      author: ($(el).find(rule.search.author).first().text() || '').trim(),
      latestChapter: rule.search.latestChapter ? ($(el).find(rule.search.latestChapter).first().text() || '').trim() : '',
      bookUrl: new URL(href, finalUrl).href
    };
  }).filter(Boolean);
}

/** 多源聚合搜索：只保留书名含关键词的精确命中 */
export async function novelSearch(kw) {
  const word = String(kw || '').trim();
  if (!word) throw new Error('缺少关键词 kw');
  const settled = await Promise.allSettled(RULES.map(r => searchOneSource(r, word)));
  const books = [];
  const failed = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      books.push(...r.value.filter(b => b.bookName.includes(word)));
    } else {
      failed.push(RULES[i].name);
    }
  });
  // 同名同作者跨源聚合
  const map = new Map();
  for (const b of books) {
    const key = b.bookName + '|' + b.author;
    if (!map.has(key)) {
      map.set(key, { key, bookName: b.bookName, author: b.author, latestChapter: b.latestChapter, sources: [] });
    }
    map.get(key).sources.push({ sourceId: b.sourceId, sourceName: b.sourceName, bookUrl: b.bookUrl, latestChapter: b.latestChapter });
  }
  return { kw: word, books: [...map.values()], failed };
}

/** 章节目录 */
export async function novelToc(sourceId, bookUrl) {
  const rule = getRule(sourceId);
  if (!rule) throw new Error('未知小说源');
  const { html, finalUrl } = await fetchPage(bookUrl);
  let $ = cheerio.load(html);
  let base = finalUrl;
  let items = $(rule.toc.item).toArray();
  if (!items.length && rule.book?.latestChapterUrl) {
    // 部分站目录在书页之外（第一章页内），顺着最新章节链接进入再取
    const firstLink = $(rule.book.latestChapterUrl).first().attr('href');
    if (firstLink) {
      const res2 = await fetchPage(new URL(firstLink, finalUrl).href);
      $ = cheerio.load(res2.html);
      base = res2.finalUrl;
      items = $(rule.toc.item).toArray();
    }
  }
  if (!items.length) throw new Error('章节目录解析失败，该源暂不可用');
  const chapters = items.map(el => ({
    name: $(el).text().trim(),
    url: new URL($(el).attr('href'), base).href
  })).filter(c => c.name && c.url);
  return { sourceId, sourceName: rule.name, bookUrl: finalUrl, chapters };
}

/** 章节正文 */
export async function novelChapter(sourceId, chapterUrl) {
  const rule = getRule(sourceId);
  if (!rule) throw new Error('未知小说源');
  const { html } = await fetchPage(chapterUrl);
  const $ = cheerio.load(html);
  const title = ($(rule.chapter.title).first().text() || '').trim();
  const content = cleanContent($, rule);
  if (!content) throw new Error('正文解析失败，该章节可能被反爬保护');
  return { title, content };
}

/** SSRF 校验：目标 URL 必须属于已收录源 */
export function isAllowedNovelUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!/^https?:$/.test(u.protocol)) return false;
    return RULES.some(r => new URL(r.url).host === u.host);
  } catch {
    return false;
  }
}
