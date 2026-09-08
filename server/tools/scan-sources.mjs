/**
 * 源批量扫描工具：npm run scan <候选文件.json> [--kind=video|audio] [--add] [--concurrency=12]
 *
 * 候选文件格式：[{ "name": "可选站名", "api": "https://…/api.php/provide/vod" }, …]
 * 判定：接口返回 code==1 且列表非空、能搜到测试关键词即视为可用；
 *       --add 时可用源写入数据库（origin=ai，kind 由参数指定），已存在的域名自动跳过。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { insertSource, listSources, updateCheckResult } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const kind = (args.find(a => a.startsWith('--kind=')) || '--kind=video').split('=')[1];
const doAdd = args.includes('--add');
const concurrency = parseInt((args.find(a => a.startsWith('--concurrency=')) || '--concurrency=12').split('=')[1]) || 12;

if (!file) {
  console.error('用法: npm run scan <候选.json> [--kind=video] [--add]');
  process.exit(1);
}
const candidates = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const KW = ['凡人修仙传', '斗破苍穹'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';

async function probe(api) {
  const started = Date.now();
  for (const kw of KW) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await fetch(`${api}?${new URLSearchParams({ ac: 'videolist', wd: kw })}`, {
        signal: ctl.signal, headers: { 'User-Agent': UA }
      });
      const buf = Buffer.from(await res.arrayBuffer());
      let text = new TextDecoder('utf-8').decode(buf);
      if (text.includes('\uFFFD')) {
        try { const g = new TextDecoder('gbk').decode(buf); if (!g.includes('\uFFFD')) text = g; } catch { /* ignore */ }
      }
      const json = JSON.parse(text.slice(text.indexOf('{')));
      const list = json.list || [];
      if (json.code === 1 && list.length > 0 && list[0].vod_name) {
        const exact = list.some(v => (v.vod_name || '').includes(kw));
        return { ok: true, ms: Date.now() - started, info: `${exact ? '命中' : '可用'} · ${list[0].vod_name}`, sample: list[0] };
      }
    } catch (e) {
      if (kw === KW[KW.length - 1]) return { ok: false, ms: Date.now() - started, info: e.name === 'AbortError' ? '超时' : (e.message || '失败') };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, ms: Date.now() - started, info: '接口通但无结果' };
}

console.log(`扫描 ${candidates.length} 个候选 (kind=${kind}, 并发=${concurrency})...\n`);
const results = [];
let idx = 0;
async function worker() {
  while (idx < candidates.length) {
    const c = candidates[idx++];
    const r = await probe(c.api);
    results.push({ ...c, ...r });
    const tag = r.ok ? '✔' : '✘';
    console.log(`${tag} [${idx}/${candidates.length}] ${c.api}  ${r.ok ? `${r.ms}ms ${r.info}` : r.info}`);
  }
}
const started = Date.now();
await Promise.all(Array.from({ length: concurrency }, worker));
console.log(`\n扫描完成 ${(Date.now() - started) / 1000}s：可用 ${results.filter(r => r.ok).length} / ${results.length}`);

// 输出结果文件
const outFile = path.join(__dirname, '../../.tmp', `scan-result-${kind}.json`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
console.log('结果已写入', outFile);

if (doAdd) {
  const existing = new Set(listSources().map(s => s.api.replace(/^https?:/, '').replace(/\/+$/, '')));
  let added = 0;
  for (const r of results.filter(x => x.ok)) {
    const key = r.api.replace(/^https?:/, '').replace(/\/+$/, '');
    if (existing.has(key)) continue;
    existing.add(key);
    const host = new URL(r.api).hostname.replace(/^www\./, '');
    const name = r.name || `${host.split('.')[0]}资源`;
    const id = host.replace(/[^a-z0-9]/g, '').slice(0, 18) || `scan${++added}`;
    let finalId = id, i = 2;
    while (listSources().some(s => s.id === finalId)) finalId = `${id}${i++}`;
    const row = insertSource({
      id: finalId, name, api: r.api, web: new URL(r.api).origin,
      tags: ['扫描收录'], enabled: true, note: `批量扫描自动收录（${r.info}）`, origin: 'ai'
    });
    updateCheckResult(finalId, { status: 'ok', ms: r.ms, info: r.info });
    console.log(`  + 入库 ${row.id} ${row.name}`);
    added++;
  }
  console.log(`共入库 ${added} 个新源`);
}
