/**
 * 候选视频源批量探测：对一批 macCMS 接口候选做真实搜索验证，
 * 可用的输出为 SEED_SOURCES 追加格式。用法：node tools/probe-more-video-sources.mjs
 */
import { probeSourceApi } from '../src/aggregate.js';

const CANDIDATES = [
  { id: 'susu', name: '素素资源', api: 'https://ssszy.net/api.php/provide/vod', tags: ['电影', '剧集'] },
  { id: 'xingkong', name: '星空资源', api: 'https://bijizy.cc/api.php/provide/vod', tags: ['电影', '剧集'] },
  { id: 'yichen', name: '一尘资源', api: 'https://yichenzy.com/api.php/provide/vod', tags: ['电影', '剧集'] },
  { id: 'ikun', name: '爱看资源', api: 'https://ikunzyapi.com/api.php/provide/vod', tags: ['电影', '动漫'] },
  { id: 'tianju', name: '天举资源', api: 'https://tianjuzy.com/api.php/provide/vod', tags: ['电影', '剧集'] },
  { id: 'kuyun', name: '酷云资源', api: 'https://kuyunzy.com/api.php/provide/vod', tags: ['电影', '剧集'] },
  { id: 'xinlang', name: '新浪资源', api: 'https://api.xinlangapi.com/api.php/provide/vod', tags: ['电影', '剧集'] },
  { id: 'haohua', name: '豪华资源', api: 'https://hhzyapi.com/api.php/provide/vod', tags: ['电影', '剧集'] },
  { id: 'feifan2', name: '非凡二资源', api: 'https://api.ffzyplay.com/api.php/provide/vod', tags: ['电影', '剧集'] },
  { id: 'dadi', name: '大地资源', api: 'https://dadiapi.com/api.php/provide/vod', tags: ['电影', '剧集'] },
  { id: 'modu', name: '魔都资源', api: 'https://mozhua2.com/api.php/provide/vod', tags: ['电影', '剧集'] },
  { id: 'shandian', name: '闪电资源2', api: 'https://sdzy2.com/api.php/provide/vod', tags: ['电影', '剧集'] }
];

const results = [];
await Promise.all(CANDIDATES.map(async c => {
  const r = await probeSourceApi(c.api);
  results.push({ ...c, ...r });
}));

results.sort((a, b) => (b.ok - a.ok) || (a.ms - b.ms));
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name.padEnd(6)} ${String(r.ms).padStart(6)}ms  ${r.info}  ${r.api}`);
}
console.log('\n--- 可用源的 SEED 片段 ---');
for (const r of results.filter(r => r.ok)) {
  console.log(`  { id: '${r.id}', name: '${r.name}', api: '${r.api}', web: '', tags: ${JSON.stringify(r.tags)}, enabled: true },`);
}
