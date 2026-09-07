/**
 * 源可用性检测工具：npm run probe [关键词]
 * 逐个测试数据库中收录的源，输出延迟与命中情况，并把结果写回数据库。
 * 用于排查「搜不到结果」时哪个源失效了。
 */
import { listSources, updateCheckResult } from '../src/db.js';
import { probeSourceApi } from '../src/aggregate.js';

const kw1 = process.argv[2] || '凡人修仙传';
const kw2 = process.argv[3] || '斗破苍穹';

const sources = listSources();
console.log(`检测关键词: ${kw1} / ${kw2}，共 ${sources.length} 个源\n`);

for (const s of sources) {
  const r = await probeSourceApi(s.api, [kw1, kw2]);
  updateCheckResult(s.id, { status: r.ok ? 'ok' : 'fail', ms: r.ms, info: r.info });
  const mark = r.ok ? '✔' : '✘';
  const state = s.enabled ? '' : '（已停用）';
  console.log(`${mark} ${s.id} ${s.name} ${state}  ${r.ms}ms  ${r.info}`);
}
