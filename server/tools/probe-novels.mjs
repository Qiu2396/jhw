/**
 * 小说源探测：按 so-novel 规则实测搜索链路
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

const rules = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../.tmp/sonovel-main.json'), 'utf8'));
const KWS = ['龙族', '胜算'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchPage(url, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
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
  // data 形如 "{searchkey: %s}" 或 "{searchkey: %s, searchtype: all}"
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

async function probe(rule) {
  let best = null;
  const t0 = Date.now();
  try {
    const encVariants = ['utf8', 'gbk'];
    for (const enc of encVariants) {
      const kw = KWS[0];
      // 字段值已按 enc 编码为 %XX，不能再用 URLSearchParams（会把 % 二次编码）
      const fields = parseData(rule.search.data || '{}', kw, enc);
      const body = Object.entries(fields).map(([k, v]) => `${k}=${v.replace(/ /g, '+')}`).join('&');
      const url = rule.search.url;
      const opts = rule.search.method === 'post'
        ? { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        : { headers: {} };
      const get = rule.search.method === 'post' ? url : `${url}${url.includes('?') ? '&' : '?'}${body}`;
      const { html, status } = await fetchPage(get, opts);
      if (status >= 400) continue;
      const $ = cheerio.load(html);
      const rows = $(rule.search.result);
      if (rows.length > 0) {
        const first = rows.first();
        const name = (first.find(rule.search.bookName).text() || '').trim();
        const author = (first.find(rule.search.author).text() || '').trim();
        const link = first.find(rule.search.bookName).attr('href');
        if (name && link) {
          const names = rows.slice(0, 3).map((_, el) => $(el).find(rule.search.bookName).text().trim()).get().join(' | ');
          const exact = rows.toArray().some(el => KWS.some(k => $(el).find(rule.search.bookName).text().includes(k)));
          return { ok: true, ms: Date.now() - t0, enc, found: `${name} / ${author}`, names, exact, link };
        }
      }
    }
    return { ok: false, ms: Date.now() - t0, info: '搜索无结果或结构不匹配' };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, info: e.name === 'AbortError' ? '超时' : e.message?.slice(0, 50) };
  }
}

for (const rule of rules) {
  const r = await probe(rule);
  const mark = r.ok ? (r.exact ? '✔精' : '·模') : '✘';
  console.log(`${mark} ${rule.name}  ${r.ok ? `${r.ms}ms enc=${r.enc} [${r.names}]` : r.info}`);
}
