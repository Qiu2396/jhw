<script setup>
/**
 * 小工具版块：压缩图片 / PDF 转 Word / 一键抠图 / 抖音无水印。
 * 全部走后端成熟库（sharp / pdfjs+docx / imgly 本地模型 / 抖音解析代理），
 * 本组件负责交互：选文件（点选或拖拽）→ 调接口 → 预览与下载。
 */
import { ref, computed, onUnmounted } from 'vue';
import AppIcon from './AppIcon.vue';

const TOOLS = [
  { id: 'compress', icon: 'image', title: '压缩图片', desc: '画质可调、可限宽，透明图输出 WebP' },
  { id: 'pdf2word', icon: 'file-text', title: 'PDF 转 Word', desc: '提取文本生成可编辑的 .docx（扫描件不支持）' },
  { id: 'removebg', icon: 'scissors', title: '一键抠图', desc: '本地 AI 模型去背景，输出透明 PNG' },
  { id: 'douyin', icon: 'video', title: '抖音无水印', desc: '粘贴分享链接，解析无水印视频直接下载' },
  { id: 'resume', icon: 'user', title: '在线简历', desc: '左侧填写右侧实时预览，一键导出 PDF' }
];

const activeTool = ref('');
const running = ref(false);
const error = ref('');

// ---- 通用：文件选择（点选 + 拖拽） ----
const fileInput = ref(null);
let pickTarget = null;
const dragging = ref(false);
const pickedFile = ref(null);        // { file, previewUrl }
const fileAccept = ref('');

function pick(accept) {
  fileAccept.value = accept;
  pickTarget = accept;
  fileInput.value?.click();
}
function onPicked(e) {
  const f = e.target.files?.[0];
  if (f) setFile(f);
  e.target.value = '';
}
function setFile(f) {
  clearResult();
  error.value = '';
  const isImg = /^image\//.test(f.type);
  pickedFile.value = { file: f, previewUrl: isImg ? URL.createObjectURL(f) : '' };
}
function onDrop(e) {
  dragging.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  if (pickTarget === 'image' && !/^image\//.test(f.type)) { error.value = '请选择图片文件'; return; }
  if (pickTarget === 'pdf' && !/\.pdf$/i.test(f.name)) { error.value = '请选择 PDF 文件'; return; }
  setFile(f);
}
function clearFile() {
  if (pickedFile.value?.previewUrl) URL.revokeObjectURL(pickedFile.value.previewUrl);
  pickedFile.value = null;
}

// ---- 通用：结果与下载 ----
const result = ref(null);            // { blobUrl, filename, ...meta }
function clearResult() {
  if (result.value?.blobUrl) URL.revokeObjectURL(result.value.blobUrl);
  result.value = null;
}
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function fmtSize(n) {
  if (n == null) return '';
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}
async function postForm(url, form) {
  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res;
}

/* ---- 压缩图片 ---- */
const quality = ref(80);
const maxWidth = ref(0);
async function runCompress() {
  if (!pickedFile.value) return;
  running.value = true;
  error.value = '';
  try {
    const form = new FormData();
    form.append('file', pickedFile.value.file);
    form.append('quality', String(quality.value));
    form.append('maxWidth', String(maxWidth.value));
    const res = await postForm('/api/tools/compress', form);
    const blob = await res.blob();
    if (result.value?.blobUrl) URL.revokeObjectURL(result.value.blobUrl);
    result.value = {
      blob,
      blobUrl: URL.createObjectURL(blob),
      filename: `compressed.${res.headers.get('X-Output-Format') === 'webp' ? 'webp' : 'jpg'}`,
      origSize: Number(res.headers.get('X-Original-Size')),
      newSize: blob.size
    };
  } catch (e) {
    error.value = e.message;
  } finally {
    running.value = false;
  }
}
const savedPct = computed(() => {
  if (!result.value?.origSize) return '';
  const p = Math.round((1 - result.value.newSize / result.value.origSize) * 100);
  return p > 0 ? `小了 ${p}%` : `（原文件已优化良好）`;
});

/* ---- PDF 转 Word ---- */
async function runPdf2Word() {
  if (!pickedFile.value) return;
  running.value = true;
  error.value = '';
  try {
    const form = new FormData();
    form.append('file', pickedFile.value.file);
    const res = await postForm('/api/tools/pdf2word', form);
    const blob = await res.blob();
    const name = (pickedFile.value.file.name || 'document.pdf').replace(/\.pdf$/i, '') + '.docx';
    saveBlob(blob, name);
    result.value = {
      blobUrl: '',
      filename: name,
      pages: res.headers.get('X-Pages'),
      textLen: res.headers.get('X-Text-Length'),
      saved: true
    };
  } catch (e) {
    error.value = e.message;
  } finally {
    running.value = false;
  }
}

/* ---- 一键抠图 ---- */
async function runRemoveBg() {
  if (!pickedFile.value) return;
  running.value = true;
  error.value = '';
  try {
    const form = new FormData();
    form.append('file', pickedFile.value.file);
    const res = await postForm('/api/tools/removebg', form);
    const blob = await res.blob();
    if (result.value?.blobUrl) URL.revokeObjectURL(result.value.blobUrl);
    result.value = {
      blobUrl: URL.createObjectURL(blob),
      filename: (pickedFile.value.file.name || 'image').replace(/\.[^.]+$/, '') + '_抠图.png'
    };
  } catch (e) {
    error.value = e.message;
  } finally {
    running.value = false;
  }
}

/* ---- 抖音无水印 ---- */
const douyinLink = ref('');
const douyinInfo = ref(null);
async function runDouyin() {
  if (!douyinLink.value.trim() || running.value) return;
  running.value = true;
  error.value = '';
  douyinInfo.value = null;
  clearResult();
  try {
    const res = await fetch('/api/tools/douyin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: douyinLink.value })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || '解析失败');
    douyinInfo.value = d;
  } catch (e) {
    error.value = e.message;
  } finally {
    running.value = false;
  }
}
function douyinProxy(download) {
  return `/api/tools/douyin/file?download=${download ? 1 : 0}&u=${encodeURIComponent(douyinInfo.value.playUrl)}`;
}

function openTool(id) {
  if (id === 'resume') { location.hash = '#/resume'; return; }   // 简历是独立编辑器页面
  activeTool.value = id;
  error.value = '';
  clearFile();
  clearResult();
  douyinInfo.value = null;
  douyinLink.value = '';
}
function backToList() {
  activeTool.value = '';
  clearFile();
  clearResult();
  error.value = '';
  douyinInfo.value = null;
}
onUnmounted(() => {
  clearFile();
  clearResult();
});
</script>

<template>
  <div class="tools container">
    <h2 class="page-h"><AppIcon name="wrench" :size="22" class="h-icon" /> 小工具</h2>
    <p class="page-desc">本地运行的实用小工具：图片压缩、格式转换、AI 抠图、无水印视频。文件不经过任何第三方服务器。</p>

    <!-- 工具首页 -->
    <template v-if="!activeTool">
      <div class="t-grid">
        <div v-for="t in TOOLS" :key="t.id" class="t-card" @click="openTool(t.id)">
          <div class="t-icon"><AppIcon :name="t.icon" :size="26" /></div>
          <div class="t-title">{{ t.title }}</div>
          <div class="t-desc dim">{{ t.desc }}</div>
        </div>
      </div>
    </template>

    <!-- 工作台 -->
    <template v-else>
      <div class="work-head">
        <button class="btn small" @click="backToList"><AppIcon name="arrow-left" :size="13" /> 全部工具</button>
        <b class="work-title">{{ TOOLS.find(t => t.id === activeTool)?.title }}</b>
      </div>

      <p v-if="error" class="t-error">⚠ {{ error }}</p>

      <!-- 压缩图片 -->
      <div v-if="activeTool === 'compress'" class="work">
        <div
          class="drop"
          :class="{ drag: dragging, filled: pickedFile }"
          @click="!pickedFile && pick('image')"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
        >
          <template v-if="!pickedFile">
            <AppIcon name="image" :size="30" class="drop-ic" />
            <p>点击选择或拖入图片（JPG / PNG / WebP）</p>
          </template>
          <template v-else>
            <img :src="pickedFile.previewUrl" class="drop-preview" />
            <div class="drop-file">
              {{ pickedFile.file.name }} <span class="dim">({{ fmtSize(pickedFile.file.size) }})</span>
              <button class="t-del" title="移除" @click.stop="clearFile"><AppIcon name="x" :size="12" /></button>
            </div>
          </template>
        </div>

        <div class="opts" v-if="pickedFile">
          <label class="opt">
            <span>画质 {{ quality }}</span>
            <input type="range" min="10" max="95" step="5" v-model="quality" />
          </label>
          <label class="opt">
            <span>限制宽度</span>
            <select v-model.number="maxWidth">
              <option :value="0">保持原尺寸</option>
              <option :value="1920">1920px</option>
              <option :value="1280">1280px</option>
              <option :value="800">800px</option>
            </select>
          </label>
          <button class="btn primary" :disabled="running" @click="runCompress">
            <span v-if="running" class="spin"></span> 开始压缩
          </button>
        </div>

        <div v-if="result" class="result">
          <img :src="result.blobUrl" class="result-img" />
          <div class="result-meta">
            <div>{{ fmtSize(result.origSize) }} → <b>{{ fmtSize(result.newSize) }}</b> <span class="badge gold">{{ savedPct }}</span></div>
            <a class="btn primary" :href="result.blobUrl" :download="result.filename">
              <AppIcon name="download" :size="14" /> 保存图片
            </a>
          </div>
        </div>
      </div>

      <!-- PDF 转 Word -->
      <div v-else-if="activeTool === 'pdf2word'" class="work">
        <div
          class="drop"
          :class="{ drag: dragging, filled: pickedFile }"
          @click="!pickedFile && pick('pdf')"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
        >
          <template v-if="!pickedFile">
            <AppIcon name="file-text" :size="30" class="drop-ic" />
            <p>点击选择或拖入 PDF 文件（纯文本型，扫描件不支持）</p>
          </template>
          <div v-else class="drop-file big">
            <AppIcon name="file-text" :size="22" class="drop-ic" />
            {{ pickedFile.file.name }} <span class="dim">({{ fmtSize(pickedFile.file.size) }})</span>
            <button class="t-del" title="移除" @click.stop="clearFile"><AppIcon name="x" :size="12" /></button>
          </div>
        </div>
        <div class="opts" v-if="pickedFile">
          <button class="btn primary" :disabled="running" @click="runPdf2Word">
            <span v-if="running" class="spin"></span> 转换为 Word
          </button>
        </div>
        <div v-if="result" class="result">
          <div class="result-meta">
            <div>转换完成：{{ result.pages }} 页 · 约 {{ result.textLen }} 字，已开始下载 <b>{{ result.filename }}</b></div>
          </div>
        </div>
      </div>

      <!-- 一键抠图 -->
      <div v-else-if="activeTool === 'removebg'" class="work">
        <div
          class="drop"
          :class="{ drag: dragging, filled: pickedFile }"
          @click="!pickedFile && pick('image')"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
        >
          <template v-if="!pickedFile">
            <AppIcon name="scissors" :size="30" class="drop-ic" />
            <p>点击选择或拖入图片（人像 / 物体抠图，首次使用会下载本地模型）</p>
          </template>
          <template v-else>
            <img :src="pickedFile.previewUrl" class="drop-preview" />
            <div class="drop-file">
              {{ pickedFile.file.name }} <span class="dim">({{ fmtSize(pickedFile.file.size) }})</span>
              <button class="t-del" title="移除" @click.stop="clearFile"><AppIcon name="x" :size="12" /></button>
            </div>
          </template>
        </div>
        <div class="opts" v-if="pickedFile">
          <button class="btn primary" :disabled="running" @click="runRemoveBg">
            <span v-if="running" class="spin"></span> 开始抠图
          </button>
        </div>
        <div v-if="result" class="result">
          <div class="pair">
            <div class="pair-box"><img :src="pickedFile?.previewUrl" /></div>
            <div class="pair-box checker"><img :src="result.blobUrl" /></div>
          </div>
          <div class="result-meta">
            <div>抠图完成（右侧透明底）</div>
            <a class="btn primary" :href="result.blobUrl" :download="result.filename">下载 PNG</a>
          </div>
        </div>
      </div>

      <!-- 抖音无水印 -->
      <div v-else-if="activeTool === 'douyin'" class="work">
        <form class="d-form" @submit.prevent="runDouyin">
          <input
            v-model="douyinLink"
            placeholder="粘贴抖音分享链接或整段分享文案"
          />
          <button class="btn primary" type="submit" :disabled="running">
            <span v-if="running" class="spin"></span> 解析
          </button>
        </form>
        <div v-if="douyinInfo" class="result dy">
          <img v-if="douyinInfo.cover" :src="douyinInfo.cover" class="dy-cover" />
          <div class="dy-info">
            <div class="dy-title">{{ douyinInfo.title || '（无标题）' }}</div>
            <div class="dim" v-if="douyinInfo.author">作者：{{ douyinInfo.author }}</div>
            <video class="dy-video" :src="douyinProxy(false)" controls preload="metadata"></video>
            <a class="btn primary" :href="douyinProxy(true)" download="抖音无水印.mp4">
              <AppIcon name="download" :size="14" /> 下载无水印视频
            </a>
          </div>
        </div>
      </div>
    </template>

    <!-- 隐藏文件选择器 -->
    <input ref="fileInput" type="file" :accept="fileAccept" style="display: none" @change="onPicked" />
  </div>
</template>

<style scoped>
.tools { padding-top: 34px; animation: rise 0.35s ease both; }
h2 { margin: 0 0 6px; }
.page-h { display: flex; align-items: center; gap: 9px; }
.h-icon { color: var(--gold); }
.page-desc { color: var(--text-dim); margin: 0 0 24px; font-size: 14px; }

/* 工具卡片 */
.t-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}
.t-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 26px 24px;
  cursor: pointer;
  transition: all 0.2s;
}
.t-card:hover {
  border-color: rgba(242, 185, 75, 0.45);
  transform: translateY(-3px);
  box-shadow: var(--shadow-1);
}
.t-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px; height: 52px;
  border-radius: 14px;
  color: var(--gold);
  background: var(--gold-soft);
  border: 1px solid var(--border);
  margin-bottom: 14px;
}
.t-title { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
.t-desc { font-size: 13px; line-height: 1.7; }

/* 工作台 */
.work-head { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.work-title { font-size: 17px; }
.work { max-width: 760px; }
.t-error { color: var(--red); font-size: 14px; margin: 0 0 14px; }

.drop {
  border: 2px dashed var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  min-height: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-dim);
  font-size: 14px;
  cursor: pointer;
  padding: 20px;
  text-align: center;
  transition: all 0.15s;
}
.drop.drag { border-color: var(--gold); background: var(--gold-soft); }
.drop.filled { cursor: default; }
.drop-ic { color: var(--gold); }
.drop-preview { max-width: 100%; max-height: 200px; border-radius: 8px; }
.drop-file { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text); }
.drop-file.big { flex-wrap: wrap; justify-content: center; }
.t-del {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  border-radius: 6px;
  color: var(--text-faint);
}
.t-del:hover { color: var(--red); background: rgba(255, 107, 107, 0.1); }

.opts {
  display: flex;
  align-items: center;
  gap: 22px;
  margin: 16px 0;
  flex-wrap: wrap;
}
.opt { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-dim); }
.opt input[type='range'] { width: 140px; accent-color: var(--gold); }
.opt select {
  height: 32px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  padding: 0 8px;
  font-family: inherit;
}

.result {
  margin-top: 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
}
.result-img { max-width: 100%; max-height: 320px; border-radius: 8px; display: block; margin-bottom: 12px; }
.result-meta { display: flex; align-items: center; gap: 14px; font-size: 14px; flex-wrap: wrap; }

.pair { display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.pair-box { flex: 1; min-width: 200px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
.pair-box img { width: 100%; display: block; }
.checker {
  background-image:
    linear-gradient(45deg, var(--surface-3) 25%, transparent 25%),
    linear-gradient(-45deg, var(--surface-3) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--surface-3) 75%),
    linear-gradient(-45deg, transparent 75%, var(--surface-3) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}

/* 抖音 */
.d-form { display: flex; gap: 10px; }
.d-form input {
  flex: 1;
  height: 38px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0 14px;
  color: var(--text); font-size: 14px; outline: none;
}
.d-form input:focus { border-color: rgba(242, 185, 75, 0.5); }
.dy { display: flex; gap: 16px; flex-wrap: wrap; }
.dy-cover { width: 140px; border-radius: 8px; align-self: flex-start; }
.dy-info { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 10px; }
.dy-title { font-size: 15px; font-weight: 600; }
.dy-video { width: 100%; max-width: 360px; border-radius: 8px; background: #000; }

@media (max-width: 600px) {
  .d-form { flex-direction: column; }
}
</style>
