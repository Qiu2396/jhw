<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import AppIcon from './AppIcon.vue';
import { useAuth } from '../authStore.js';
import {
  getSources, addSource, putSource, removeSource, checkSources,
  getAiConfig, saveAiConfig, testAiConnection, aiDiscoverSources, aiAnalyzeHealth, aiLogs,
  getChannelSources, toggleChannelSource, checkChannelSource
} from '../api.js';

const { user, openAuth } = useAuth();
// 权限：超级管理员可管理源（编辑/删除/检测/AI）；游客和普通用户只能新增源
const isAdmin = computed(() => !!user.value?.isAdmin);

const sources = ref([]);
const navSites = ref([]);
const loaded = ref(false);

/* ---- 内置频道源（音乐/小说/听书/漫画） ---- */
const chSources = ref([]);            // 各频道内置源清单
const chCheckingId = ref('');         // 正在检测的 key（kind:id）
const chCheckResult = ref({});        // key → { ok, info }
const KIND_META = {
  music: ['音乐', 'k-music'],
  novel: ['小说', 'k-novel'],
  audiobook: ['听书', 'k-audiobook'],
  comic: ['漫画', 'k-comic']
};

async function loadChannelSources() {
  try {
    chSources.value = (await getChannelSources()).sources || [];
  } catch { /* 后端未就绪时静默 */ }
}

async function toggleChSource(s) {
  try {
    await toggleChannelSource(s.kind, s.id, !s.disabled);
    s.disabled = !s.disabled;
  } catch (e) {
    alert('操作失败：' + e.message);
  }
}

async function checkChSource(s) {
  const key = s.kind + ':' + s.id;
  chCheckingId.value = key;
  try {
    const r = await checkChannelSource(s.kind, s.id);
    chCheckResult.value[key] = { ok: r.ok, info: `${r.ok ? '正常' : '异常'} · ${r.info} · ${r.ms}ms` };
  } catch (e) {
    chCheckResult.value[key] = { ok: false, info: '检测失败：' + e.message };
  } finally {
    chCheckingId.value = '';
  }
}

/* ---- 检测 ---- */
const checking = ref(false);          // 一键检测中
const checkingId = ref('');           // 单源检测中
const DISABLED_KEY = 'fv_disabled_sources';
const disabled = ref(loadDisabled());

function loadDisabled() {
  try { return JSON.parse(localStorage.getItem(DISABLED_KEY) || '[]'); }
  catch { return []; }
}
function saveDisabled() {
  localStorage.setItem(DISABLED_KEY, JSON.stringify(disabled.value));
}
function toggle(id) {
  disabled.value = disabled.value.includes(id)
    ? disabled.value.filter(x => x !== id)
    : [...disabled.value, id];
  saveDisabled();
}

async function checkOne(id) {
  checkingId.value = id;
  try {
    const data = await checkSources(id);
    applyCheck(data.results);
  } catch (e) {
    alert('检测失败：' + e.message);
  } finally {
    checkingId.value = '';
  }
}

async function checkAll() {
  checking.value = true;
  try {
    const data = await checkSources('all');
    applyCheck(data.results);
  } catch (e) {
    alert('检测失败：' + e.message);
  } finally {
    checking.value = false;
  }
}

function applyCheck(results) {
  for (const r of results) {
    const s = sources.value.find(x => x.id === r.id);
    if (s) {
      s.last_check_status = r.ok ? 'ok' : 'fail';
      s.last_check_ms = r.ms;
      s.last_check_info = r.info;
      s.last_check_at = r.last_check_at;
    }
  }
}

/* ---- 新增 / 编辑 / 删除 ---- */
const showEdit = ref(false);
const editId = ref('');               // 空 = 新增
const editForm = ref(emptyForm());
const editError = ref('');
const saving = ref(false);

function emptyForm() {
  return { name: '', api: '', web: '', tags: '', note: '', enabled: true };
}
function openNew() {
  editId.value = '';
  editForm.value = emptyForm();
  editError.value = '';
  showEdit.value = true;
}
function openEdit(s) {
  editId.value = s.id;
  editForm.value = { name: s.name, api: s.api, web: s.web, tags: (s.tags || []).join(','), note: s.note, enabled: s.enabled };
  editError.value = '';
  showEdit.value = true;
}
async function saveEdit() {
  saving.value = true;
  editError.value = '';
  const payload = {
    name: editForm.value.name.trim(),
    api: editForm.value.api.trim(),
    web: editForm.value.web.trim(),
    tags: editForm.value.tags.split(/[,，\s]+/).filter(Boolean),
    note: editForm.value.note.trim(),
    enabled: !!editForm.value.enabled
  };
  try {
    if (editId.value) {
      const row = await putSource(editId.value, payload);
      const i = sources.value.findIndex(x => x.id === editId.value);
      if (i >= 0) sources.value[i] = { ...sources.value[i], ...row };
    } else {
      const row = await addSource(payload);
      sources.value.push(row);
    }
    showEdit.value = false;
  } catch (e) {
    editError.value = e.message;
  } finally {
    saving.value = false;
  }
}
async function remove(s) {
  if (!confirm(`确定删除「${s.name}」？`)) return;
  try {
    await removeSource(s.id);
    sources.value = sources.value.filter(x => x.id !== s.id);
  } catch (e) {
    alert('删除失败：' + e.message);
  }
}

/* ---- AI ---- */
const aiCfg = ref({ baseUrl: '', model: '', hasKey: false, keyMasked: '' });
const showAiCfg = ref(false);
const aiForm = ref({ baseUrl: '', apiKey: '', model: '' });
const aiSaving = ref(false);
const aiTesting = ref(false);
const aiTestResult = ref('');

const aiRunning = ref('');            // 'discover' | 'analyze' | ''
const aiReport = ref(null);           // discover 报告
const aiAnalysis = ref('');           // 体检建议
const aiError = ref('');

async function loadAiCfg() {
  try { aiCfg.value = await getAiConfig(); } catch { /* 忽略 */ }
}
function openAiCfg() {
  aiForm.value = { baseUrl: aiCfg.value.baseUrl || '', apiKey: '', model: aiCfg.value.model || '' };
  aiTestResult.value = '';
  showAiCfg.value = true;
}
async function saveAiCfg() {
  aiSaving.value = true;
  try {
    const payload = { baseUrl: aiForm.value.baseUrl, model: aiForm.value.model };
    if (aiForm.value.apiKey.trim()) payload.apiKey = aiForm.value.apiKey.trim();
    await saveAiConfig(payload);
    await loadAiCfg();
    showAiCfg.value = false;
  } catch (e) {
    aiTestResult.value = '保存失败：' + e.message;
  } finally {
    aiSaving.value = false;
  }
}
async function testConn() {
  aiTesting.value = true;
  aiTestResult.value = '';
  try {
    // 先保存当前填写值再测试（apiKey 留空沿用已存 key）
    const payload = { baseUrl: aiForm.value.baseUrl, model: aiForm.value.model };
    if (aiForm.value.apiKey.trim()) payload.apiKey = aiForm.value.apiKey.trim();
    await saveAiConfig(payload);
    const r = await testAiConnection();
    aiTestResult.value = `连接成功（${r.model}）：${r.reply}`;
    await loadAiCfg();
  } catch (e) {
    aiTestResult.value = e.message;
  } finally {
    aiTesting.value = false;
  }
}

async function runDiscover() {
  aiRunning.value = 'discover';
  aiError.value = '';
  aiReport.value = null;
  try {
    aiReport.value = await aiDiscoverSources(true, 8);
    await loadSources();   // 可能有新源入库
  } catch (e) {
    aiError.value = e.message;
  } finally {
    aiRunning.value = '';
  }
}

async function runAnalyze() {
  aiRunning.value = 'analyze';
  aiError.value = '';
  aiAnalysis.value = '';
  try {
    const r = await aiAnalyzeHealth();
    aiAnalysis.value = r.analysis;
  } catch (e) {
    aiError.value = e.message;
  } finally {
    aiRunning.value = '';
  }
}

/* ---- AI 日志 ---- */
const logs = ref([]);
const showLogs = ref(false);
async function loadLogs() {
  try {
    const data = await aiLogs();
    logs.value = data.logs || [];
    showLogs.value = true;
  } catch (e) {
    alert('获取日志失败：' + e.message);
  }
}

/* ---- 加载 ---- */
async function loadSources() {
  const data = await getSources();
  sources.value = data.sources || [];
  navSites.value = data.navSites || [];
}
onMounted(async () => {
  try {
    await loadSources();
    await loadChannelSources();
    if (isAdmin.value) await loadAiCfg();   // AI 配置仅管理员可读
  } catch { /* 后端未就绪时静默 */ }
  loaded.value = true;
});

// 页面停留时登录了管理员账号 → 补拉 AI 配置
watch(isAdmin, v => { if (v) loadAiCfg(); });

const fmtTime = (sec) => sec ? new Date(sec * 1000).toLocaleString('zh-CN', { hour12: false }) : '从未检测';
const statusLabel = (s) => {
  if (!s.last_check_status) return ['badge', '未检测'];
  return s.last_check_status === 'ok'
    ? ['badge green', `正常 ${s.last_check_ms}ms`]
    : ['badge red', `异常 · ${s.last_check_info || '失败'}`];
};
</script>

<template>
  <div class="sites container">
    <h2>站点目录</h2>
    <p class="page-desc">
      「可搜索源」供聚合搜索使用（存于本地 SQLite 数据库，可增删改）；「导航站点」为免费/正版平台直达链接。
      <span v-if="isAdmin">AI 可自动发现并验证新源。</span>
    </p>
    <p class="role-hint">
      <template v-if="isAdmin"><span class="badge gold">超级管理员</span> 你可以新增、编辑、删除源，使用一键检测与 AI 功能。</template>
      <template v-else-if="user"><span class="badge green">普通用户</span> 你可以新增源；编辑 / 删除 / 检测等管理操作仅超级管理员可用。</template>
      <template v-else><span class="badge">游客身份</span> 你可以直接新增源、正常使用全部功能；无需登录，登录也不强制。</template>
    </p>

    <!-- 工具条 -->
    <div class="toolbar">
      <button class="btn" @click="openNew"><AppIcon name="plus" :size="14" /> 新增源</button>
      <template v-if="isAdmin">
        <button class="btn" :disabled="checking" @click="checkAll">
          <span v-if="checking" class="spin"></span> 一键检测
        </button>
        <span class="toolbar-sep"></span>
        <button class="btn ai" :disabled="!!aiRunning" @click="runDiscover">
          <span v-if="aiRunning === 'discover'" class="spin"></span> ✨ AI 发现新源
        </button>
        <button class="btn ai" :disabled="!!aiRunning" @click="runAnalyze">
          <span v-if="aiRunning === 'analyze'" class="spin"></span> 🩺 AI 体检
        </button>
        <button class="btn" @click="loadLogs">AI 记录</button>
        <span class="toolbar-sep"></span>
        <button class="btn" @click="openAiCfg">
          ⚙ AI 设置
          <span class="badge" :class="aiCfg.hasKey ? 'green' : 'red'">{{ aiCfg.hasKey ? '已配置' : '未配置' }}</span>
        </button>
      </template>
    </div>

    <p v-if="aiError" class="ai-error">⚠ {{ aiError }}<span v-if="!aiCfg.hasKey" class="dim">（点击右上角「AI 设置」配置服务）</span></p>
    <p v-if="aiRunning" class="ai-running"><span class="spin"></span> AI 正在{{ aiRunning === 'discover' ? '推荐并逐个验证新源（通常 1~2 分钟）' : '分析源健康' }}…</p>

    <!-- AI 发现报告 -->
    <section v-if="aiReport" class="block ai-panel">
      <div class="block-head">
        <h3>✨ AI 发现报告 <span class="dim">{{ aiReport.model }}</span></h3>
        <span class="badge gold">{{ aiReport.summary }}</span>
      </div>
      <table class="src-table">
        <thead><tr><th>结果</th><th>名称</th><th>接口</th><th>说明</th></tr></thead>
        <tbody>
          <tr v-for="v in aiReport.validated" :key="v.api" :class="{ added: aiReport.added.some(a => a.api === v.api) }">
            <td>
              <span v-if="v.reject" class="badge red">拒绝</span>
              <span v-else-if="v.ok" class="badge green">可用 {{ v.ms }}ms</span>
              <span v-else class="badge red">不可用 · {{ v.info }}</span>
            </td>
            <td>{{ v.name }} <span v-if="aiReport.added.some(a => a.api === v.api)" class="badge gold">已入库</span></td>
            <td class="api-cell"><code>{{ v.api }}</code></td>
            <td class="dim">{{ v.note || (v.reject || v.info) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- AI 体检建议 -->
    <section v-if="aiAnalysis" class="block ai-panel">
      <div class="block-head"><h3>🩺 AI 体检建议</h3></div>
      <div class="analysis-text">{{ aiAnalysis }}</div>
    </section>

    <!-- 内置频道源：音乐/小说/听书/漫画（各站一套解析规则，暂不支持网页新增） -->
    <section class="block">
      <div class="block-head">
        <h3>内置频道源（音乐 / 小说 / 听书 / 漫画）</h3>
      </div>
      <div class="ch-list">
        <div v-for="s in chSources" :key="s.kind + ':' + s.id" class="ch-row" :class="{ off: s.disabled }">
          <span class="kind-badge" :class="KIND_META[s.kind] ? KIND_META[s.kind][1] : ''">{{ KIND_META[s.kind] ? KIND_META[s.kind][0] : s.kind }}</span>
          <div class="ch-info">
            <div class="ch-name">{{ s.name }}</div>
            <div class="ch-desc dim">{{ s.desc }}</div>
            <div v-if="chCheckResult[s.kind + ':' + s.id]" class="ch-check" :class="chCheckResult[s.kind + ':' + s.id].ok ? 'ok' : 'bad'">
              {{ chCheckResult[s.kind + ':' + s.id].info }}
            </div>
          </div>
          <div class="ch-ops">
            <span class="badge" :class="s.disabled ? 'red' : 'green'">{{ s.disabled ? '已停用' : '启用' }}</span>
            <template v-if="isAdmin">
              <button class="btn small" :disabled="chCheckingId === s.kind + ':' + s.id" @click="checkChSource(s)">
                <span v-if="chCheckingId === s.kind + ':' + s.id" class="spin"></span> 检测
              </button>
              <button class="toggle" :class="{ on: !s.disabled }" @click="toggleChSource(s)">
                <span class="knob"></span>
              </button>
            </template>
          </div>
        </div>
      </div>
      <p class="tip">
        这些频道源内置于程序（每站一套解析规则），失效或停用后对应频道的搜索会跳过它。
        <template v-if="!isAdmin">停用 / 检测需超级管理员操作。</template>
      </p>
    </section>

    <!-- 可搜索源 -->
    <section class="block">
      <div class="block-head">
        <h3>可搜索资源源（{{ sources.length }}）</h3>
      </div>
      <div class="src-table-wrap">
        <table class="src-table">
          <thead>
            <tr>
              <th>状态</th><th>名称</th><th>标识</th><th>标签</th><th>最近检测</th>
              <th v-if="isAdmin">操作</th>
              <th>搜索开关</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in sources" :key="s.id" :class="{ off: !s.enabled }">
              <td>
                <span v-if="s.enabled" class="badge green">启用</span>
                <span v-else class="badge red">停用</span>
                <span v-if="s.origin === 'ai'" class="badge gold">AI</span>
              </td>
              <td>
                {{ s.name }}
                <a v-if="s.web" :href="s.web" target="_blank" rel="noopener noreferrer" class="web-link">前台 ↗</a>
                <div v-if="s.note" class="dim note-line">{{ s.note }}</div>
              </td>
              <td><code>{{ s.id }}</code></td>
              <td class="tags-cell"><span v-for="t in s.tags" :key="t" class="badge">{{ t }}</span></td>
              <td>
                <span :class="statusLabel(s)[0]">{{ statusLabel(s)[1] }}</span>
                <div class="dim note-line">{{ fmtTime(s.last_check_at) }}</div>
              </td>
              <td v-if="isAdmin">
                <div class="ops">
                  <button class="btn small" :disabled="checkingId === s.id" @click="checkOne(s.id)">
                    <span v-if="checkingId === s.id" class="spin"></span> 检测
                  </button>
                  <button class="btn small" @click="openEdit(s)">编辑</button>
                  <button class="btn small danger" @click="remove(s)">删除</button>
                </div>
              </td>
              <td>
                <button class="toggle" :class="{ on: !disabled.includes(s.id) }" :disabled="!s.enabled" @click="toggle(s.id)">
                  <span class="knob"></span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="tip">
        关闭的源在搜索时将被跳过（保存在本机浏览器）。
        <template v-if="isAdmin">检测/编辑/删除直接作用于本地数据库。</template>
        <template v-else>新增源对所有人生效；管理操作需超级管理员登录。</template>
      </p>
    </section>

    <!-- 导航站点 -->
    <section class="block">
      <h3>导航站点（{{ navSites.length }}）</h3>
      <div class="nav-grid">
        <a v-for="n in navSites" :key="n.url" :href="n.url" target="_blank" rel="noopener noreferrer" class="nav-card">
          <div class="nav-head">
            <strong>{{ n.name }}</strong>
            <span class="badge" :class="n.official ? 'green' : ''">{{ n.category }}</span>
          </div>
          <p>{{ n.desc }}</p>
          <span class="nav-url">{{ n.url }}</span>
        </a>
      </div>
    </section>

    <!-- 新增/编辑弹窗 -->
    <div v-if="showEdit" class="mask" @click.self="showEdit = false">
      <div class="dialog">
        <h3>{{ editId ? '编辑源' : '新增源' }}</h3>
        <div class="form">
          <label>名称 *<input v-model="editForm.name" placeholder="如：暴风资源" maxlength="40" /></label>
          <label>接口地址 *<input v-model="editForm.api" placeholder="https://域名/api.php/provide/vod" /></label>
          <label>前台地址<input v-model="editForm.web" placeholder="可选，https://…" /></label>
          <label>标签<input v-model="editForm.tags" placeholder="逗号分隔，如：动漫,剧集" /></label>
          <label>备注<input v-model="editForm.note" maxlength="120" placeholder="可选" /></label>
          <label class="checkbox"><input v-model="editForm.enabled" type="checkbox" /> 启用该源参与搜索</label>
        </div>
        <p v-if="editError" class="form-error">{{ editError }}</p>
        <div class="dialog-foot">
          <button class="btn" @click="showEdit = false">取消</button>
          <button class="btn primary" :disabled="saving" @click="saveEdit"><span v-if="saving" class="spin"></span> 保存</button>
        </div>
      </div>
    </div>

    <!-- AI 设置弹窗 -->
    <div v-if="showAiCfg" class="mask" @click.self="showAiCfg = false">
      <div class="dialog">
        <h3>AI 服务设置</h3>
        <p class="dim cfg-tip">填写任意 OpenAI 兼容服务（DeepSeek、Kimi、智谱、通义、OpenAI、本地 Ollama 等）。配置保存在本机数据库。</p>
        <div class="form">
          <label>接口地址 (Base URL) *<input v-model="aiForm.baseUrl" placeholder="如 https://api.deepseek.com/v1" /></label>
          <label>模型名 *<input v-model="aiForm.model" placeholder="如 deepseek-chat" /></label>
          <label>API Key {{ aiCfg.hasKey ? `（已保存 ${aiCfg.keyMasked}，留空则不修改）` : '*' }}<input v-model="aiForm.apiKey" type="password" placeholder="sk-…" /></label>
        </div>
        <p v-if="aiTestResult" class="form-msg" :class="{ err: !aiTestResult.includes('成功') }">{{ aiTestResult }}</p>
        <div class="dialog-foot">
          <button class="btn" :disabled="aiTesting" @click="testConn"><span v-if="aiTesting" class="spin"></span> 测试并保存</button>
          <button class="btn primary" :disabled="aiSaving" @click="saveAiCfg">保存</button>
        </div>
      </div>
    </div>

    <!-- AI 日志弹窗 -->
    <div v-if="showLogs" class="mask" @click.self="showLogs = false">
      <div class="dialog">
        <h3>AI 操作记录</h3>
        <div v-if="!logs.length" class="dim">暂无记录</div>
        <ul class="log-list">
          <li v-for="l in logs" :key="l.id">
            <span class="log-time">{{ new Date(l.created_at).toLocaleString('zh-CN', { hour12: false }) }}</span>
            <span class="badge">{{ l.action === 'discover' ? '发现新源' : '体检分析' }}</span>
            <span>{{ l.summary }}</span>
          </li>
        </ul>
        <div class="dialog-foot">
          <button class="btn" @click="showLogs = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sites { padding-top: 34px; animation: rise 0.35s ease both; }
h2 { margin: 0 0 6px; font-size: 22px; }
.page-desc { color: var(--text-dim); margin: 0 0 10px; font-size: 14px; }
.role-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--text-dim);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 9px 14px;
  margin: 0 0 18px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
}
.toolbar-sep { width: 1px; height: 22px; background: var(--border); margin: 0 4px; }
.btn.ai { border-color: rgba(242, 185, 75, 0.35); color: var(--gold); }
.btn.ai:hover { background: var(--gold-soft); border-color: rgba(242, 185, 75, 0.55); }
.ai-error { color: var(--red); font-size: 14px; margin: 0 0 14px; }
.ai-running { display: flex; align-items: center; gap: 8px; color: var(--gold); font-size: 14px; margin: 0 0 14px; }

.block { margin-bottom: 40px; }
.block-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
.block-head h3, .block > h3 { font-size: 16px; margin: 0; }
.block > h3 { margin-bottom: 12px; }

/* ---- 内置频道源 ---- */
.ch-list { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
.ch-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  transition: background 0.12s;
}
.ch-row:last-child { border-bottom: none; }
.ch-row:hover { background: var(--hover); }
.ch-row.off { opacity: 0.55; }
.ch-info { flex: 1; min-width: 0; }
.ch-name { font-size: 14px; font-weight: 600; }
.ch-desc { font-size: 12px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ch-check { font-size: 12px; margin-top: 3px; }
.ch-check.ok { color: var(--green); }
.ch-check.bad { color: var(--red); }
.ch-ops { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.kind-badge.k-music { background: var(--gold-soft); color: var(--gold); }
.kind-badge.k-novel { background: rgba(90, 168, 255, 0.12); color: var(--blue); }
.kind-badge.k-audiobook { background: rgba(226, 149, 42, 0.14); color: var(--gold-2); }
.kind-badge.k-comic { background: rgba(52, 209, 137, 0.12); color: var(--green); }

.ai-panel {
  position: relative;
  background: var(--surface);
  border: 1px solid rgba(242, 185, 75, 0.28);
  border-radius: var(--radius);
  padding: 18px 20px;
  overflow: hidden;
}
.ai-panel::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: linear-gradient(to bottom, var(--gold), var(--gold-2));
}
.analysis-text { white-space: pre-wrap; font-size: 14px; color: var(--text); line-height: 1.8; }

.src-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}
.src-table { width: 100%; border-collapse: collapse; font-size: 14px; min-width: 760px; }
.src-table th, .src-table td { padding: 11px 16px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
.src-table th {
  color: var(--text-faint);
  font-weight: 500;
  font-size: 12px;
  letter-spacing: 0.5px;
  background: var(--bg-soft);
}
.src-table tbody tr { transition: background 0.12s; }
.src-table tbody tr:hover { background: var(--hover); }
.src-table tbody tr:last-child td { border-bottom: none; }
.src-table tr.off td { opacity: 0.5; }
.src-table tr.added td { background: rgba(242, 185, 75, 0.06); }
.api-cell { max-width: 320px; }
.tags-cell { display: flex; gap: 5px; flex-wrap: wrap; }
.web-link { font-size: 12px; margin-left: 8px; }
.note-line { font-size: 12px; margin-top: 3px; color: var(--text-faint); }
.ops { display: flex; gap: 6px; flex-wrap: wrap; }

.toggle {
  width: 42px; height: 23px;
  border-radius: 999px;
  background: var(--surface-3);
  border: 1px solid var(--border);
  position: relative;
  transition: all 0.18s;
}
.toggle .knob {
  position: absolute;
  top: 2px; left: 3px;
  width: 17px; height: 17px;
  border-radius: 50%;
  background: var(--text-faint);
  transition: all 0.18s;
}
.toggle.on { background: rgba(242, 185, 75, 0.3); border-color: rgba(242, 185, 75, 0.5); }
.toggle.on .knob { left: 20px; background: var(--gold); }
.toggle:disabled { opacity: 0.4; cursor: not-allowed; }
.tip { color: var(--text-faint); font-size: 12px; margin-top: 10px; }

.nav-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.nav-card {
  display: block;
  color: inherit;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 17px 18px;
  transition: all 0.18s;
}
.nav-card:hover {
  text-decoration: none;
  border-color: rgba(90, 168, 255, 0.45);
  transform: translateY(-2px);
  box-shadow: var(--shadow-1);
}
.nav-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
.nav-card p { margin: 0 0 10px; font-size: 13px; color: var(--text-dim); }
.nav-url { font-size: 12px; color: var(--text-faint); }

/* 弹窗 */
.mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: var(--mask);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: fade-in 0.18s ease both;
}
.dialog {
  width: 100%;
  max-width: 520px;
  max-height: 88vh;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  padding: 22px 24px;
  box-shadow: var(--shadow-2);
  animation: pop-in 0.2s ease both;
}
.dialog h3 { margin: 0 0 14px; }
.cfg-tip { font-size: 13px; margin: -6px 0 14px; }
.form { display: flex; flex-direction: column; gap: 12px; }
.form label { display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: var(--text-dim); }
.form input {
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 9px 12px;
  color: var(--text);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.form input:focus {
  border-color: rgba(242, 185, 75, 0.5);
  box-shadow: 0 0 0 3px rgba(242, 185, 75, 0.08);
}
.form .checkbox { flex-direction: row; align-items: center; gap: 8px; color: var(--text); }
.form input[type="checkbox"] { width: 16px; height: 16px; }
.form-error { color: var(--red); font-size: 13px; margin: 10px 0 0; }
.form-msg { font-size: 13px; margin: 10px 0 0; color: var(--green); }
.form-msg.err { color: var(--red); }
.dialog-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }

.log-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.log-list li { display: flex; align-items: center; gap: 10px; font-size: 13px; flex-wrap: wrap; }
.log-time { color: var(--text-faint); font-size: 12px; }

/* ---- 移动端 H5 ---- */
@media (max-width: 720px) {
  .sites { padding-top: 22px; }
  .toolbar .btn { height: 34px; padding: 0 12px; font-size: 13px; }
  .dialog { padding: 18px 16px; }
  .role-hint { font-size: 12.5px; padding: 8px 12px; }
  /* 表格靠横向滚动查看：单元格内容不换行，避免一字一行竖排堆叠 */
  .src-table th, .src-table td { white-space: nowrap; }
  .api-cell { max-width: none; }
}
</style>
