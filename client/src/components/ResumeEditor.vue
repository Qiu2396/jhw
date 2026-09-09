<script setup>
/**
 * 在线简历编辑器：左侧编辑 / 右侧实时预览 / 一键导出 PDF。
 * 数据自动保存在本机浏览器（localStorage），不经任何服务器。
 * 导出走浏览器打印管线（打印对话框里选「另存为 PDF」），生成可选中文字的矢量 PDF。
 */
import { reactive, ref, watch, onMounted, onUnmounted } from 'vue';
import AppIcon from './AppIcon.vue';

const STORAGE_KEY = 'resume_data_v1';
const ACCENTS = ['#2f6fed', '#0e9f8a', '#7c3aed', '#e0553c', '#c99416', '#333333'];

const defaultData = () => ({
  base: { name: '', job: '', phone: '', email: '', city: '', link: '' },
  avatar: '',
  summary: '',
  skills: [],
  work: [],      // { company, role, start, end, desc }
  projects: [],  // { name, role, start, end, desc }
  education: []  // { school, major, degree, start, end }
});

const data = reactive(defaultData());
const savedAt = ref('');
const accent = ref(localStorage.getItem('resume_accent') || ACCENTS[0]);

onMounted(() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(data, JSON.parse(raw));
  } catch { /* 损坏则用默认 */ }
});
watch(data, () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* 容量满忽略 */ }
  savedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false });
}, { deep: true });
watch(accent, v => localStorage.setItem('resume_accent', v));

const avatarInput = ref(null);
function onAvatar(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file || !/^image\//.test(file.type)) return;
  // 压到 300px 方图再存 base64，避免 localStorage 膨胀
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

/* ---- 条目增删与排序 ---- */
const TPL = {
  work: { company: '', role: '', start: '', end: '', desc: '' },
  projects: { name: '', role: '', start: '', end: '', desc: '' },
  education: { school: '', major: '', degree: '', start: '', end: '' }
};
function addItem(key) { data[key].push({ ...TPL[key] }); }
function delItem(key, i) { data[key].splice(i, 1); }
function moveItem(key, i, d) {
  const j = i + d;
  if (j < 0 || j >= data[key].length) return;
  [data[key][i], data[key][j]] = [data[key][j], data[key][i]];
}

function fillSample() {
  Object.assign(data, {
    base: { name: '张三', job: '前端开发工程师', phone: '138-0000-0000', email: 'zhangsan@mail.com', city: '杭州', link: 'github.com/zhangsan' },
    avatar: '',
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
    education: [{ school: '某某大学', major: '计算机科学与技术', degree: '本科', start: '2018.09', end: '2022.06' }]
  });
}
function resetAll() {
  if (!confirm('确定清空当前简历内容？')) return;
  Object.assign(data, defaultData());
}

function exportPdf() {
  window.print();
}

// 预览纸张随容器宽度缩放（保持 A4 视觉比例）
const paperEl = ref(null);
let ro = null;
const paperScale = ref(1);
onMounted(() => {
  ro = new ResizeObserver(([entry]) => {
    paperScale.value = Math.min(entry.contentRect.width / 794, 1);
  });
  if (paperEl.value) ro.observe(paperEl.value.parentElement);
});
onUnmounted(() => ro?.disconnect());
</script>

<template>
  <div class="rv container">
    <div class="rv-head">
      <h2 class="page-h"><AppIcon name="file-text" :size="22" class="h-icon" /> 在线简历</h2>
      <div class="rv-head-ops">
        <span v-if="savedAt" class="dim saved">已自动保存 {{ savedAt }}</span>
        <button class="btn small" @click="fillSample">填充示例</button>
        <button class="btn small" @click="resetAll">清空</button>
        <button class="btn primary" @click="exportPdf"><AppIcon name="download" :size="14" /> 导出 PDF</button>
      </div>
    </div>
    <p class="page-desc">左侧填写，右侧实时预览；数据只保存在本机浏览器。导出时在打印对话框选择「另存为 PDF」。</p>

    <div class="rv-wrap">
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

        <!-- 个人优势 -->
        <section class="rv-sec">
          <h3>个人优势</h3>
          <textarea v-model="data.summary" rows="4" placeholder="一两句话概括你的核心竞争力…" />
        </section>

        <!-- 技能特长 -->
        <section class="rv-sec">
          <h3>技能特长</h3>
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
        </section>

        <!-- 工作经历 -->
        <section class="rv-sec">
          <h3>工作经历 <button class="add" @click="addItem('work')"><AppIcon name="plus" :size="12" /> 添加</button></h3>
          <div v-for="(w, i) in data.work" :key="i" class="entry">
            <div class="entry-ops">
              <button :disabled="i === 0" @click="moveItem('work', i, -1)">↑</button>
              <button :disabled="i === data.work.length - 1" @click="moveItem('work', i, 1)">↓</button>
              <button class="danger" @click="delItem('work', i)"><AppIcon name="x" :size="11" /></button>
            </div>
            <div class="grid3">
              <label><span>公司</span><input v-model="w.company" /></label>
              <label><span>职位</span><input v-model="w.role" /></label>
              <div class="date2">
                <label><span>开始</span><input v-model="w.start" placeholder="2022.07" /></label>
                <label><span>结束</span><input v-model="w.end" placeholder="至今" /></label>
              </div>
            </div>
            <textarea v-model="w.desc" rows="3" placeholder="工作内容与业绩，一行一条（可换行）" />
          </div>
        </section>

        <!-- 项目经历 -->
        <section class="rv-sec">
          <h3>项目经历 <button class="add" @click="addItem('projects')"><AppIcon name="plus" :size="12" /> 添加</button></h3>
          <div v-for="(p, i) in data.projects" :key="i" class="entry">
            <div class="entry-ops">
              <button :disabled="i === 0" @click="moveItem('projects', i, -1)">↑</button>
              <button :disabled="i === data.projects.length - 1" @click="moveItem('projects', i, 1)">↓</button>
              <button class="danger" @click="delItem('projects', i)"><AppIcon name="x" :size="11" /></button>
            </div>
            <div class="grid3">
              <label><span>项目名称</span><input v-model="p.name" /></label>
              <label><span>担任角色</span><input v-model="p.role" /></label>
              <div class="date2">
                <label><span>开始</span><input v-model="p.start" /></label>
                <label><span>结束</span><input v-model="p.end" /></label>
              </div>
            </div>
            <textarea v-model="p.desc" rows="3" placeholder="项目描述与你的贡献，一行一条（可换行）" />
          </div>
        </section>

        <!-- 教育背景 -->
        <section class="rv-sec">
          <h3>教育背景 <button class="add" @click="addItem('education')"><AppIcon name="plus" :size="12" /> 添加</button></h3>
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
        </section>

        <!-- 主题色 -->
        <section class="rv-sec">
          <h3>主题色</h3>
          <div class="accents">
            <button
              v-for="c in ACCENTS" :key="c"
              class="acc" :class="{ on: accent === c }"
              :style="{ background: c }"
              @click="accent = c"
            ></button>
          </div>
        </section>
      </div>

      <!-- 右：实时预览 -->
      <div class="rv-preview">
        <div class="paper-scaler" ref="paperEl">
          <div class="rv-paper" :style="{ '--accent': accent, transform: `scale(${paperScale})` }">
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

            <section v-if="data.summary" class="p-sec">
              <h4>个人优势</h4>
              <p class="p-summary">{{ data.summary }}</p>
            </section>

            <section v-if="data.skills.length" class="p-sec">
              <h4>技能特长</h4>
              <div class="p-tags"><span v-for="(s, i) in data.skills" :key="i">{{ s }}</span></div>
            </section>

            <section v-if="data.work.length" class="p-sec">
              <h4>工作经历</h4>
              <div v-for="(w, i) in data.work" :key="i" class="p-entry">
                <div class="p-row"><b>{{ w.company }}</b><span v-if="w.role">{{ w.role }}</span><i class="p-date">{{ w.start }}{{ w.start || w.end ? ' ~ ' : '' }}{{ w.end }}</i></div>
                <p class="p-desc">{{ w.desc }}</p>
              </div>
            </section>

            <section v-if="data.projects.length" class="p-sec">
              <h4>项目经历</h4>
              <div v-for="(p, i) in data.projects" :key="i" class="p-entry">
                <div class="p-row"><b>{{ p.name }}</b><span v-if="p.role">{{ p.role }}</span><i class="p-date">{{ p.start }}{{ p.start || p.end ? ' ~ ' : '' }}{{ p.end }}</i></div>
                <p class="p-desc">{{ p.desc }}</p>
              </div>
            </section>

            <section v-if="data.education.length" class="p-sec">
              <h4>教育背景</h4>
              <div v-for="(ed, i) in data.education" :key="i" class="p-entry">
                <div class="p-row"><b>{{ ed.school }}</b><span>{{ ed.major }}<template v-if="ed.degree"> · {{ ed.degree }}</template></span><i class="p-date">{{ ed.start }}{{ ed.start || ed.end ? ' ~ ' : '' }}{{ ed.end }}</i></div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rv { padding-top: 34px; animation: rise 0.35s ease both; }
.page-h { display: flex; align-items: center; gap: 9px; margin: 0 0 6px; }
.h-icon { color: var(--gold); }
.rv-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.rv-head-ops { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.saved { font-size: 12px; }
.page-desc { color: var(--text-dim); margin: 0 0 20px; font-size: 14px; }

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
.rv-sec h3 {
  display: flex; align-items: center; justify-content: space-between;
  margin: 0 0 12px; font-size: 14px; color: var(--gold);
}
.add {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: 999px;
  padding: 3px 10px;
}
.add:hover { color: var(--gold); border-color: rgba(242, 185, 75, 0.5); }

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

.accents { display: flex; gap: 10px; }
.acc {
  width: 26px; height: 26px;
  border-radius: 50%;
  border: 2px solid transparent;
}
.acc.on { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--gold); }

/* ---- 预览区 ---- */
.rv-editor, .rv-preview { min-width: 0; }
.rv-preview { position: sticky; top: 76px; }
.paper-scaler { display: flex; justify-content: center; overflow: hidden; }
.rv-paper {
  width: 794px;
  min-height: 1123px;
  background: #ffffff;
  color: #2b2f36;
  border-radius: 6px;
  box-shadow: var(--shadow-2);
  padding: 48px 56px;
  transform-origin: top center;
  font-size: 13px;
  line-height: 1.7;
}
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
