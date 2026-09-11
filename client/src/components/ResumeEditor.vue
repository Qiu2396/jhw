<script setup>
/**
 * 在线简历编辑器（完整版）
 *
 * - 多份简历管理：新建 / 复制 / 重命名 / 删除 / 一键切换
 * - 云端同步：登录用户自动同步到服务端（跨设备）；游客存本机 localStorage
 * - 完整板块：个人优势 / 技能 / 工作经历 / 项目经历 / 教育背景 / 证书奖项
 *   + 自定义板块（可添加任意多个），每个板块支持 显隐开关 与 排序
 * - 主题色 6 色 + 三档排版密度
 * - JSON 导入 / 导出（备份与迁移）
 * - 导出 PDF：走浏览器打印管线，生成可选中文字的矢量 PDF
 */
import { reactive, ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import AppIcon from './AppIcon.vue';
import { useAuth } from '../authStore.js';
import { listResume, getResume, saveResume, removeResume } from '../api.js';

const ACCENTS = ['#2f6fed', '#0e9f8a', '#7c3aed', '#e0553c', '#c99416', '#333333'];
const DENSITIES = [
  { id: 'compact', name: '紧凑' },
  { id: 'standard', name: '标准' },
  { id: 'loose', name: '宽松' }
];
const SEC_META = {
  summary: '个人优势',
  skills: '技能特长',
  work: '工作经历',
  projects: '项目经历',
  education: '教育背景',
  certs: '证书 / 获奖'
};

const defaultData = () => ({
  base: { name: '', job: '', phone: '', email: '', city: '', link: '' },
  avatar: '',
  accent: ACCENTS[0],
  density: 'standard',
  secOn: { summary: true, skills: true, work: true, projects: true, education: true, certs: true },
  order: ['summary', 'skills', 'work', 'projects', 'education', 'certs'],
  summary: '',
  skills: [],
  work: [],      // { company, role, start, end, desc }
  projects: [],  // { name, role, start, end, desc }
  education: [], // { school, major, degree, start, end }
  certs: [],     // { name, date }
  custom: []     // { id, title, entries: [{ k, v }] }
});

const ENTRY_TPL = {
  work: { company: '', role: '', start: '', end: '', desc: '' },
  projects: { name: '', role: '', start: '', end: '', desc: '' },
  education: { school: '', major: '', degree: '', start: '', end: '' }
};

/* ================= 多文档存储 ================= */

const { user } = useAuth();
const docs = ref([]);              // [{ docId, title, updatedAt }]
const activeId = ref('default');
const title = ref('我的简历');
const sync = ref({ state: 'idle', at: '', err: '' });   // idle | saving | saved | error
const loading = ref(true);
const data = reactive(defaultData());

const LOCAL_INDEX = 'rv_docs_index';
const localKey = id => 'rv_doc_' + id;

function localIndex() {
  try { return JSON.parse(localStorage.getItem(LOCAL_INDEX) || '[]'); } catch { return []; }
}
function localSaveIndex(list) {
  try { localStorage.setItem(LOCAL_INDEX, JSON.stringify(list)); } catch { /* 容量满 */ }
}
function localLoadDoc(id) {
  try {
    const raw = localStorage.getItem(localKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function localSaveDoc(id, t, data) {
  try { localStorage.setItem(localKey(id), JSON.stringify({ title: t, data })); } catch { /* 忽略 */ }
  const list = localIndex().filter(d => d.id !== id);
  list.unshift({ id, title: t, updatedAt: Date.now() });
  localSaveIndex(list);
}
function localRemoveDoc(id) {
  localStorage.removeItem(localKey(id));
  localSaveIndex(localIndex().filter(d => d.id !== id));
}

function isCloud() { return !!user.value; }

async function apiDocs() { return (await listResume()).docs || []; }

/** 初始化文档列表与当前文档（登录/登出/进入页面时调用） */
async function initDocs() {
  loading.value = true;
  try {
    if (isCloud()) {
      // 本机旧文档一次性迁移到云端（云端没有同 id 才传）
      const local = localIndex();
      let cloud = await apiDocs();
      for (const l of local) {
        if (!cloud.some(c => c.docId === l.id)) {
          const d = localLoadDoc(l.id);
          if (d) { await saveResume(l.id, { title: d.title, data: d.data }); }
        }
      }
      cloud = await apiDocs();
      docs.value = cloud;
      const savedActive = localStorage.getItem('rv_active') || '';
      activeId.value = docs.value.some(d => d.docId === savedActive)
        ? savedActive
        : (docs.value[0]?.docId || newDocId());
      if (!docs.value.some(d => d.docId === activeId.value)) {
        // 云端还是空的：建一份并刷新列表
        activeId.value = await createDoc(false);
        docs.value = await apiDocs();
      }
      await loadDoc(activeId.value);
    } else {
      docs.value = localIndex();
      if (!docs.value.length) {
        localSaveDoc('default', '我的简历', defaultData());
        docs.value = localIndex();
      }
      const savedActive = localStorage.getItem('rv_active') || '';
      activeId.value = docs.value.some(d => d.id === savedActive) ? savedActive : docs.value[0].id;
      await loadDoc(activeId.value);
    }
  } finally {
    loading.value = false;
  }
}

async function loadDoc(id) {
  if (isCloud()) {
    try {
      const d = await getResume(id);
      title.value = d.title;
      applyData(d.data);
    } catch {
      // 云端没有（刚新建）：空文档
      applyData(defaultData());
      title.value = '未命名简历';
    }
  } else {
    const d = localLoadDoc(id);
    title.value = d?.title || '我的简历';
    applyData(d?.data || defaultData());
  }
  localStorage.setItem('rv_active', id);
}

function applyData(d) {
  const base = defaultData();
  Object.assign(data, base, d || {});
  data.base = { ...base.base, ...(d?.base || {}) };
  data.secOn = { ...base.secOn, ...(d?.secOn || {}) };
  if (!Array.isArray(data.order) || !data.order.length) data.order = base.order;
}

/* ---- 自动保存（本地即时 / 云端防抖） ---- */
let saveTimer = null;
watch(data, () => {
  sync.value = { state: isCloud() ? 'saving' : 'saving', at: '', err: '' };
  clearTimeout(saveTimer);
  if (isCloud()) {
    saveTimer = setTimeout(doCloudSave, 900);
  } else {
    localSaveDoc(activeId.value, title.value, JSON.parse(JSON.stringify(data)));
    sync.value = { state: 'saved', at: new Date().toLocaleTimeString('zh-CN', { hour12: false }), err: '' };
  }
}, { deep: true });

async function doCloudSave() {
  try {
    await saveResume(activeId.value, { title: title.value, data: JSON.parse(JSON.stringify(data)) });
    sync.value = { state: 'saved', at: new Date().toLocaleTimeString('zh-CN', { hour12: false }), err: '' };
  } catch (e) {
    sync.value = { state: 'error', at: '', err: e.message || '同步失败' };
  }
}

/** 登录 / 登出切换：换存储介质 */
watch(user, () => { initDocs(); });

/* ---- 文档操作 ---- */
function newDocId() {
  return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
}

async function createDoc(rerender = true) {
  const id = newDocId();
  const t = '简历 ' + (docs.value.length + 1);
  const dataCopy = JSON.parse(JSON.stringify(data));
  if (isCloud()) await saveResume(id, { title: t, data: dataCopy });
  else localSaveDoc(id, t, dataCopy);
  if (rerender) {
    docs.value = isCloud() ? await apiDocs() : localIndex();
    await switchDoc(id);
  }
  return id;
}

async function copyDoc() {
  const id = newDocId();
  const dataCopy = JSON.parse(JSON.stringify(data));
  const t = title.value + ' 副本';
  if (isCloud()) await saveResume(id, { title: t, data: dataCopy });
  else localSaveDoc(id, t, dataCopy);
  docs.value = isCloud() ? await apiDocs() : localIndex();
  await switchDoc(id);
}

async function renameDoc() {
  const t = prompt('简历名称：', title.value);
  if (t === null) return;
  title.value = (t.trim() || title.value).slice(0, 60);
  sync.value = { state: 'saving', at: '', err: '' };
  if (isCloud()) await doCloudSave();
  else localSaveDoc(activeId.value, title.value, JSON.parse(JSON.stringify(data)));
  docs.value = isCloud() ? await apiDocs() : localIndex();
}

async function deleteDoc() {
  if (docs.value.length <= 1) { alert('至少保留一份简历'); return; }
  if (!confirm(`确定删除「${title.value}」？此操作不可恢复。`)) return;
  if (isCloud()) { try { await removeResume(activeId.value); } catch { /* 忽略 */ } }
  else localRemoveDoc(activeId.value);
  docs.value = isCloud() ? await apiDocs() : localIndex();
  await switchDoc(docs.value[0].docId ?? docs.value[0].id);
}

async function switchDoc(id) {
  clearTimeout(saveTimer);
  activeId.value = id;
  await loadDoc(id);
}

/* ================= 板块与内容 ================= */

const visibleSections = computed(() => data.order.filter(id => secEnabled(id)));

function secEnabled(id) {
  if (id.startsWith('c_')) return true;
  return data.secOn[id] !== false;
}
function secTitle(id) {
  if (id.startsWith('c_')) return data.custom.find(c => c.id === id)?.title || '自定义板块';
  return SEC_META[id] || id;
}

function addCustomSec() {
  const id = 'c_' + Date.now().toString(36);
  data.custom.push({ id, title: '自定义板块', entries: [{ k: '', v: '' }] });
  data.order.push(id);
}
function removeCustomSec(id) {
  if (!confirm('删除该自定义板块？')) return;
  data.custom = data.custom.filter(c => c.id !== id);
  data.order = data.order.filter(x => x !== id);
}
function moveSec(id, d) {
  const i = data.order.indexOf(id);
  const j = i + d;
  if (i < 0 || j < 0 || j >= data.order.length) return;
  [data.order[i], data.order[j]] = [data.order[j], data.order[i]];
}

function addItem(key) { data[key].push({ ...ENTRY_TPL[key] }); }
function delItem(key, i) { data[key].splice(i, 1); }
function moveItem(key, i, d) {
  const j = i + d;
  if (j < 0 || j >= data[key].length) return;
  [data[key][i], data[key][j]] = [data[key][j], data[key][i]];
}
function addCert() { data.certs.push({ name: '', date: '' }); }
function addCustomEntry(id) {
  data.custom.find(c => c.id === id)?.entries.push({ k: '', v: '' });
}
function delCustomEntry(id, i) {
  const c = data.custom.find(c => c.id === id);
  c?.entries.splice(i, 1);
}

/* ---- 头像 ---- */
const avatarInput = ref(null);
function onAvatar(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file || !/^image\//.test(file.type)) return;
  const img = new Image();
  img.onload = () => {
    const side = 300;
    const canvas = document.createElement('canvas');
    canvas.width = side; canvas.height = side;
    const ctx = canvas.getContext('2d');
    const min = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, side, side);
    data.avatar = canvas.toDataURL('image/jpeg', 0.85);
  };
  img.src = URL.createObjectURL(file);
}

/* ---- 示例 / 清空 ---- */
function fillSample() {
  Object.assign(data, {
    base: { name: '张三', job: '前端开发工程师', phone: '138-0000-0000', email: 'zhangsan@mail.com', city: '杭州', link: 'github.com/zhangsan' },
    summary: '四年前端开发经验，熟悉 Vue 技术栈与工程化体系，主导过中大型 C 端项目从 0 到 1 的搭建，关注性能与体验，乐于沉淀与分享。',
    skills: ['Vue3 / Vite', 'TypeScript', 'Node.js / Express', '性能优化', 'WebSocket'],
    work: [{
      company: '某某科技有限公司', role: '前端开发工程师', start: '2022.07', end: '至今',
      desc: '负责公司核心 SaaS 产品的前端开发与性能优化\n主导首屏加载优化，LCP 从 3.2s 降至 1.4s\n搭建组件库与脚手架，团队开发效率提升约 30%'
    }],
    projects: [{
      name: '聚合搜索平台', role: '前端负责人', start: '2023.03', end: '2024.01',
      desc: '多源聚合搜索工具，覆盖视频/音乐/书籍等频道\n设计全局播放器与跨页状态保持方案\n落地暗色主题体系与移动端适配'
    }],
    education: [{ school: '某某大学', major: '计算机科学与技术', degree: '本科', start: '2018.09', end: '2022.06' }],
    certs: [
      { name: '大学英语六级（CET-6）', date: '2019.06' },
      { name: 'PMP 项目管理认证', date: '2023.11' }
    ]
  });
  sync.value = { state: 'saving', at: '', err: '' };
  if (isCloud()) doCloudSave();
  else localSaveDoc(activeId.value, title.value, JSON.parse(JSON.stringify(data)));
}
function resetAll() {
  if (!confirm('确定清空当前简历的全部内容？')) return;
  applyData(defaultData());
  sync.value = { state: 'saving', at: '', err: '' };
  if (isCloud()) doCloudSave();
  else localSaveDoc(activeId.value, title.value, JSON.parse(JSON.stringify(data)));
}

/* ---- JSON 导入 / 导出 ---- */
function exportJson() {
  const blob = new Blob([JSON.stringify({ app: 'jusow-resume', title: title.value, data: JSON.parse(JSON.stringify(data)) }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (title.value || '简历') + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
const jsonInput = ref(null);
function importJson(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const j = JSON.parse(reader.result);
      const d = j.data || j;
      if (typeof d !== 'object' || !('base' in d)) throw new Error('不是本工具导出的简历文件');
      applyData(d);
      sync.value = { state: 'saving', at: '', err: '' };
      if (isCloud()) doCloudSave();
      else localSaveDoc(activeId.value, title.value, JSON.parse(JSON.stringify(data)));
      alert('导入成功');
    } catch (err) {
      alert('导入失败：' + (err.message || '文件格式不正确'));
    }
  };
  reader.readAsText(file);
}

function exportPdf() { window.print(); }

/* ---- 预览纸张随容器宽度缩放 ---- */
const paperEl = ref(null);
let ro = null;
const paperScale = ref(1);
onMounted(() => {
  ro = new ResizeObserver(([entry]) => {
    paperScale.value = Math.min(entry.contentRect.width / 794, 1);
  });
  nextTick(() => { if (paperEl.value) ro.observe(paperEl.value.parentElement); });
});
onUnmounted(() => ro?.disconnect());

onMounted(async () => {
  await initDocs();
  await nextTick();
  if (paperEl.value) ro.observe(paperEl.value.parentElement);
});
</script>

<template>
  <div class="rv container">
    <div class="rv-head">
      <h2 class="page-h"><AppIcon name="file-text" :size="22" class="h-icon" /> 在线简历</h2>
      <div class="rv-head-ops">
        <span v-if="sync.state === 'saving'" class="dim saved"><span class="spin"></span> 保存中…</span>
        <span v-else-if="sync.state === 'saved'" class="dim saved">已保存 {{ sync.at }}</span>
        <span v-else-if="sync.state === 'error'" class="saved sync-err">⚠ 同步失败，稍后自动重试</span>
        <span class="badge" :class="user ? 'green' : ''" :title="user ? '简历云端同步，跨设备可用' : '游客模式：简历保存在本机浏览器'">
          {{ user ? '云端同步' : '仅本机' }}
        </span>
      </div>
    </div>

    <!-- 文档管理栏 -->
    <div class="doc-bar">
      <select class="doc-select" :value="activeId" @change="switchDoc($event.target.value)" title="切换简历">
        <option v-for="d in docs" :key="d.docId || d.id" :value="d.docId || d.id">
          {{ d.title }}<template v-if="d.updatedAt"> · {{ new Date(d.updatedAt).toLocaleDateString('zh-CN') }}</template>
        </option>
      </select>
      <button class="btn small" title="新建空白简历" @click="createDoc()"><AppIcon name="plus" :size="12" /> 新建</button>
      <button class="btn small" title="复制当前简历" @click="copyDoc">复制</button>
      <button class="btn small" title="重命名当前简历" @click="renameDoc">重命名</button>
      <button class="btn small danger" title="删除当前简历" @click="deleteDoc">删除</button>
      <span class="doc-sep"></span>
      <button class="btn small" @click="exportJson"><AppIcon name="download" :size="12" /> 导出 JSON</button>
      <button class="btn small" @click="jsonInput?.click()">导入 JSON</button>
      <input ref="jsonInput" type="file" accept=".json,application/json" style="display:none" @change="importJson" />
      <span class="doc-sep"></span>
      <button class="btn small" @click="fillSample">填充示例</button>
      <button class="btn small" @click="resetAll">清空</button>
      <button class="btn small primary" @click="exportPdf"><AppIcon name="download" :size="13" /> 导出 PDF</button>
    </div>
    <p class="page-desc">左侧填写，右侧实时预览；板块可排序、可显隐、可自定义{{ user ? '；登录状态自动云端同步，换设备不丢' : '；当前游客身份保存在本机，登录后自动同步云端' }}。导出 PDF 时在打印对话框选择「另存为 PDF」。</p>

    <div v-if="loading" class="rv-loading dim"><span class="spin"></span> 正在载入简历…</div>

    <div v-else class="rv-wrap">
      <!-- 左：编辑区 -->
      <div class="rv-editor">
        <!-- 基本信息 -->
        <section class="rv-sec">
          <h3>基本信息</h3>
          <div class="base-row">
            <div class="avatar" @click="avatarInput?.click()" title="点击上传头像">
              <img v-if="data.avatar" :src="data.avatar" />
              <span v-else>头像</span>
            </div>
            <input ref="avatarInput" type="file" accept="image/*" style="display:none" @change="onAvatar" />
            <div class="base-grid">
              <label><span>姓名</span><input v-model="data.base.name" placeholder="张三" /></label>
              <label><span>求职意向</span><input v-model="data.base.job" placeholder="前端开发工程师" /></label>
              <label><span>电话</span><input v-model="data.base.phone" placeholder="138-0000-0000" /></label>
              <label><span>邮箱</span><input v-model="data.base.email" placeholder="name@mail.com" /></label>
              <label><span>城市</span><input v-model="data.base.city" placeholder="杭州" /></label>
              <label><span>主页 / GitHub</span><input v-model="data.base.link" placeholder="github.com/xxx" /></label>
            </div>
          </div>
        </section>

        <!-- 可排板块（按 order 渲染） -->
        <section v-for="sid in data.order" :key="sid" class="rv-sec" :class="{ off: !secEnabled(sid) }">
          <h3>
            {{ secTitle(sid) }}
            <span class="sec-ops">
              <button class="op" :title="secEnabled(sid) ? '隐藏该板块' : '显示该板块'" @click="data.secOn[sid] = secEnabled(sid) ? false : true">
                <AppIcon :name="secEnabled(sid) ? 'monitor' : 'x'" :size="12" />
              </button>
              <button class="op" title="上移" @click="moveSec(sid, -1)">↑</button>
              <button class="op" title="下移" @click="moveSec(sid, 1)">↓</button>
              <button v-if="sid.startsWith('c_')" class="op danger" title="删除板块" @click="removeCustomSec(sid)"><AppIcon name="x" :size="11" /></button>
              <button v-if="ENTRY_TPL[sid]" class="add" @click="addItem(sid)"><AppIcon name="plus" :size="12" /> 添加</button>
            </span>
          </h3>

          <!-- 个人优势 -->
          <template v-if="sid === 'summary'">
            <textarea v-model="data.summary" rows="4" placeholder="一两句话概括你的核心竞争力…" />
          </template>

          <!-- 技能 -->
          <template v-else-if="sid === 'skills'">
            <div class="tags">
              <span v-for="(s, i) in data.skills" :key="i" class="tag">
                {{ s }}
                <button class="tag-x" @click="data.skills.splice(i, 1)"><AppIcon name="x" :size="10" /></button>
              </span>
              <input
                class="tag-input" placeholder="输入技能后回车"
                @keydown.enter.prevent="e => { const v = e.target.value.trim(); if (v) { data.skills.push(v); e.target.value = ''; } }"
              />
            </div>
          </template>

          <!-- 工作 / 项目 -->
          <template v-else-if="sid === 'work' || sid === 'projects'">
            <div v-for="(it, i) in data[sid]" :key="i" class="entry">
              <div class="entry-ops">
                <button :disabled="i === 0" @click="moveItem(sid, i, -1)">↑</button>
                <button :disabled="i === data[sid].length - 1" @click="moveItem(sid, i, 1)">↓</button>
                <button class="danger" @click="delItem(sid, i)"><AppIcon name="x" :size="11" /></button>
              </div>
              <div class="grid3">
                <template v-if="sid === 'work'">
                  <label><span>公司</span><input v-model="it.company" /></label>
                  <label><span>职位</span><input v-model="it.role" /></label>
                </template>
                <template v-else>
                  <label><span>项目名称</span><input v-model="it.name" /></label>
                  <label><span>担任角色</span><input v-model="it.role" /></label>
                </template>
                <div class="date2">
                  <label><span>开始</span><input v-model="it.start" placeholder="2022.07" /></label>
                  <label><span>结束</span><input v-model="it.end" placeholder="至今" /></label>
                </div>
              </div>
              <textarea v-model="it.desc" rows="3" placeholder="内容与业绩，一行一条（可换行）" />
            </div>
            <p v-if="!data[sid].length" class="dim empty-tip">还没有条目，点右上角「添加」</p>
          </template>

          <!-- 教育 -->
          <template v-else-if="sid === 'education'">
            <div v-for="(ed, i) in data.education" :key="i" class="entry">
              <div class="entry-ops">
                <button :disabled="i === 0" @click="moveItem('education', i, -1)">↑</button>
                <button :disabled="i === data.education.length - 1" @click="moveItem('education', i, 1)">↓</button>
                <button class="danger" @click="delItem('education', i)"><AppIcon name="x" :size="11" /></button>
              </div>
              <div class="grid3">
                <label><span>学校</span><input v-model="ed.school" /></label>
                <label><span>专业</span><input v-model="ed.major" /></label>
                <label><span>学历</span><input v-model="ed.degree" placeholder="本科" /></label>
              </div>
              <div class="grid2">
                <label><span>开始</span><input v-model="ed.start" placeholder="2018.09" /></label>
                <label><span>结束</span><input v-model="ed.end" placeholder="2022.06" /></label>
              </div>
            </div>
          </template>

          <!-- 证书 / 获奖 -->
          <template v-else-if="sid === 'certs'">
            <div v-for="(c, i) in data.certs" :key="i" class="cert-row">
              <input v-model="c.name" placeholder="证书 / 获奖名称" />
              <input v-model="c.date" placeholder="2024.06" class="cert-date" />
              <button class="entry-ops-inline danger" @click="data.certs.splice(i, 1)"><AppIcon name="x" :size="11" /></button>
            </div>
            <button class="add" @click="addCert"><AppIcon name="plus" :size="12" /> 添加证书</button>
          </template>

          <!-- 自定义板块 -->
          <template v-else>
            <div class="grid3">
              <label><span>板块标题</span><input :value="data.custom.find(c => c.id === sid)?.title" @input="e => { const c = data.custom.find(c => c.id === sid); if (c) c.title = e.target.value; }" placeholder="如：兴趣爱好 / 校园经历" /></label>
            </div>
            <div v-for="(en, i) in (data.custom.find(c => c.id === sid)?.entries || [])" :key="i" class="cert-row">
              <input v-model="en.k" placeholder="条目（如：篮球 / 某奖项）" />
              <input v-model="en.v" placeholder="补充说明（可留空）" />
              <button class="entry-ops-inline danger" @click="delCustomEntry(sid, i)"><AppIcon name="x" :size="11" /></button>
            </div>
            <button class="add" @click="addCustomEntry(sid)"><AppIcon name="plus" :size="12" /> 添加条目</button>
          </template>
        </section>

        <!-- 添加自定义板块 -->
        <button class="btn add-custom" @click="addCustomSec"><AppIcon name="plus" :size="13" /> 添加自定义板块</button>

        <!-- 主题与排版 -->
        <section class="rv-sec">
          <h3>主题与排版</h3>
          <div class="theme-row">
            <span class="theme-label">主题色</span>
            <div class="accents">
              <button
                v-for="c in ACCENTS" :key="c"
                class="acc" :class="{ on: data.accent === c }"
                :style="{ background: c }"
                @click="data.accent = c"
              ></button>
            </div>
          </div>
          <div class="theme-row">
            <span class="theme-label">排版密度</span>
            <div class="densities">
              <button
                v-for="d in DENSITIES" :key="d.id"
                class="den" :class="{ on: data.density === d.id }"
                @click="data.density = d.id"
              >{{ d.name }}</button>
            </div>
          </div>
        </section>
      </div>

      <!-- 右：实时预览 -->
      <div class="rv-preview">
        <div class="paper-scaler" ref="paperEl">
          <div class="rv-paper" :class="'d-' + data.density" :style="{ '--accent': data.accent, transform: `scale(${paperScale})` }">
            <header class="p-head">
              <img v-if="data.avatar" class="p-avatar" :src="data.avatar" />
              <div class="p-head-main">
                <div class="p-name-row">
                  <span class="p-name">{{ data.base.name || '你的名字' }}</span>
                  <span v-if="data.base.job" class="p-job">{{ data.base.job }}</span>
                </div>
                <div class="p-contacts">
                  <span v-if="data.base.phone">📱 {{ data.base.phone }}</span>
                  <span v-if="data.base.email">✉️ {{ data.base.email }}</span>
                  <span v-if="data.base.city">📍 {{ data.base.city }}</span>
                  <span v-if="data.base.link">🔗 {{ data.base.link }}</span>
                </div>
              </div>
            </header>

            <template v-for="sid in data.order" :key="sid">
              <template v-if="secEnabled(sid)">
                <!-- 个人优势 -->
                <section v-if="sid === 'summary' && data.summary" class="p-sec">
                  <h4>个人优势</h4>
                  <p class="p-summary">{{ data.summary }}</p>
                </section>
                <!-- 技能 -->
                <section v-else-if="sid === 'skills' && data.skills.length" class="p-sec">
                  <h4>技能特长</h4>
                  <div class="p-tags"><span v-for="(s, i) in data.skills" :key="i">{{ s }}</span></div>
                </section>
                <!-- 工作 -->
                <section v-else-if="sid === 'work' && data.work.length" class="p-sec">
                  <h4>工作经历</h4>
                  <div v-for="(w, i) in data.work" :key="i" class="p-entry">
                    <div class="p-row"><b>{{ w.company }}</b><span v-if="w.role">{{ w.role }}</span><i class="p-date">{{ w.start }}{{ w.start || w.end ? ' ~ ' : '' }}{{ w.end }}</i></div>
                    <p v-if="w.desc" class="p-desc">{{ w.desc }}</p>
                  </div>
                </section>
                <!-- 项目 -->
                <section v-else-if="sid === 'projects' && data.projects.length" class="p-sec">
                  <h4>项目经历</h4>
                  <div v-for="(p, i) in data.projects" :key="i" class="p-entry">
                    <div class="p-row"><b>{{ p.name }}</b><span v-if="p.role">{{ p.role }}</span><i class="p-date">{{ p.start }}{{ p.start || p.end ? ' ~ ' : '' }}{{ p.end }}</i></div>
                    <p v-if="p.desc" class="p-desc">{{ p.desc }}</p>
                  </div>
                </section>
                <!-- 教育 -->
                <section v-else-if="sid === 'education' && data.education.length" class="p-sec">
                  <h4>教育背景</h4>
                  <div v-for="(ed, i) in data.education" :key="i" class="p-entry">
                    <div class="p-row"><b>{{ ed.school }}</b><span>{{ ed.major }}<template v-if="ed.degree"> · {{ ed.degree }}</template></span><i class="p-date">{{ ed.start }}{{ ed.start || ed.end ? ' ~ ' : '' }}{{ ed.end }}</i></div>
                  </div>
                </section>
                <!-- 证书 -->
                <section v-else-if="sid === 'certs' && data.certs.length" class="p-sec">
                  <h4>证书 / 获奖</h4>
                  <div v-for="(c, i) in data.certs" :key="i" class="p-entry">
                    <div class="p-row"><b>{{ c.name }}</b><i class="p-date">{{ c.date }}</i></div>
                  </div>
                </section>
                <!-- 自定义板块 -->
                <section v-else-if="sid.startsWith('c_')" class="p-sec">
                  <h4>{{ secTitle(sid) }}</h4>
                  <div v-for="(en, i) in (data.custom.find(c => c.id === sid)?.entries || [])" :key="i" class="p-entry">
                    <div class="p-row"><b v-if="en.k">{{ en.k }}</b><span v-if="en.v">{{ en.v }}</span></div>
                  </div>
                </section>
              </template>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rv { padding-top: 34px; animation: rise 0.35s ease; }
.page-h { display: flex; align-items: center; gap: 9px; margin: 0 0 6px; }
.h-icon { color: var(--gold); }
.rv-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.rv-head-ops { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.saved { font-size: 12px; display: inline-flex; align-items: center; gap: 6px; }
.sync-err { color: var(--red); }
.page-desc { color: var(--text-dim); margin: 10px 0 20px; font-size: 14px; line-height: 1.7; }
.rv-loading { padding: 60px 0; display: flex; align-items: center; justify-content: center; gap: 10px; }

/* ---- 文档管理栏 ---- */
.doc-bar {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  margin-bottom: 12px;
}
.doc-select {
  max-width: 240px;
  height: 32px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 13px;
  padding: 0 8px;
  outline: none;
  font-family: inherit;
}
.doc-sep { width: 1px; height: 20px; background: var(--border); margin: 0 2px; }

.rv-wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start; }
@media (max-width: 980px) { .rv-wrap { grid-template-columns: minmax(0, 1fr); } }

/* ---- 编辑区 ---- */
.rv-sec {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  margin-bottom: 14px;
}
.rv-sec.off { opacity: 0.5; }
.rv-sec h3 {
  display: flex; align-items: center; justify-content: space-between;
  margin: 0 0 12px; font-size: 14px; color: var(--gold);
}
.sec-ops { display: inline-flex; align-items: center; gap: 6px; }
.op {
  width: 24px; height: 24px;
  border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-faint);
  font-size: 12px;
  border: 1px solid var(--border);
}
.op:hover:not(:disabled) { color: var(--text); background: var(--hover); }
.op.danger:hover { color: var(--red); border-color: rgba(255, 107, 107, 0.4); }
.add {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: 999px;
  padding: 3px 10px;
}
.add:hover { color: var(--gold); border-color: rgba(242, 185, 75, 0.5); }
.add-custom { width: 100%; margin-bottom: 14px; border-style: dashed; }
.empty-tip { font-size: 12.5px; margin: 4px 0; }

.base-row { display: flex; gap: 14px; align-items: flex-start; }
.avatar {
  width: 64px; height: 64px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface-2);
  color: var(--text-faint); font-size: 12px;
  overflow: hidden; cursor: pointer;
  border: 1px dashed var(--border-strong);
}
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.base-grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--text-dim); min-width: 0; }
label input, label select { height: 32px; }
input, textarea, select {
  width: 100%;
  min-width: 0;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px;
  color: var(--text); font-size: 13px; outline: none;
  font-family: inherit;
  transition: border-color 0.15s;
}
input:focus, textarea:focus { border-color: rgba(242, 185, 75, 0.5); }
textarea { resize: vertical; line-height: 1.6; }
.grid3 { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 8px; margin-bottom: 8px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
.date2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
@media (max-width: 560px) {
  .grid3 { grid-template-columns: 1fr; }
  .base-grid { grid-template-columns: 1fr; }
}

.tags { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.tag {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 12px;
}
.tag-x { display: inline-flex; color: var(--text-faint); }
.tag-x:hover { color: var(--red); }
.tag-input { width: 150px; height: 30px; }

.cert-row {
  display: grid; grid-template-columns: 1fr 110px 30px;
  gap: 8px; align-items: center;
  margin-bottom: 8px;
}
.entry-ops-inline {
  width: 28px; height: 30px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 6px;
  color: var(--text-faint);
}
.entry-ops-inline:hover { color: var(--red); background: rgba(255, 107, 107, 0.1); }

.entry {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 10px;
  background: var(--surface-2);
}
.entry-ops {
  position: absolute; top: 8px; right: 8px;
  display: flex; gap: 4px;
}
.entry-ops button {
  width: 24px; height: 24px;
  border-radius: 6px;
  color: var(--text-faint);
  font-size: 12px;
  display: inline-flex; align-items: center; justify-content: center;
}
.entry-ops button:hover:not(:disabled) { color: var(--text); background: var(--hover); }
.entry-ops button:disabled { opacity: 0.3; }
.entry-ops .danger:hover { color: var(--red); background: rgba(255, 107, 107, 0.1); }

.theme-row { display: flex; align-items: center; gap: 14px; margin-bottom: 10px; }
.theme-row:last-child { margin-bottom: 0; }
.theme-label { font-size: 12.5px; color: var(--text-dim); width: 60px; flex-shrink: 0; }
.accents { display: flex; gap: 10px; }
.acc {
  width: 26px; height: 26px;
  border-radius: 50%;
  border: 2px solid transparent;
}
.acc.on { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--gold); }
.densities { display: flex; gap: 6px; }
.den {
  padding: 4px 14px;
  border-radius: 999px;
  font-size: 12.5px;
  color: var(--text-dim);
  border: 1px solid var(--border);
}
.den.on { color: var(--gold); border-color: rgba(242, 185, 75, 0.5); background: var(--gold-soft); }

/* ---- 预览区 ---- */
.rv-editor, .rv-preview { min-width: 0; }
.rv-preview { position: sticky; top: 76px; }
.paper-scaler { display: flex; justify-content: flex-start; overflow: hidden; }
.rv-paper {
  width: 794px;
  flex-shrink: 0;   /* 纸张布局盒不被 flex 压缩，缩放全靠 transform */
  min-height: 1123px;
  background: #ffffff;
  color: #2b2f36;
  border-radius: 6px;
  box-shadow: var(--shadow-2);
  padding: 48px 56px;
  /* 左上角为缩放原点：窄屏缩小后视觉盒不会向右溢出 */
  transform-origin: top left;
  font-size: 13px;
  line-height: 1.7;
}
.rv-paper.d-compact { font-size: 12px; padding: 38px 46px; }
.rv-paper.d-loose { font-size: 14px; padding: 58px 66px; }
.p-head { display: flex; gap: 18px; align-items: center; border-bottom: 2px solid var(--accent); padding-bottom: 16px; margin-bottom: 18px; }
.p-avatar { width: 72px; height: 72px; border-radius: 50%; object-fit: cover; }
.p-name-row { display: flex; align-items: baseline; gap: 12px; }
.p-name { font-size: 26px; font-weight: 800; color: var(--accent); letter-spacing: 1px; }
.p-job { font-size: 15px; font-weight: 600; color: #5a616c; }
.p-contacts { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 6px; color: #5a616c; font-size: 12px; }

.p-sec { margin-bottom: 18px; }
.p-sec h4 {
  font-size: 14px;
  color: var(--accent);
  border-left: 3px solid var(--accent);
  padding-left: 8px;
  margin: 0 0 8px;
}
.p-summary { margin: 0; white-space: pre-line; }
.p-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.p-tags span {
  padding: 2px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 10%, #ffffff);
  color: var(--accent);
  font-size: 12px;
}
.p-entry { margin-bottom: 10px; }
.p-row { display: flex; align-items: baseline; gap: 10px; }
.p-row b { font-size: 14px; }
.p-row span { color: #5a616c; font-size: 12.5px; }
.p-date { margin-left: auto; color: #8a919c; font-size: 12px; font-style: normal; white-space: nowrap; }
.p-desc { margin: 4px 0 0; white-space: pre-line; color: #454b54; }

@media (max-width: 980px) {
  .rv-preview { position: static; }
}

/* ---- 打印：只输出简历纸张（对话格里选「另存为 PDF」） ---- */
</style>
<style>
@media print {
  @page { size: A4; margin: 0; }
  body * { visibility: hidden; }
  .rv-paper, .rv-paper * { visibility: visible; }
  .rv-paper {
    position: absolute !important;
    left: 0; top: 0;
    transform: none !important;
    width: 210mm !important;
    min-height: 297mm;
    margin: 0 !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
</style>
