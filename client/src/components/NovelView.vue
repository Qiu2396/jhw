<script setup>
import { ref, onUnmounted } from 'vue';
import { novelSearch, novelToc, novelChapter } from '../api.js';
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
const fontSize = ref(parseInt(localStorage.getItem('nv_font') || '18'));

let chAbort = null;

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); }
  catch { return {}; }
}
function saveProgress(entry) {
  const all = loadProgress();
  all[entry.key] = { chapterIdx: entry.chapterIdx, chapterUrl: entry.chapterUrl, chapterName: entry.chapterName, ts: Date.now() };
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
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
  } catch (e) {
    // 自动换下一个源
    if (b.sources.length > sourceIdx + 1) return openBook(b, sourceIdx + 1);
    tocError.value = e.message;
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
      saveProgress({
        key: currentBook.value.bookName + '|' + currentBook.value.author,
        chapterIdx: idx,
        chapterUrl: url,
        chapterName: chapters.value[idx].name
      });
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

function setFont(delta) {
  fontSize.value = Math.min(Math.max(fontSize.value + delta, 14), 28);
  localStorage.setItem('nv_font', String(fontSize.value));
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

onUnmounted(() => { if (chAbort) chAbort.abort(); });
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
        <div class="font-ctrl">
          <button class="btn small" @click="setFont(-2)">A-</button>
          <button class="btn small" @click="setFont(2)">A+</button>
        </div>
      </div>
      <div class="reader">
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
          <div class="reader-content" :style="{ fontSize: fontSize + 'px' }">
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
  line-height: 1.95;
  color: var(--text);
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
</style>
