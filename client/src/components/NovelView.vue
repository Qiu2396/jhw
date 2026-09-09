<script setup>
import { ref, reactive, computed, onUnmounted, onMounted, watch } from 'vue';
import { novelSearch, novelToc, novelChapter } from '../api.js';
import { peekList, loadKind, removeEntry, record, clearKind, takePendingResume } from '../historyStore.js';
import AppIcon from './AppIcon.vue';

const PROGRESS_KEY = 'nv_progress';

// 三态：search 搜索列表 / toc 章节目录 / reader 阅读器
const stage = ref('search');
const kw = ref('');
const searching = ref(false);
const searchError = ref('');
const books = ref([]);

const currentBook = ref(null);      // {bookName, author, sources}
const activeSourceIdx = ref(0);
const chapters = ref([]);
const tocLoading = ref(false);
const tocError = ref('');

const chapterIdx = ref(0);
const chapter = ref(null);          // {title, content}
const chLoading = ref(false);
const chError = ref('');

/* ---- 阅读器排版设置：字号 / 行距 / 背景 / 字体（本机记忆） ---- */
const READER_THEMES = [
  { id: 'paper', name: '羊皮纸', bg: '#f4ecd9', fg: '#5b4a36' },
  { id: 'white', name: '纸白', bg: '#ffffff', fg: '#333a45' },
  { id: 'green', name: '护眼', bg: '#cce8cf', fg: '#2f4a33' },
  { id: 'dark', name: '夜间', bg: '#161a22', fg: '#a8b0bd' }
];
const READER_FONTS = [
  { id: 'default', name: '默认', stack: '' },
  { id: 'song', name: '宋体', stack: '"Songti SC", SimSun, "Noto Serif SC", serif' },
  { id: 'hei', name: '黑体', stack: '"PingFang SC", "Microsoft YaHei", sans-serif' }
];
const showRSet = ref(false);

function loadReader() {
  const base = { fontSize: 18, lineHeight: 1.8, theme: 'paper', font: 'default' };
  try {
    // 旧版本只记字号（nv_font），迁移进来
    const legacy = parseInt(localStorage.getItem('nv_font'));
    if (isFinite(legacy)) base.fontSize = legacy;
    Object.assign(base, JSON.parse(localStorage.getItem('nv_reader') || '{}'));
  } catch { /* 忽略坏数据 */ }
  if (![14, 16, 18, 20, 22, 24, 28].includes(base.fontSize)) base.fontSize = Math.min(Math.max(base.fontSize, 14), 30);
  return base;
}
const reader = reactive(loadReader());
watch(reader, () => {
  try { localStorage.setItem('nv_reader', JSON.stringify({ ...reader })); } catch { /* 忽略 */ }
}, { deep: true });

function setFs(d) {
  reader.fontSize = Math.min(Math.max(reader.fontSize + d, 14), 30);
}
const readerStyle = computed(() => ({
  fontSize: reader.fontSize + 'px',
  lineHeight: reader.lineHeight,
  fontFamily: READER_FONTS.find(f => f.id === reader.font)?.stack || undefined
}));

// ---- 个人阅读记录（登录同步云端，游客存本机） ----
const novelHistory = peekList('novel');

let chAbort = null;

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); }
  catch { return {}; }
}
function saveProgress(entry) {
  const all = loadProgress();
  all[entry.key] = { chapterIdx: entry.chapterIdx, chapterUrl: entry.chapterUrl, chapterName: entry.chapterName, srcId: entry.srcId, ts: Date.now() };
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
}

/** 读到一章：本地进度徽章 + 记录列表（含续读所需全部信息）一起更新 */
function recordReading(book, srcId, idx, url, name) {
  saveProgress({
    key: book.bookName + '|' + book.author,
    chapterIdx: idx,
    chapterUrl: url,
    chapterName: name,
    srcId
  });
  record({
    kind: 'novel',
    key: book.bookName + '|' + book.author,
    title: book.bookName,
    subtitle: [book.author, name].filter(Boolean).join(' · '),
    cover: book.cover || '',
    payload: {
      bookName: book.bookName,
      author: book.author || '',
      cover: book.cover || '',
      key: book.bookName + '|' + book.author,
      sources: book.sources,
      srcId,
      chapterIdx: idx,
      chapterUrl: url,
      chapterName: name
    }
  });
}

/** 从记录直接续读：打开上次用的源并跳到那一章 */
async function resumeNovel(e) {
  const p = e.payload || {};
  if (!p.sources?.length) return;
  const book = { bookName: p.bookName, author: p.author, cover: p.cover, key: p.key || e.key, sources: p.sources };
  const srcIdx = Math.max(p.sources.findIndex(s => s.sourceId === p.srcId), 0);
  const finalIdx = await openBook(book, srcIdx);
  if (finalIdx < 0) return;
  const idx = chapters.value.findIndex(c => c.url === p.chapterUrl);
  if (idx >= 0) openChapter(idx);
  else if (p.chapterIdx >= 0 && p.chapterIdx < chapters.value.length) openChapter(p.chapterIdx);
}

async function doSearch() {
  const w = kw.value.trim();
  if (!w || searching.value) return;
  searching.value = true;
  searchError.value = '';
  books.value = [];
  try {
    const d = await novelSearch(w);
    books.value = d.books || [];
  } catch (e) {
    searchError.value = e.message;
  } finally {
    searching.value = false;
  }
}

async function openBook(b, sourceIdx = 0) {
  currentBook.value = { ...b };
  activeSourceIdx.value = sourceIdx;
  chapters.value = [];
  stage.value = 'toc';
  tocLoading.value = true;
  tocError.value = '';
  try {
    const src = b.sources[sourceIdx];
    const d = await novelToc(src.sourceId, src.bookUrl);
    chapters.value = d.chapters || [];
    return sourceIdx;
  } catch (e) {
    // 自动换下一个源
    if (b.sources.length > sourceIdx + 1) return openBook(b, sourceIdx + 1);
    tocError.value = e.message;
    return -1;
  } finally {
    tocLoading.value = false;
  }
}

function switchSource(i) {
  if (i === activeSourceIdx.value) return;
  openBook(currentBook.value, i);
}

function openChapter(idx) {
  const url = chapters.value[idx]?.url;
  if (!url) return;
  chapterIdx.value = idx;
  stage.value = 'reader';
  chError.value = '';
  chLoading.value = true;
  chapter.value = null;
  if (chAbort) chAbort.abort();
  chAbort = new AbortController();
  const src = currentBook.value.sources[activeSourceIdx.value];
  novelChapter(src.sourceId, url)
    .then(d => {
      chapter.value = { title: d.title || chapters.value[idx].name, content: d.content || '' };
      chLoading.value = false;
      recordReading(currentBook.value, src.sourceId, idx, url, chapters.value[idx].name);
      window.scrollTo({ top: 0 });
    })
    .catch(e => {
      if (e.name === 'AbortError') return;
      chError.value = e.message;
      chLoading.value = false;
    });
}

function stepChapter(offset) {
  const next = chapterIdx.value + offset;
  if (next < 0 || next >= chapters.value.length) return;
  openChapter(next);
}

function progressInfo(b) {
  const p = loadProgress()[b.key];
  return p ? `读到 ${p.chapterName}` : '';
}

function continueReading(b) {
  const p = loadProgress()[b.key];
  const srcIdx = b.sources.findIndex(s => s.sourceId === p?.srcId);
  openBook(b, srcIdx >= 0 ? srcIdx : 0);
  if (p) {
    // 目录加载后自动跳转上次章节
    const wait = setInterval(() => {
      if (stage.value !== 'toc') return clearInterval(wait);
      if (chapters.value.length && !tocLoading.value) {
        clearInterval(wait);
        if (chapters.value[p.chapterIdx]?.url === p.chapterUrl) openChapter(p.chapterIdx);
      }
    }, 400);
    setTimeout(() => clearInterval(wait), 15000);
  }
}

function clearAll() {
  if (confirm('确定清空全部阅读记录？')) clearKind('novel');
}

onUnmounted(() => { if (chAbort) chAbort.abort(); });

onMounted(async () => {
  await loadKind('novel');
  // 从首页「继续读」跳转过来：直接续读
  const pendingEntry = takePendingResume('novel');
  if (pendingEntry) resumeNovel(pendingEntry);
});
</script>

<template>
  <div class="novel container">
    <h2 class="page-h"><AppIcon name="book-open" :size="22" class="h-icon" /> 小说阅读</h2>
    <p class="page-desc">书慢慢读，歌慢慢听。聚合多个在线书站，搜索书名免费阅读（支持《斗破苍穹》《凡人修仙传》等全本）。</p>

    <!-- 搜索态 -->
    <template v-if="stage === 'search'">
      <form class="n-search" @submit.prevent="doSearch">
        <input v-model="kw" placeholder="搜索书名或作者，如：斗破苍穹" maxlength="40" />
        <button class="btn primary" type="submit" :disabled="searching">
          <span v-if="searching" class="spin"></span> 搜索
        </button>
      </form>

      <!-- 继续读：个人阅读记录，点击直接跳回上次章节 -->
      <section v-if="novelHistory.length" class="rec-sec">
        <div class="rec-head">
          <h3 class="blk-title"><AppIcon name="history" :size="16" /> 继续读</h3>
          <button class="btn small" @click="clearAll">清空记录</button>
        </div>
        <div class="rec-row">
          <div v-for="e in novelHistory" :key="e.key" class="rec-card" @click="resumeNovel(e)">
            <img v-if="e.cover" :src="e.cover" loading="lazy" @error="e2 => e2.target.style.display = 'none'" />
            <div v-else class="rec-cover">{{ (e.title || '').slice(0, 1) }}</div>
            <div class="rec-info">
              <div class="rec-title">{{ e.title }}</div>
              <div class="rec-sub">{{ e.subtitle || '点击继续阅读' }}</div>
            </div>
            <button class="rec-del" title="删除这条记录" @click.stop="removeEntry('novel', e.key)"><AppIcon name="x" :size="12" /></button>
          </div>
        </div>
      </section>

      <p v-if="searchError" class="n-error">⚠ {{ searchError }}</p>
      <p v-if="!searching && !searchError && !books.length" class="dim n-empty">找一本没读完的书，今晚从这一章继续 🌙</p>
      <div v-if="books.length" class="n-list">
        <div v-for="b in books" :key="b.key" class="n-book" @click="continueReading(b)">
          <div class="n-book-body">
            <div class="n-book-name">{{ b.bookName }}</div>
            <div class="n-book-meta">
              {{ b.author }}<span v-if="b.latestChapter"> · 最新：{{ b.latestChapter.slice(0, 18) }}</span>
              <span v-if="progressInfo(b)" class="badge gold">{{ progressInfo(b) }}</span>
            </div>
          </div>
          <div class="src-row">
            <span v-for="s in b.sources" :key="s.sourceId" class="badge">{{ s.sourceName }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 目录态 -->
    <template v-if="stage === 'toc'">
      <div class="toc-head">
        <button class="btn small" @click="stage = 'search'"><AppIcon name="arrow-left" :size="13" /> 返回搜索</button>
        <div class="toc-title">
          <b>《{{ currentBook?.bookName }}》</b>
          <span class="dim">{{ currentBook?.author }} · {{ chapters.length }} 章</span>
        </div>
        <div class="src-tabs">
          <button
            v-for="(s, i) in currentBook?.sources || []"
            :key="s.sourceId"
            class="chip"
            :class="{ active: i === activeSourceIdx }"
            @click="switchSource(i)"
          >{{ s.sourceName }}</button>
        </div>
      </div>
      <div v-if="tocLoading" class="n-center"><span class="spin"></span> 正在获取章节目录…</div>
      <div v-else-if="tocError" class="n-error">{{ tocError }}</div>
      <div v-else class="toc-list">
        <button v-for="(c, i) in chapters" :key="i" class="toc-item" @click="openChapter(i)">{{ c.name }}</button>
      </div>
    </template>

    <!-- 阅读态 -->
    <template v-if="stage === 'reader'">
      <div class="reader-head">
        <button class="btn small" @click="stage = 'toc'"><AppIcon name="list" :size="13" /> 目录</button>
        <div class="reader-title dim">{{ chapter?.title || currentBook?.bookName }}</div>
        <button class="btn small" :class="{ primary: showRSet }" @click="showRSet = !showRSet">Aa 排版</button>
      </div>

      <!-- 阅读设置面板 -->
      <div v-if="showRSet" class="rset">
        <div class="rset-row">
          <span class="rset-label">字号</span>
          <div class="rset-ctrl">
            <button class="btn small" @click="setFs(-2)">A-</button>
            <span class="rset-val">{{ reader.fontSize }}px</span>
            <button class="btn small" @click="setFs(2)">A+</button>
          </div>
        </div>
        <div class="rset-row">
          <span class="rset-label">行距</span>
          <div class="rset-ctrl">
            <button
              v-for="lh in [1.5, 1.8, 2.1, 2.4]" :key="lh"
              class="rset-chip" :class="{ on: reader.lineHeight === lh }"
              @click="reader.lineHeight = lh"
            >{{ lh }}</button>
          </div>
        </div>
        <div class="rset-row">
          <span class="rset-label">背景</span>
          <div class="rset-ctrl">
            <button
              v-for="t in READER_THEMES" :key="t.id"
              class="rset-swatch" :class="{ on: reader.theme === t.id }"
              :style="{ background: t.bg, color: t.fg }"
              @click="reader.theme = t.id"
            >{{ t.name }}</button>
          </div>
        </div>
        <div class="rset-row">
          <span class="rset-label">字体</span>
          <div class="rset-ctrl">
            <button
              v-for="f in READER_FONTS" :key="f.id"
              class="rset-chip" :class="{ on: reader.font === f.id }"
              @click="reader.font = f.id"
            >{{ f.name }}</button>
          </div>
        </div>
      </div>

      <div class="reader" :class="'rt-' + reader.theme" :style="readerStyle">
        <div v-if="chLoading" class="n-center"><span class="spin"></span> 正在加载正文…</div>
        <div v-else-if="chError" class="n-error">
          {{ chError }}
          <div style="margin-top: 12px">
            <button class="btn small" @click="openChapter(chapterIdx)">重试</button>
            <button class="btn small" @click="stepChapter(1)">跳下一章</button>
          </div>
        </div>
        <template v-else>
          <h3 class="reader-chapter">{{ chapter?.title }}</h3>
          <div class="reader-content">
            <p v-for="(p, i) in (chapter?.content || '').split('\n')" :key="i">{{ p }}</p>
          </div>
          <div class="reader-foot">
            <button class="btn" :disabled="chapterIdx <= 0" @click="stepChapter(-1)"><AppIcon name="chevron-left" :size="14" /> 上一章</button>
            <span class="dim">{{ chapterIdx + 1 }} / {{ chapters.length }}</span>
            <button class="btn primary" :disabled="chapterIdx >= chapters.length - 1" @click="stepChapter(1)">下一章 <AppIcon name="chevron-right" :size="14" /></button>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.novel { padding-top: 34px; animation: rise 0.35s ease both; }
h2 { margin: 0 0 6px; }
.page-h { display: flex; align-items: center; gap: 9px; }
.h-icon { color: var(--gold); }
.page-desc { color: var(--text-dim); margin: 0 0 24px; font-size: 14px; }

/* ---- 继续读记录区（与听书同款） ---- */
.rec-sec { margin: 0 0 26px; }
.rec-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.blk-title { display: flex; align-items: center; gap: 7px; font-size: 15px; margin: 0; color: var(--gold); }
.rec-row { display: flex; gap: 10px; overflow-x: auto; padding: 2px 2px 8px; }
.rec-card {
  position: relative;
  flex: 0 0 220px;
  display: flex;
  gap: 11px;
  align-items: center;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: all 0.18s;
}
.rec-card:hover { border-color: rgba(242, 185, 75, 0.45); transform: translateY(-2px); }
.rec-card img, .rec-cover {
  width: 42px; height: 56px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
  background: linear-gradient(135deg, var(--cover-1), var(--cover-2));
}
.rec-cover {
  display: flex; align-items: center; justify-content: center;
  color: var(--gold); font-size: 18px; font-weight: 700;
}
.rec-info { min-width: 0; flex: 1; }
.rec-title { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rec-sub { font-size: 12px; color: var(--text-faint); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rec-del {
  position: absolute; top: 4px; right: 5px;
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px;
  border-radius: 6px;
  color: var(--text-faint);
  opacity: 0;
  transition: opacity 0.15s;
}
.rec-card:hover .rec-del { opacity: 1; }
.rec-del:hover { color: var(--red); }

.n-search { display: flex; gap: 10px; margin-bottom: 22px; align-items: center; }
.n-search input {
  flex: 1; max-width: 460px;
  height: 38px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0 14px;
  color: var(--text); font-size: 14px; outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.n-search input:focus { border-color: rgba(242, 185, 75, 0.5); box-shadow: 0 0 0 3px rgba(242, 185, 75, 0.1); }
.n-search .btn { height: 38px; }
.n-error { color: var(--red); font-size: 14px; margin: 0 0 14px; }
.n-empty { text-align: center; padding: 60px 0; }
.n-center { display: flex; align-items: center; gap: 10px; color: var(--text-dim); padding: 30px 0; justify-content: center; }

.n-list { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--surface); }
.n-book {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.12s;
  flex-wrap: wrap;
}
.n-book:last-child { border-bottom: none; }
.n-book:hover { background: rgba(255, 255, 255, 0.03); }
.n-book-name { font-size: 15px; font-weight: 600; }
.n-book-meta { font-size: 13px; color: var(--text-dim); margin-top: 3px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.src-row { display: flex; gap: 5px; flex-wrap: wrap; }

.toc-head {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.toc-title { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.src-tabs { display: flex; gap: 6px; margin-left: auto; }
.chip {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-dim);
}
.chip.active { color: var(--gold); border-color: rgba(242, 185, 75, 0.5); background: var(--gold-soft); }

.toc-list {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 4px;
}
.toc-item {
  padding: 8px 10px;
  text-align: left;
  font-size: 13px;
  color: var(--text-dim);
  border-radius: 7px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toc-item:hover { background: var(--surface-2); color: var(--text); }

.reader-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.reader-title { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.font-ctrl { display: flex; gap: 6px; }

.reader {
  max-width: 760px;
  margin: 0 auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 28px 30px 24px;
}
.reader-chapter { text-align: center; margin: 0 0 22px; font-size: 19px; }
.reader-content p {
  margin: 0 0 1em;
  line-height: inherit;
  color: inherit;
  text-indent: 2em;
  transition: font-size 0.15s;
}
.reader-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 26px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

/* ---- 阅读背景主题（覆盖 .reader 容器配色） ---- */
.reader.rt-paper { background: #f4ecd9; color: #5b4a36; border-color: #e2d5b8; }
.reader.rt-paper .reader-foot { border-top-color: #dcccaa; }
.reader.rt-white { background: #ffffff; color: #333a45; border-color: var(--border); }
.reader.rt-green { background: #cce8cf; color: #2f4a33; border-color: #b3d4b6; }
.reader.rt-green .reader-foot { border-top-color: #b3d4b6; }
.reader.rt-dark { background: #161a22; color: #a8b0bd; border-color: #2c3552; }
.reader.rt-dark .reader-foot { border-top-color: #2c3552; }

/* ---- 阅读设置面板 ---- */
.rset {
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 14px 16px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: var(--shadow-1);
}
.rset-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.rset-label { font-size: 13px; color: var(--text-dim); width: 40px; flex-shrink: 0; }
.rset-ctrl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rset-val { font-size: 13px; color: var(--gold); min-width: 42px; text-align: center; font-variant-numeric: tabular-nums; }
.rset-chip {
  padding: 4px 14px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.rset-chip:hover { color: var(--text); }
.rset-chip.on { color: var(--gold); border-color: rgba(242, 185, 75, 0.5); background: var(--gold-soft); font-weight: 600; }
.rset-swatch {
  padding: 4px 14px;
  border-radius: 999px;
  font-size: 12.5px;
  border: 2px solid var(--border-strong);
}
.rset-swatch.on { border-color: var(--gold); box-shadow: 0 0 0 2px var(--gold-soft); font-weight: 600; }

/* ---- 移动端 H5 ---- */
@media (max-width: 720px) {
  .novel { padding-top: 22px; }
  .n-search input { font-size: 16px; }   /* ≥16px 防 iOS 聚焦自动放大 */
  .toc-list { grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); }
  .toc-head .src-tabs { margin-left: 0; width: 100%; }
  .reader { padding: 20px 16px 18px; }
  .rec-card { flex: 0 0 180px; }
  .reader-foot .btn { padding: 0 12px; }
}
</style>
