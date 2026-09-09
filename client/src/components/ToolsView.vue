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
  { id: 'resume', icon: 'user', title: '在线简历', desc: '多份简历云同步，板块可排序，一键导出 PDF' },
  { id: 'json', icon: 'braces', title: 'JSON 工具', desc: '格式化 / 压缩 / 校验，错误定位到行列' },
  { id: 'timestamp', icon: 'clock', title: '时间戳转换', desc: 'Unix 时间戳与日期时间双向换算' },
  { id: 'base64', icon: 'code', title: '编解码工具', desc: 'Base64 / URL 编码解码，支持中文' },
  { id: 'uuid', icon: 'key', title: 'UUID / 密码', desc: '随机 UUID 与强密码批量生成' },
  { id: 'regex', icon: 'search', title: '正则测试', desc: '实时匹配测试，列出全部命中' },
  { id: 'hash', icon: 'hash', title: 'Hash 计算', desc: 'SHA-1 / 256 / 512，支持文本与文件' },
  { id: 'color', icon: 'droplet', title: '颜色转换', desc: 'HEX / RGB / HSL 互转，实时预览' },
  { id: 'diff', icon: 'list', title: '文本对比', desc: '两段文本逐行对比，标出差异' }
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

/* ================= 开发 / 实用小工具（全部本地计算，零依赖） ================= */

/* ---- JSON 工具 ---- */
const jsonInput = ref('');
const jsonOut = ref('');
const jsonErr = ref('');
function jsonRun(mode) {
  jsonErr.value = '';
  jsonOut.value = '';
  const s = jsonInput.value.trim();
  if (!s) { jsonErr.value = '请先粘贴 JSON 内容'; return; }
  try {
    const obj = JSON.parse(s);
    jsonOut.value = mode === 'min' ? JSON.stringify(obj) : JSON.stringify(obj, null, 2);
  } catch (e) {
    const m = /position (\d+)/.exec(e.message);
    if (m) {
      const pos = Number(m[1]);
      const before = s.slice(0, pos);
      const line = before.split('\n').length;
      const col = pos - before.lastIndexOf('\n');
      jsonErr.value = `语法错误：第 ${line} 行第 ${col} 列附近 — ${e.message.slice(0, 80)}`;
    } else {
      jsonErr.value = e.message.slice(0, 120);
    }
  }
}

/* ---- 时间戳转换 ---- */
const tsInput = ref('');
const tsOutput = ref('');
const tsDate = ref('');             // datetime-local 值
const nowTimer = ref(null);
const nowStr = ref('');
function tsFromStamp() {
  const n = Number(tsInput.value.trim());
  if (!isFinite(n) || n <= 0) { tsOutput.value = ''; return; }
  const ms = n >= 1e12 ? n : n * 1000;          // 13 位毫秒 / 10 位秒
  const d = new Date(ms);
  tsOutput.value = isNaN(d.getTime()) ? '无效时间戳' : d.toLocaleString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}
function tsFromDate() {
  if (!tsDate.value) { tsOutput.value = ''; return; }
  const d = new Date(tsDate.value);
  tsOutput.value = isNaN(d.getTime()) ? '无效日期' : `秒 ${Math.floor(d.getTime() / 1000)} · 毫秒 ${d.getTime()}`;
}
function tsNow() {
  const d = new Date();
  nowStr.value = d.toLocaleString('zh-CN', { hour12: false }) + `  |  秒 ${Math.floor(d.getTime() / 1000)}  毫秒 ${d.getTime()}`;
}

/* ---- 编解码（Base64 / URL） ---- */
const encMode = ref('b64e');
const encInput = ref('');
const encOutput = ref('');
const encErr = ref('');
function encRun() {
  encErr.value = '';
  encOutput.value = '';
  const s = encInput.value;
  if (!s) return;
  try {
    if (encMode.value === 'b64e') {
      encOutput.value = btoa(String.fromCharCode(...new TextEncoder().encode(s)));
    } else if (encMode.value === 'b64d') {
      const bytes = Uint8Array.from(atob(s.replace(/\s+/g, '')), c => c.charCodeAt(0));
      encOutput.value = new TextDecoder().decode(bytes);
    } else if (encMode.value === 'urle') {
      encOutput.value = encodeURIComponent(s);
    } else {
      encOutput.value = decodeURIComponent(s.replace(/\+/g, ' '));
    }
  } catch (e) {
    encErr.value = '解码失败：内容不是合法的编码文本';
  }
}

/* ---- UUID / 密码生成 ---- */
const uuidList = ref([]);
const pwLength = ref(16);
const pwSets = ref({ upper: true, lower: true, digit: true, symbol: true });
const pwList = ref([]);
function genUuid(n = 5) {
  uuidList.value = Array.from({ length: n }, () =>
    (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }))
  );
}
function copyText(t) {
  navigator.clipboard?.writeText(t);
}
function genPw(n = 5) {
  const pools = {
    upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ', lower: 'abcdefghijkmnpqrstuvwxyz',
    digit: '23456789', symbol: '!@#$%^&*?-_=+'
  };
  const chars = Object.entries(pwSets.value).filter(([, on]) => on).map(([k]) => pools[k]).join('');
  if (!chars) { pwList.value = []; return; }
  const rand = new Uint32Array(pwLength.value * n);
  crypto.getRandomValues(rand);
  pwList.value = Array.from({ length: n }, (_, i) =>
    Array.from({ length: pwLength.value }, (_, j) => chars[rand[i * pwLength.value + j] % chars.length]).join('')
  );
}

/* ---- 正则测试 ---- */
const rePattern = ref('');
const reFlags = ref('g');
const reText = ref('');
const reMatches = computed(() => {
  if (!rePattern.value || !reText.value) return [];
  try {
    const re = new RegExp(rePattern.value, reFlags.value.includes('g') ? reFlags.value : reFlags.value + 'g');
    return [...reText.value.matchAll(re)].slice(0, 200).map(m => ({
      text: m[0],
      index: m.index,
      groups: m.slice(1).filter(g => g !== undefined)
    }));
  } catch {
    return null;    // 正则语法错误
  }
});

/* ---- Hash 计算 ---- */
const hashInput = ref('');
const hashFile = ref(null);
const hashOut = ref({});
const hashRunning = ref(false);
async function hashRun() {
  const algo = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];
  hashOut.value = {};
  if (!hashInput.value && !hashFile.value) return;
  hashRunning.value = true;
  try {
    const data = hashFile.value
      ? await hashFile.value.arrayBuffer()
      : new TextEncoder().encode(hashInput.value);
    for (const a of algo) {
      const buf = await crypto.subtle.digest(a, data);
      hashOut.value[a] = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {
    hashOut.value = { error: e.message };
  } finally {
    hashRunning.value = false;
  }
}
function onHashFile(e) {
  hashFile.value = e.target.files?.[0] || null;
  hashInput.value = '';
  hashOut.value = {};
}

/* ---- 颜色转换 ---- */
const colorHex = ref('#2f6fed');
const colorRgb = computed(() => {
  const m = /^#?([0-9a-f]{6})$/i.exec(colorHex.value.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
});
const colorHsl = computed(() => {
  if (!colorRgb.value) return null;
  const { r, g, b } = colorRgb.value;
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const dd = max - min;
  const s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
  let h;
  if (max === R) h = ((G - B) / dd + (G < B ? 6 : 0));
  else if (max === G) h = (B - R) / dd + 2;
  else h = (R - G) / dd + 4;
  return { h: Math.round(h * 60), s: Math.round(s * 100), l: Math.round(l * 100) };
});
const colorError = computed(() => {
  return /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.test(colorHex.value.trim()) ? '' : '请输入 6 位 HEX 颜色值，如 #2f6fed';
});

/* ---- 文本对比 ---- */
const diffLeft = ref('');
const diffRight = ref('');
const diffResult = computed(() => {
  const a = diffLeft.value.split('\n');
  const b = diffRight.value.split('\n');
  if (a.length * b.length > 250000) return null;   // 防卡死
  // LCS DP
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: 'same', s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: 'del', s: a[i] }); i++; }
    else { out.push({ t: 'add', s: b[j] }); j++; }
  }
  while (i < n) out.push({ t: 'del', s: a[i++] });
  while (j < m) out.push({ t: 'add', s: b[j++] });
  return out;
});
const diffStats = computed(() => {
  const r = diffResult.value;
  if (!r) return { add: 0, del: 0, same: 0 };
  const c = { add: 0, del: 0, same: 0 };
  for (const x of r) c[x.t]++;
  return c;
});

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

      <!-- JSON 工具 -->
      <div v-else-if="activeTool === 'json'" class="work">
        <textarea v-model="jsonInput" class="big-ta" rows="9" placeholder='粘贴 JSON，如 {"name":"聚搜王","ok":true}' />
        <div class="opts">
          <button class="btn primary" @click="jsonRun('pretty')">格式化</button>
          <button class="btn" @click="jsonRun('min')">压缩</button>
          <button v-if="jsonOut" class="btn" @click="copyText(jsonOut)">复制结果</button>
        </div>
        <p v-if="jsonErr" class="t-error">⚠ {{ jsonErr }}</p>
        <textarea v-if="jsonOut" class="big-ta" rows="9" readonly :value="jsonOut" />
      </div>

      <!-- 时间戳转换 -->
      <div v-else-if="activeTool === 'timestamp'" class="work">
        <div class="now-line">
          <b>当前时间</b> {{ nowStr || '—' }}
          <button class="btn small" @click="tsNow">刷新</button>
        </div>
        <div class="opts">
          <input v-model="tsInput" class="grow" placeholder="输入时间戳（10 位秒 / 13 位毫秒）" @input="tsFromStamp" />
        </div>
        <div class="opts">
          <input v-model="tsDate" type="datetime-local" step="1" @input="tsFromDate" />
        </div>
        <div v-if="tsOutput" class="result-line">{{ tsOutput }}</div>
        <p class="dim tip-line">在上方输入时间戳，或用日期选择器选时间，结果实时显示在这里。</p>
      </div>

      <!-- 编解码工具 -->
      <div v-else-if="activeTool === 'base64'" class="work">
        <div class="opts">
          <select v-model="encMode">
            <option value="b64e">Base64 编码</option>
            <option value="b64d">Base64 解码</option>
            <option value="urle">URL 编码</option>
            <option value="urld">URL 解码</option>
          </select>
        </div>
        <textarea v-model="encInput" class="big-ta" rows="6" placeholder="输入内容" @input="encRun" />
        <p v-if="encErr" class="t-error">⚠ {{ encErr }}</p>
        <textarea v-if="encOutput" class="big-ta" rows="6" readonly :value="encOutput" />
        <div class="opts" v-if="encOutput">
          <button class="btn" @click="copyText(encOutput)">复制结果</button>
        </div>
      </div>

      <!-- UUID / 密码 -->
      <div v-else-if="activeTool === 'uuid'" class="work">
        <h4 class="sub-h">UUID v4</h4>
        <div class="opts">
          <button class="btn primary" @click="genUuid(5)">生成 5 个</button>
          <button class="btn" @click="genUuid(1)">生成 1 个</button>
        </div>
        <div v-for="(u, i) in uuidList" :key="i" class="result-line mono">
          {{ u }}
          <button class="entry-ops-inline" title="复制" @click="copyText(u)">复制</button>
        </div>

        <h4 class="sub-h" style="margin-top: 26px">随机密码</h4>
        <div class="opts">
          <label class="opt"><span>长度 {{ pwLength }}</span>
            <input type="range" min="8" max="64" v-model.number="pwLength" />
          </label>
          <label class="opt chk"><input type="checkbox" v-model="pwSets.upper" /> 大写</label>
          <label class="opt chk"><input type="checkbox" v-model="pwSets.lower" /> 小写</label>
          <label class="opt chk"><input type="checkbox" v-model="pwSets.digit" /> 数字</label>
          <label class="opt chk"><input type="checkbox" v-model="pwSets.symbol" /> 符号</label>
          <button class="btn primary" @click="genPw(5)">生成 5 个</button>
        </div>
        <div v-for="(p, i) in pwList" :key="'p' + i" class="result-line mono">
          {{ p }}
          <button class="entry-ops-inline" title="复制" @click="copyText(p)">复制</button>
        </div>
      </div>

      <!-- 正则测试 -->
      <div v-else-if="activeTool === 'regex'" class="work">
        <div class="opts">
          <span class="opt-sep">/</span>
          <input v-model="rePattern" class="grow mono" placeholder="输入正则表达式，如 \d+ 或 [一-龥]{2,}" />
          <span class="opt-sep">/</span>
          <input v-model="reFlags" class="flags mono" placeholder="gim" />
        </div>
        <textarea v-model="reText" class="big-ta" rows="7" placeholder="粘贴要测试的文本…" />
        <p v-if="reMatches === null" class="t-error">⚠ 正则表达式语法有误</p>
        <template v-else>
          <div class="result-line">
            命中 <b>{{ reMatches.length }}</b> 处
          </div>
          <div class="re-list">
            <div v-for="(m, i) in reMatches" :key="i" class="re-item">
              <span class="re-idx">#{{ i + 1 }}</span>
              <code class="re-text">{{ m.text }}</code>
              <span class="dim">位置 {{ m.index }}</span>
              <code v-if="m.groups.length" class="re-group">分组: {{ m.groups.join(' | ') }}</code>
            </div>
          </div>
        </template>
      </div>

      <!-- Hash 计算 -->
      <div v-else-if="activeTool === 'hash'" class="work">
        <textarea v-model="hashInput" class="big-ta" rows="5" placeholder="输入要计算哈希的文本（或选择下方文件）" @input="hashRun" />
        <div class="opts">
          <label class="btn">
            选择文件<input type="file" style="display:none" @change="onHashFile" />
          </label>
          <span v-if="hashFile" class="dim">{{ hashFile.name }} ({{ fmtSize(hashFile.size) }})</span>
          <span v-if="hashRunning" class="spin"></span>
        </div>
        <div v-if="Object.keys(hashOut).length" class="hash-list">
          <div v-for="(v, k) in hashOut" :key="k" class="result-line mono">
            <b>{{ k }}</b>
            <code class="hash-val">{{ v }}</code>
            <button class="entry-ops-inline" @click="copyText(v)">复制</button>
          </div>
        </div>
      </div>

      <!-- 颜色转换 -->
      <div v-else-if="activeTool === 'color'" class="work">
        <div class="opts">
          <input v-model="colorHex" class="grow mono" placeholder="#2f6fed" />
          <div class="swatch" :style="{ background: colorRgb ? colorHex : 'transparent' }"></div>
        </div>
        <p v-if="colorError" class="t-error">⚠ {{ colorError }}</p>
        <template v-else-if="colorRgb">
          <div class="result-line mono">RGB&nbsp;&nbsp;rgb({{ colorRgb.r }}, {{ colorRgb.g }}, {{ colorRgb.b }})</div>
          <div class="result-line mono">HEX&nbsp;&nbsp;#{{ colorHex.replace('#', '').toUpperCase() }}</div>
          <div class="result-line mono" v-if="colorHsl">HSL&nbsp;&nbsp;hsl({{ colorHsl.h }}, {{ colorHsl.s }}%, {{ colorHsl.l }}%)</div>
        </template>
      </div>

      <!-- 文本对比 -->
      <div v-else-if="activeTool === 'diff'" class="work">
        <div class="diff-grid">
          <textarea v-model="diffLeft" class="big-ta" rows="8" placeholder="原始文本…" />
          <textarea v-model="diffRight" class="big-ta" rows="8" placeholder="修改后文本…" />
        </div>
        <p v-if="diffResult === null" class="t-error">⚠ 文本过长（单边超过 500 行），请精简后再对比</p>
        <template v-else-if="diffLeft && diffRight">
          <div class="result-line">
            共 <b>{{ diffStats.add }}</b> 行新增 · <b>{{ diffStats.del }}</b> 行删除 · <b>{{ diffStats.same }}</b> 行相同
          </div>
          <div class="diff-out">
            <div v-for="(l, i) in diffResult" :key="i" class="diff-line" :class="l.t">
              <span class="diff-mark">{{ l.t === 'add' ? '+' : l.t === 'del' ? '-' : ' ' }}</span>{{ l.s }}
            </div>
          </div>
        </template>
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

/* ---- 开发/实用工具 ---- */
.big-ta {
  width: 100%;
  min-height: 120px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  color: var(--text);
  font-size: 13px;
  font-family: ui-monospace, Consolas, monospace;
  line-height: 1.6;
  resize: vertical;
  margin-bottom: 10px;
}
.big-ta:focus { outline: none; border-color: rgba(242, 185, 75, 0.5); }
.opts {
  display: flex; align-items: center; flex-wrap: wrap;
  gap: 10px; margin-bottom: 12px;
}
.opts .grow { flex: 1; min-width: 0; height: 36px; }
.opts .flags { width: 60px; }
.opt-sep { color: var(--text-faint); font-size: 16px; }
.opt.chk { flex-direction: row; align-items: center; gap: 5px; font-size: 13px; color: var(--text-dim); }
.opt.chk input { width: 15px; height: 15px; }
.result-line {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px 12px;
  margin-bottom: 8px;
  font-size: 13px;
  overflow-x: auto;
}
.mono, .re-text, .hash-val { font-family: ui-monospace, Consolas, monospace; }
.hash-val { flex: 1; word-break: break-all; font-size: 12px; color: var(--blue); }
.now-line { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; font-size: 14px; }
.tip-line { font-size: 12.5px; margin-top: 10px; }
.sub-h { margin: 0 0 10px; font-size: 14px; color: var(--gold); }
.swatch {
  width: 42px; height: 36px;
  border-radius: 8px;
  border: 1px solid var(--border-strong);
  flex-shrink: 0;
}
.re-list { max-height: 420px; overflow-y: auto; }
.re-item {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.re-item:last-child { border-bottom: none; }
.re-idx { color: var(--text-faint); font-size: 12px; flex-shrink: 0; }
.re-group { color: var(--blue); font-size: 12px; }
.hash-list { margin-top: 6px; }
.diff-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 720px) { .diff-grid { grid-template-columns: 1fr; } }
.diff-out {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 0;
  max-height: 480px;
  overflow: auto;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12.5px;
}
.diff-line { padding: 1px 12px; white-space: pre-wrap; word-break: break-all; }
.diff-line.add { background: rgba(52, 209, 137, 0.12); color: var(--green); }
.diff-line.del { background: rgba(255, 107, 107, 0.12); color: var(--red); }
.diff-mark { display: inline-block; width: 14px; color: var(--text-faint); }

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
  padding: 22px 20px;
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
