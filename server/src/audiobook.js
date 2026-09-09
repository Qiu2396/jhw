/**
 * 听书模块：聚合第三方真人有声小说站，支持搜索、章节列表、播放地址解析
 *
 * 与小说模块同一思路：第三方听书站是 HTML/动态页面，后端代理解析（规则内聚在本文件
 * 每个源的 parse 函数里），前端拿结构化数据直接入队播放。
 *
 * GET /api/audiobook/search?kw=       多源聚合搜索（返回书名/主播/封面/简介/来源）
 * GET /api/audiobook/book?src=&url=   章节列表（自动聚合分页，斗破级 1200+ 章一次取全）
 * GET /api/audiobook/play?src=&url=   单集真实音频地址（mp3/m4a 直链）
 *
 * 安全：url 参数的 host 必须与已收录源一致（防 SSRF）。
 */
import * as cheerio from 'cheerio';
import crypto from 'node:crypto';
import { isDisabled } from './channel-sources.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT_MS = 12000;
const CHAPTERS_PER_PAGE = 200;          // 悦听吧每页章节固定 200

/** 抓取页面（utf-8；站内已知无 GBK 页面，保留转码探测兜底） */
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
      }
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

/* ---------------- 源：悦听吧 ---------------- */

const yuetingba = {
  id: 'yuetingba',
  name: '悦听吧',
  base: 'http://www.yuetingba.cn',

  async search(kw) {
    if (isDisabled('audiobook', this.id)) return [];
    const { html, status } = await fetchPage(`${this.base}/Search?name=${encodeURIComponent(kw)}`);
    if (status >= 400) return [];
    const $ = cheerio.load(html);
    return $('.section-box-list-item').toArray().map(el => {
      const $el = $(el);
      const titleA = $el.find('.box-list-item-text-title a').first();
      const href = titleA.attr('href');
      if (!href) return null;
      const spans = $el.find('.box-list-item-text-autspeaker span[title]').toArray();
      return {
        sourceId: this.id,
        sourceName: this.name,
        bookName: (titleA.text() || '').trim(),
        author: spans.length ? $(spans[0]).attr('title').trim() : '',
        broadcaster: spans.length > 1 ? $(spans[1]).attr('title').trim() : '',
        intro: ($el.find('.box-list-item-text-intro').text() || '').trim(),
        cover: abs($el.find('.box-list-item-img img').first().attr('src'), this.base),
        bookUrl: new URL(href, this.base).href
      };
    }).filter(b => b && b.bookName);
  },

  /** 章节列表：第 0 页带出全部分页，并发取余下页后按 offset 拼接（10 分钟缓存，连载书可接受） */
  async book(bookUrl) {
    const hit = bookCache.get(bookUrl);
    if (hit && Date.now() - hit.at < BOOK_TTL) return hit.data;
    const first = await this.bookPage(bookUrl);
    if (!first.chapters.length) throw new Error('章节列表解析失败，该源暂不可用');
    let chapters = first.chapters;
    if (first.moreOffsets.length) {
      const pages = await Promise.allSettled(
        first.moreOffsets.map(off => this.bookPage(`${this.base}/book/detail/${first.bookId}/${off}`, true))
      );
      const extra = pages
        .filter(p => p.status === 'fulfilled')
        .sort((a, b) => a.value.offset - b.value.offset)
        .flatMap(p => p.value.chapters);
      chapters = chapters.concat(extra);
    }
    // 按页内顺序去重
    const seen = new Set();
    chapters = chapters.filter(c => !seen.has(c.url) && seen.add(c.url));
    const data = { ...first.meta, chapters };
    bookCache.set(bookUrl, { at: Date.now(), data });
    return data;
  },

  /** 抓一页章节；withMeta=false 时不重复解析书籍信息
   *  注：该站章节锚点是注释形式下发的（<!--<a title=".." href="/book/ting/{id}">-->），
   *  cheerio 拿不到，直接正则提取 id + 标题 */
  async bookPage(bookUrl, withMeta = false) {
    const { html } = await fetchPage(bookUrl);
    const $ = cheerio.load(html);
    const chapters = [];
    const seen = new Set();
    const re = /<a\s+title="([^"]+)"[^>]*href="(\/book\/ting\/[0-9a-f-]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      const url = new URL(m[2], bookUrl).href;
      if (seen.has(url)) continue;
      seen.add(url);
      chapters.push({ name: m[1].trim(), url });
    }
    const bookId = new URL(bookUrl).pathname.split('/')[3];
    // 分页链接同样是注释下发，正则提取同书其它页的 offset（每页 200 章）
    const moreOffsets = withMeta ? [] : [...new Set(
      [...html.matchAll(new RegExp(`href="(/book/detail/${bookId}/(\\d+))"`, 'g'))]
        .map(m => parseInt(m[2], 10))
        .filter(n => Number.isInteger(n) && n > 0)
    )];
    const meta = withMeta ? {} : {
      bookName: ($('.book-detail-title').first().text() || '').trim() || undefined,
      cover: abs($('.books-detail-img img').first().attr('src'), this.base) || undefined
    };
    return { offset: parseInt(new URL(bookUrl).pathname.split('/').pop(), 10) || 0, bookId, chapters, moreOffsets, meta };
  },

  /** 单集播放地址（章节页 /book/ting/{id} → 音频直链） */
  async play(chapterUrl) {
    return resolveYuetingbaAudio(chapterUrl);
  }
};

function abs(src, base) {
  if (!src) return '';
  try { return new URL(src, base).href; } catch { return ''; }
}

/**
 * 音频地址解析（链路逆向自站点 uni-app 播放器）：
 *  1. GET /api/app/docs-listen/{章节id}/ting-with-efi → { efi 密文, creationTime, bookId }
 *     （该接口限速 ~20 次/5 分钟/IP，故结果永久缓存 + 串行调用）
 *  2. efi 为 AES-256-CBC 密文，key/iv 由章节 id + creationTime 派生，解密得音频相对路径
 *  3. 书籍详情页内嵌 assl 服务器列表（AES-128-CBC，固定 key/iv）→ 选音频服务器
 *  4. 按服务器类型拼路径，MD5 token（10 分钟时效）→ 播放直链
 */
const SK = 'xMiP5W1DHBxC5PwQ5oj5QfRn0tsT5UBk';                     // token 签名盐
const AS_KEY = Buffer.from('le95G3hnFDJsBE+1/v9eYw==', 'base64');  // assl 解密 key
const AS_IV = Buffer.from('IvswQFEUdKYf+d1wKpYLTg==', 'base64');   // assl 解密 iv
const ASSL_TTL = 30 * 60 * 1000;
const BOOK_TTL = 10 * 60 * 1000;
const pathCache = new Map();      // 章节id → { relPath, bookId }（路径稳定，永久缓存）
const asslCache = new Map();      // 书id → { at, py, servers }（服务器会迁移，短期缓存）
const bookCache = new Map();      // 书页url → { at, data }（章节列表短期缓存，继续听免重抓）
let apiChain = Promise.resolve(); // 限速接口串行化

function asDecrypt(b64) {
  const d = crypto.createDecipheriv('aes-128-cbc', AS_KEY, AS_IV);
  return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
}

// key/iv 派生：t=章节id 去横线 32 位，c=creationTime 压缩 20 位
function deriveKey(t, c) {
  let o = '';
  for (let i = 0; i < 20; i++) o += String.fromCharCode(t.charCodeAt(i) + Number(c[i]));
  for (let i = 20; i < t.length; i++) o += String.fromCharCode(t.charCodeAt(i) + Number(c[i - 20]));
  return o;
}
function deriveIv(t, c) {
  let o = '';
  for (let i = 20; i > 4; i--) o += String.fromCharCode(t.charCodeAt(i) + Number(c[i - 1]));
  return o;
}
function decryptEfi(efiB64, tingId32, created20) {
  const d = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(deriveKey(tingId32, created20), 'binary'),
    Buffer.from(deriveIv(tingId32, created20), 'binary')
  );
  return Buffer.concat([d.update(Buffer.from(efiB64, 'base64')), d.final()]).toString('utf8');
}

async function getServerInfo(bookId) {
  const hit = asslCache.get(bookId);
  if (hit && Date.now() - hit.at < ASSL_TTL) return hit;
  const { html } = await fetchPage(`${yuetingba.base}/book/detail/${bookId}/0`);
  const py = (html.match(/var py ?='([^']+)'/) || [])[1];
  const blob = (html.match(/var assl = '([^']+)'/) || [])[1];
  if (!py || !blob) throw new Error('音频服务器配置解析失败');
  const info = { at: Date.now(), py, servers: JSON.parse(asDecrypt(blob.replace(SK, ''))) };
  asslCache.set(bookId, info);
  return info;
}

async function resolveChapterFile(chapterId) {
  const hit = pathCache.get(chapterId);
  if (hit) return hit;
  const info = await new Promise((resolve, reject) => {
    apiChain = apiChain.then(async () => {
      try {
        const res = await fetch(`${yuetingba.base}/api/app/docs-listen/${chapterId}/ting-with-efi`, {
          headers: { 'User-Agent': UA }
        });
        if (!res.ok) throw new Error('音频信息接口不可用');
        resolve(await res.json());
      } catch (e) { reject(e); }
    }, () => {});
  });
  const t32 = chapterId.split('-').join('');
  const c20 = String(info.creationTime).replace(/[-:.T ]/g, '').padEnd(20, '0');
  const entry = { relPath: decryptEfi(info.efi, t32, c20), bookId: info.bookId };
  pathCache.set(chapterId, entry);
  return entry;
}

async function resolveYuetingbaAudio(chapterUrl) {
  const chapterId = new URL(chapterUrl).pathname.split('/').pop();
  const { relPath, bookId } = await resolveChapterFile(chapterId);
  const { py, servers } = await getServerInfo(bookId);

  // 选服：专属服务器优先，否则公共池（IPv4）
  let cands = servers.filter(e => e.AsType == '1' && e.Type == 'A');
  const seg = bookId.split('-')[4];
  const ded = cands.filter(e => e.BookIds && String(e.BookIds).indexOf(seg) >= 0);
  if (ded.length) cands = ded;
  else cands = cands.filter(e => e.Ratio > 0 && (e.BookIds == null || String(e.BookIds).trim() === ''));
  const srv = cands[0];
  if (!srv) throw new Error('无可用音频服务器');

  const filename = decodeURIComponent(relPath.split('/').pop());
  let path;
  if (srv.Name.endsWith('_p')) path = `/${py}_${bookId}/${filename}`;
  else if (srv.Name.endsWith('_b')) path = `/myfiles/host/listen/booksdir/${py}_${bookId}/${filename}`;
  else path = relPath;

  const expire = Math.floor(Date.now() / 1000) + 600;
  const token = crypto.createHash('md5').update(`${filename}|${expire}|${SK}`, 'binary').digest('hex');
  return { url: `${srv.Scheme}://${srv.Value}:${srv.Port}${encodeURI(path)}?token=${token}&expire=${expire}` };
}

/* ---------------- 对外 API（多源聚合预留，当前收录悦听吧） ---------------- */

const SOURCES = { yuetingba };

function getSource(id) { return SOURCES[id]; }

export async function audiobookSearch(kw) {
  const word = String(kw || '').trim();
  if (!word) throw new Error('缺少关键词 kw');
  const enabled = Object.values(SOURCES).filter(s => !isDisabled('audiobook', s.id));
  const settled = await Promise.allSettled(enabled.map(s => s.search(word)));
  const books = [];
  const failed = [];
  settled.forEach((r, i) => {
    const src = enabled[i];
    if (r.status === 'fulfilled') books.push(...r.value);
    else failed.push(src.name);
  });
  // 同书同主播跨源聚合（为后续新源预留）
  const map = new Map();
  for (const b of books) {
    const key = `${b.bookName}|${b.broadcaster || b.author || ''}`;
    if (!map.has(key)) {
      map.set(key, { key, bookName: b.bookName, author: b.author, broadcaster: b.broadcaster, intro: b.intro, cover: b.cover, sources: [] });
    }
    map.get(key).sources.push({ sourceId: b.sourceId, sourceName: b.sourceName, bookUrl: b.bookUrl });
  }
  return { kw: word, books: [...map.values()], failed };
}

export async function audiobookBook(sourceId, bookUrl) {
  const src = getSource(sourceId);
  if (!src) throw new Error('未知听书源');
  if (isDisabled('audiobook', sourceId)) throw new Error('该源已停用（站点目录可重新启用）');
  return src.book(bookUrl);
}

export async function audiobookPlay(sourceId, chapterUrl) {
  const src = getSource(sourceId);
  if (!src) throw new Error('未知听书源');
  if (isDisabled('audiobook', sourceId)) throw new Error('该源已停用（站点目录可重新启用）');
  return src.play(chapterUrl);
}

/** 单源探测（站点目录「检测」用） */
export async function checkAudiobookSource(id) {
  const src = getSource(id);
  if (!src) return { ok: false, info: '未知源' };
  try {
    const books = await src.search('斗破苍穹');
    const hit = books.filter(b => (b.bookName || '').includes('斗破'));
    return { ok: hit.length > 0, info: hit.length ? `命中 · ${hit[0].bookName}` : `可用但无命中(${books.length})` };
  } catch (e) {
    return { ok: false, info: e?.name === 'AbortError' ? '超时' : (e.message || '请求失败') };
  }
}

/** SSRF 校验：目标 URL 必须属于已收录源 */
export function isAllowedAudiobookUrl(rawUrl) {
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
