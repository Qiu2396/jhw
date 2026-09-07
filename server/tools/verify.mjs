// 临时验证脚本：聚合搜索 + 详情
const base = 'http://localhost:3000';
const kw = '凡人修仙传';
const s = await (await fetch(`${base}/api/search?kw=${encodeURIComponent(kw)}`)).json();
console.log(`tookMs=${s.tookMs} groups=${s.groups.length} failed=${JSON.stringify(s.failed)}`);
for (const g of s.groups.slice(0, 10)) {
  console.log(`- ${g.title} | ${g.year || '-'} | ${g.type || '-'} | ${g.remarks || '-'} | 来源: ${g.sources.map(x => x.sourceName + '#' + x.vodId).join(', ')}`);
}
// 详情验证：取第一组的第一个源
const g0 = s.groups[0];
const src0 = g0.sources[0];
const d = await (await fetch(`${base}/api/detail?source=${src0.sourceId}&vid=${src0.vodId}`)).json();
console.log(`\n详情: 《${d.title}》${d.remarks} 来源=${d.sourceName} 线路=${d.plays.map(p => p.from + ':' + p.episodes.length + '集').join(', ')}`);
console.log('首集:', JSON.stringify(d.plays[0].episodes[0]));
// 顺便测下斗破苍穹
const s2 = await (await fetch(`${base}/api/search?kw=${encodeURIComponent('斗破苍穹')}`)).json();
console.log(`\n斗破苍穹: groups=${s2.groups.length}, 前5: ${s2.groups.slice(0,5).map(g => g.title).join(' / ')}`);
