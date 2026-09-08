/**
 * 小说源深度探测：搜索 → 章节目录 → 正文
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import * as cheerio from 'cheerio';

const rules = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../.tmp/sonovel-main.json'), 'utf8'));
const TARGETS = [process.argv[2] || '鸟书网'];
const KW = process.argv[3] || '斗破苍穹';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchPage(url, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ctl.signal, redirect: 'follow',
      headers: { 'User-Agent': UA, Referer: new URL(url).origin + '/', ...(opts.headers || {}) },
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

function parseData(tpl, kw, enc) {
  const body = tpl.replace(/^\{|\}$/g, '');
  const enc2 = (s) => {
    if (enc !== 'gbk') return encodeURIComponent(s);
    const buf = Buffer.from(s, 'gbk');
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

function cleanContent($, rule, html) {
  const filterTags = rule.chapter.filterTag;
  if (filterTags) {
    for (const tag of filterTags.split(',').map(t => t.trim()).filter(Boolean)) {
      $(tag).remove();
    }
  }
  let text = $(rule.chapter.content).html() || '';
  // 段落还原
  if (rule.chapter.paragraphTag === '<br>+' || /<br/i.test(text)) {
    text = text.replace(/<br\s*\/?>/gi, '\n');
  }
  text = text.replace(/<[^>]+>/g, '');
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  if (rule.chapter.filterTxt) {
    for (const pat of rule.chapter.filterTxt.split('|')) {
      try { text = text.replace(new RegExp(pat, 'g'), ''); } catch { /* 跳过坏正则 */ }
    }
  }
  return text.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

for (const name of TARGETS) {
  const rule = rules.find(r => r.name === name);
  if (!rule) { console.log(`✘ ${name}: 无规则`); continue; }
  console.log(`\n===== ${name} =====`);
  try {
    // ① 搜索
    const fields = parseData(rule.search.data || '{}', KW, 'utf8');
    const body = Object.entries(fields).map(([k, v]) => `${k}=${v.replace(/ /g, '+')}`).join('&');
    const isPost = rule.search.method === 'post';
    const { html, finalUrl } = await fetchPage(isPost ? rule.search.url : `${rule.search.url}${rule.search.url.includes('?') ? '&' : '?'}${body}`,
      isPost ? { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } : {});
    const $ = cheerio.load(html);
    const row = $(rule.search.result).toArray().find(el => $(el).find(rule.search.bookName).text().includes(KW));
    if (!row) { console.log('  ✘ 搜索无精确命中'); continue; }
    let bookUrl = $(row).find(rule.search.bookName).attr('href');
    bookUrl = new URL(bookUrl, finalUrl).href;
    const bookName = $(row).find(rule.search.bookName).text().trim();
    console.log(`  ① 书: 《${bookName}》 ${bookUrl}`);

    // ② 书页 → 章节目录（可能目录在书页，也可能在第一章节页内）
    const bookRes = await fetchPage(bookUrl);
    let $b = cheerio.load(bookRes.html);
    let tocBase = bookRes.finalUrl;
    let items = $b(rule.toc.item).toArray();
    if (!items.length) {
      // 目录可能在第一个章节链接的页面里
      const firstLink = $b('a').filter((_, el) => /第一章|第1章/.test($(el).text())).first().attr('href')
        || $b(rule.book?.latestChapterUrl || rule.book.latestChapter).attr('href');
      if (firstLink) {
        const chRes = await fetchPage(new URL(firstLink, bookRes.finalUrl).href);
        $b = cheerio.load(chRes.html);
        tocBase = chRes.finalUrl;
        items = $b(rule.toc.item).toArray();
      }
    }
    if (!items.length) { console.log('  ✘ 章节目录解析失败'); continue; }
    const chapters = items.map(el => ({
      name: $(el).text().trim(),
      url: new URL($(el).attr('href'), tocBase).href
    }));
    console.log(`  ② 目录: ${chapters.length} 章, 首章=[${chapters[0].name}] 末章=[${chapters[chapters.length - 1].name}]`);

    // ③ 第一章正文
    const chRes = await fetchPage(chapters[0].url);
    const $c = cheerio.load(chRes.html);
    const title = ($c(rule.chapter.title).first().text() || '').trim();
    const content = cleanContent($c, rule, chRes.html);
    const chars = content.replace(/\n/g, '').length;
    console.log(`  ③ 正文: 标题=[${title}] ${chars} 字`);
    console.log(`     开头: ${content.split('\n').slice(0, 2).join(' / ').slice(0, 60)}`);
  } catch (e) {
    console.log(`  ✘ 失败: ${e.name === 'AbortError' ? '超时' : e.message?.slice(0, 60)}`);
  }
}
