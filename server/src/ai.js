/**
 * AI 模块：让 AI 参与网站的源维护
 *
 * 1. AI 发现新源 —— 根据现有源与失效情况，让 LLM 推荐 macCMS 资源站接口，
 *    逐个真实请求验证（能搜索到内容才算通过），通过的可自动入库。
 * 2. AI 体检分析 —— 把各源最近检测结果交给 LLM，输出维护建议。
 * 3. AI 操作日志 —— 每次自动操作写 ai_logs 表，页面可查。
 *
 * LLM 配置存 SQLite settings 表（也可用环境变量兜底）：
 *   ai_base_url  OpenAI 兼容接口地址，如 https://api.deepseek.com/v1
 *   ai_api_key   API Key
 *   ai_model     模型名，如 deepseek-chat
 */
import { listSources, getSetting, setSetting, insertSource, addAiLog, getSource } from './db.js';
import { probeSourceApi } from './aggregate.js';

export const AI_KEYS = { baseUrl: 'ai_base_url', apiKey: 'ai_api_key', model: 'ai_model' };

export function getAiConfig() {
  return {
    baseUrl: getSetting(AI_KEYS.baseUrl) || process.env.AI_BASE_URL || '',
    apiKey: getSetting(AI_KEYS.apiKey) || process.env.AI_API_KEY || '',
    model: getSetting(AI_KEYS.model) || process.env.AI_MODEL || ''
  };
}

export function setAiConfig({ baseUrl, apiKey, model }) {
  if (baseUrl !== undefined) setSetting(AI_KEYS.baseUrl, baseUrl.trim());
  if (apiKey !== undefined) setSetting(AI_KEYS.apiKey, apiKey.trim());
  if (model !== undefined) setSetting(AI_KEYS.model, model.trim());
}

function requireConfig() {
  const cfg = getAiConfig();
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    throw new Error('尚未配置 AI 服务：请在「站点目录 → AI 设置」中填写接口地址、API Key 和模型名（任何 OpenAI 兼容服务均可）');
  }
  return cfg;
}

/** 调用 OpenAI 兼容 chat/completions */
async function chat(cfg, messages) {
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.3 })
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`AI 接口返回 ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = JSON.parse(text);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI 返回内容为空');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/** 从 LLM 回复中提取 JSON（兼容 markdown 代码块、前后缀说明文字） */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[[{]/);
  if (start < 0) throw new Error('AI 回复中没有找到 JSON');
  const openCh = raw[start];
  const closeCh = openCh === '[' ? ']' : '}';
  const end = raw.lastIndexOf(closeCh);
  if (end <= start) throw new Error('AI 回复中的 JSON 不完整');
  return JSON.parse(raw.slice(start, end + 1));
}

/* ---------------- AI 发现新源 ---------------- */

const DISCOVER_PROMPT = `你是一个免费影视资源站专家。国内大量影视资源站基于「苹果CMS(macCMS)」搭建，其资源采集层提供统一的公开 JSON 接口：
- 搜索: https://<域名>/api.php/provide/vod?ac=videolist&wd=关键词
- 详情: https://<域名>/api.php/provide/vod?ac=detail&ids=影片ID
返回 JSON {code:1, list:[{vod_id, vod_name, vod_pic, vod_remarks, vod_play_url...}]}。

以下是本站已收录的源及其状态（JSON）：
{{EXISTING}}

请推荐 {{COUNT}} 个【未收录的、你确信存在且目前仍在运营】的 macCMS 资源站 JSON 接口，优先推荐知名、稳定、更新勤的资源站（如各类采集站），不要与已收录的域名重复。
只返回 JSON，不要任何解释文字，格式：
{"sources":[{"id":"短英文标识","name":"中文名","api":"完整接口地址，以 /api.php/provide/vod 结尾","web":"站点主页(可选可空)","tags":["标签"],"note":"一句话说明"}]}`;

/** AI 推荐新源并逐个验证；autoAdd=true 时将验证通过的自动入库 */
export async function aiDiscoverSources({ autoAdd = true, count = 8 } = {}) {
  const cfg = requireConfig();
  const existing = listSources().map(s => ({
    id: s.id, name: s.name, api: s.api,
    enabled: s.enabled,
    status: s.last_check_status || '未检测',
    note: s.note
  }));
  const prompt = DISCOVER_PROMPT
    .replace('{{EXISTING}}', JSON.stringify(existing))
    .replace('{{COUNT}}', String(count));

  const content = await chat(cfg, [
    { role: 'system', content: '你是谨慎的中文影视资源站维护助手，只输出 JSON。' },
    { role: 'user', content: prompt }
  ]);

  let parsed;
  try {
    parsed = extractJson(content);
  } catch {
    throw new Error('AI 返回的内容无法解析为 JSON：' + content.slice(0, 200));
  }
  const candidates = Array.isArray(parsed.sources) ? parsed.sources : Array.isArray(parsed) ? parsed : [];
  if (!candidates.length) throw new Error('AI 没有返回任何候选源');

  // 逐个真实验证
  const existingApis = new Set(existing.map(s => s.api.replace(/\/+$/, '')));
  const validated = [];
  for (const c of candidates.slice(0, 12)) {
    const api = String(c.api || '').trim();
    const item = {
      id: String(c.id || '').trim(),
      name: String(c.name || '').trim() || '未命名源',
      api,
      web: String(c.web || '').trim(),
      tags: Array.isArray(c.tags) ? c.tags.map(String).slice(0, 4) : [],
      note: String(c.note || '').trim(),
      reject: ''
    };
    if (!/^https?:\/\//.test(api)) {
      item.reject = '接口地址不合法';
    } else if (existingApis.has(api.replace(/\/+$/, ''))) {
      item.reject = '与已收录源重复';
    } else {
      const r = await probeSourceApi(api);
      item.ok = r.ok;
      item.ms = r.ms;
      item.info = r.info;
    }
    validated.push(item);
  }

  // 入库
  const added = [];
  if (autoAdd) {
    for (const v of validated) {
      if (!v.ok) continue;
      const base = normalizeId(v.id)
        || normalizeId(v.name)
        || normalizeId(safeHost(v.api))
        || 'ai';
      const id = uniqueId(base);
      const row = insertSource({
        id,
        name: v.name,
        api: v.api,
        web: v.web,
        tags: v.tags.length ? v.tags : ['AI推荐'],
        enabled: true,
        note: v.note || 'AI 推荐并验证通过',
        origin: 'ai'
      });
      added.push({ id: row.id, name: row.name, api: row.api });
    }
  }

  const okCount = validated.filter(v => v.ok).length;
  const summary = `AI 推荐 ${validated.length} 个源，验证通过 ${okCount} 个，入库 ${added.length} 个`;
  const logId = addAiLog('discover', summary, validated);
  return { summary, validated, added, model: cfg.model };
}

/* ---------------- AI 体检分析 ---------------- */

export async function aiAnalyzeHealth() {
  const cfg = requireConfig();
  const sources = listSources().map(s => ({
    id: s.id, name: s.name, enabled: s.enabled,
    lastCheckAt: s.last_check_at ? new Date(s.last_check_at * 1000).toISOString() : '从未检测',
    status: s.last_check_status || '未检测',
    ms: s.last_check_ms,
    info: s.last_check_info
  }));
  const content = await chat(cfg, [
    { role: 'system', content: '你是影视聚合站的源维护助手，用简体中文、简洁分点回答。' },
    {
      role: 'user',
      content:
        `这是本站 ${sources.length} 个视频源最近的检测结果（JSON）：\n${JSON.stringify(sources)}\n\n` +
        '请给出：1) 整体健康度一句话结论；2) 哪些源有问题、可能的原因；3) 具体的维护操作建议（停用/替换/重新检测等）。控制在 300 字内。'
    }
  ]);
  const logId = addAiLog('analyze', 'AI 体检分析完成', [{ text: content.slice(0, 500) }]);
  return { analysis: content, model: cfg.model };
}

/* ---------------- 测试连接 ---------------- */

export async function aiTestConnection() {
  const cfg = requireConfig();
  const content = await chat(cfg, [{ role: 'user', content: '回复两个字：正常' }]);
  return { ok: true, reply: content.trim().slice(0, 50), model: cfg.model };
}

/* ---------------- helpers ---------------- */

function normalizeId(raw) {
  return String(raw).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
}

/** 生成不与现有源冲突的 id */
function uniqueId(base) {
  let id = base;
  let i = 2;
  while (getSource(id)) id = `${base}${i++}`;
  return id;
}

function safeHost(api) {
  try { return new URL(api).host; } catch { return ''; }
}
