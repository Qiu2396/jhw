<script setup>
/**
 * 漫画频道：第三方源聚合，模式与小说/听书一致 ——
 * 搜索 → 章节列表 → 阅读器（竖屏滚动看图），进度自动记忆。
 * 图片由后端代理解析出直链，前端 <img lazy> 直接渲染。
 */
import { ref, computed, onMounted } from 'vue';
import { comicSearch, comicBook, comicImages } from '../api.js';
import { peekList, loadKind, removeEntry, record, clearKind, takePendingResume } from '../historyStore.js';
import AppIcon from './AppIcon.vue';

const PROGRESS_KEY = 'cv_progress';

// ---- 个人漫画阅读记录（登录同步云端，游客存本机） ----
const comicHistory = peekList('comic');

// 三态：search 搜索列表 / chapters 章节列表 / reader 阅读器
const stage = ref('search');
const kw = ref('');
const searching = ref(false);
const searchError = ref('');
const comics = ref([]);

const currentComic = ref(null);      // 打开的漫画（含 sources/activeSource）
const chapters = ref([]);
const bookLoading = ref(false);
const bookError = ref('');

const chapterIdx = ref(-1);
const chapterTitle = ref('');
const images = ref([]);
const loading = ref(false);
const chError = ref('');
const loadFail = ref(0);             // 图片加载失败张数

// 章节筛选：几百话里快速定位
const chFilter = ref('');
const shownChapters = computed(() => {
  const k = chFilter.value.trim().toLowerCase();
  const all = chapters.value.map((c, i) => ({ ...c, _i: i }));
  return k ? all.filter(c => c.name.toLowerCase().includes(k)) : all;
});

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); }
  catch { return {}; }
}
function saveProgress(entry) {
  const all = loadProgress();
  all[entry.key] = { idx: entry.idx, url: entry.url, name: entry.name, srcId: entry.srcId, ts: Date.now() };
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
}

/** 看到一话：本地进度徽章 + 记录列表（含续看所需全部信息）一起更新 */
function recordReading(comic, srcId, idx, url, name) {
  saveProgress({ key: comic.key, idx, url, name, srcId });
  record({
    kind: 'comic',
    key: comic.key,
    title: comic.name,
    subtitle: name,
    cover: comic.cover || '',
    payload: {
      name: comic.name,
      author: comic.author || '',
      cover: comic.cover || '',
      status: comic.status || '',
      key: comic.key,
      sources: comic.sources,
      srcId,
      chapterIdx: idx,
      chapterUrl: url,
      chapterName: name
    }
  });
}

/** 从记录直接续看：打开对应源并跳到上次那话 */
async function resumeComic(e) {
  const p = e.payload || {};
  if (!p.sources?.length) return;
  const comic = { name: p.name, author: p.author, cover: p.cover, status: p.status, key: p.key || e.key, sources: p.sources };
  const srcIdx = Math.max(p.sources.findIndex(s => s.sourceId === p.srcId), 0);
  const finalIdx = await openComic(comic, srcIdx);
  if (finalIdx < 0) return;
  const idx = chapters.value.findIndex(c => c.url === p.chapterUrl);
  if (idx >= 0) openChapter(idx);
  else if (p.chapterIdx >= 0 && p.chapterIdx < chapters.value.length) openChapter(p.chapterIdx);
}
function progressInfo(c) {
  const p = loadProgress()[c.key];
  return p ? `读到 ${p.name}` : '';
}

async function doSearch() {
  const w = kw.value.trim();
  if (!w || searching.value) return;
  searching.value = true;
  searchError.value = '';
  comics.value = [];
  try {
    const d = await comicSearch(w);
    comics.value = d.comics || [];
  } catch (e) {
    searchError.value = e.message;
  } finally {
    searching.value = false;
  }
}

async function openComic(c, sourceIdx = 0) {
  if (bookLoading.value) return -1;    // 防连点重复请求
  currentComic.value = { ...c };
  chapters.value = [];
  chFilter.value = '';
  stage.value = 'chapters';
  bookLoading.value = true;
  bookError.value = '';
  try {
    const src = c.sources[sourceIdx];
    const d = await comicBook(src.sourceId, src.bookUrl);
    chapters.value = d.chapters || [];
    currentComic.value = { ...c, ...d, sources: c.sources, activeSource: sourceIdx };
    return sourceIdx;
  } catch (e) {
    if (c.sources.length > sourceIdx + 1) return openComic(c, sourceIdx + 1);
    bookError.value = e.message;
    return -1;
  } finally {
    bookLoading.value = false;
  }
}

function switchSource(i) {
  if (!currentComic.value || i === currentComic.value?.activeSource) return;
  openComic(currentComic.value, i);
}

function continueComic(c) {
  const p = loadProgress()[c.key];
  const srcIdx = p ? c.sources.findIndex(s => s.sourceId === p.srcId) : -1;
  openComic(c, srcIdx >= 0 ? srcIdx : 0, p);
}

/** 打开某话：拉图片列表并渲染 */
async function openChapter(idx) {
  const url = chapters.value[idx]?.url;
  if (!url) return;
  chapterIdx.value = idx;
  stage.value = 'reader';
  chError.value = '';
  loading.value = true;
  images.value = [];
  loadFail.value = 0;
  chapterTitle.value = chapters.value[idx].name;
  window.scrollTo({ top: 0 });
  try {
    const src = currentComic.value.sources[currentComic.value.activeSource || 0];
    const d = await comicImages(src.sourceId, url);
    images.value = d.images || [];
    if (!images.value.length) throw new Error('本话没有解析到图片');
    loading.value = false;
    recordReading(currentComic.value, src.sourceId, idx, url, chapters.value[idx].name);
  } catch (e) {
    loading.value = false;
    chError.value = e.message;
  }
}

/** 「继续阅读」：打开书后直接跳到上次那话 */
function jumpToSaved(p) {
  const idx = p?.url ? chapters.value.findIndex(c => c.url === p.url) : -1;
  openChapter(idx >= 0 ? idx : Math.min(p?.idx ?? 0, chapters.value.length - 1));
}

/** 点搜索卡片：打开章节列表；有阅读进度时与小说同款——自动跳到上次那话 */
function continueOrChapters(c) {
  const p = loadProgress()[c.key];
  openComic(c, p ? Math.max(c.sources.findIndex(s => s.sourceId === p.srcId), 0) : 0);
  if (!p) return;
  const wait = setInterval(() => {
    if (stage.value !== 'chapters') return clearInterval(wait);
    if (chapters.value.length && !bookLoading.value) {
      clearInterval(wait);
      jumpToSaved(p);
    }
  }, 400);
  setTimeout(() => clearInterval(wait), 15000);
}

function stepChapter(offset) {
  const next = chapterIdx.value + offset;
  if (next < 0 || next >= chapters.value.length) return;
  openChapter(next);
}

function clearAll() {
  if (confirm('确定清空全部漫画阅读记录？')) clearKind('comic');
}

onMounted(async () => {
  await loadKind('comic');
  // 从首页「继续看」跳转过来：直接续看
  const pendingEntry = takePendingResume('comic');
  if (pendingEntry) resumeComic(pendingEntry);
});
</script>

<template>
  <div class="comic container">
    <h2 class="page-h"><AppIcon name="clapperboard" :size="22" class="h-icon" /> 看漫画</h2>
    <p class="page-desc">第三方漫画源聚合，搜漫画名免费看。竖屏滚动阅读，自动记住读到哪一话。</p>

    <!-- 搜索态 -->
    <template v-if="stage === 'search'">
      <form class="c-search" @submit.prevent="doSearch">
        <input v-model="kw" placeholder="搜索漫画名，如：斗破苍穹" maxlength="40" />
        <button class="btn primary" type="submit" :disabled="searching">
          <span v-if="searching" class="spin"></span> 搜索
        </button>
      </form>

      <!-- 继续看：个人漫画记录，点击直接跳回上次那话 -->
      <section v-if="comicHistory.length" class="rec-sec">
        <div class="rec-head">
          <h3 class="blk-title"><AppIcon name="history" :size="16" /> 继续看</h3>
          <button class="btn small" @click="clearAll">清空记录</button>
        </div>
        <div class="rec-row">
          <div v-for="e in comicHistory" :key="e.key" class="rec-card" @click="resumeComic(e)">
            <img v-if="e.cover" :src="e.cover" loading="lazy" @error="e2 => e2.target.style.display = 'none'" />
            <div v-else class="rec-cover">{{ (e.title || '').slice(0, 1) }}</div>
            <div class="rec-info">
              <div class="rec-title">{{ e.title }}</div>
              <div class="rec-sub">{{ e.subtitle || '点击继续阅读' }}</div>
            </div>
            <button class="rec-del" title="删除这条记录" @click.stop="removeEntry('comic', e.key)"><AppIcon name="x" :size="12" /></button>
          </div>
        </div>
      </section>

      <p v-if="searchError" class="c-error">⚠ {{ searchError }}</p>
      <p v-if="!searching && !searchError && !comics.length" class="dim c-empty">找一部想看的漫画，一口气看完 📚</p>
      <div v-if="comics.length" class="c-grid">
        <div v-for="c in comics" :key="c.key" class="c-card" @click="continueOrChapters(c)">
          <div class="c-cover-wrap">
            <img v-if="c.cover" :src="c.cover" loading="lazy" @error="e => e.target.style.visibility = 'hidden'" />
            <div v-else class="c-cover-fallback">{{ (c.name || '').slice(0, 1) }}</div>
            <span v-if="c.status" class="c-status">{{ c.status }}</span>
            <span v-if="progressInfo(c)" class="c-progress">{{ progressInfo(c) }}</span>
          </div>
          <div class="c-name" :title="c.name">{{ c.name }}</div>
          <div class="c-meta dim">{{ c.author || '' }}</div>
          <div v-if="c.sources.length > 1" class="c-srcs">
            <span v-for="s in c.sources" :key="s.sourceId" class="badge">{{ s.sourceName }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 章节态 -->
    <template v-if="stage === 'chapters'">
      <div class="c-book-head">
        <button class="btn small" @click="stage = 'search'"><AppIcon name="arrow-left" :size="13" /> 返回搜索</button>
        <img v-if="currentComic?.cover" :src="currentComic.cover" class="c-cover big" @error="e => e.target.style.visibility = 'hidden'" />
        <div class="c-book-info">
          <b class="c-book-title">{{ currentComic?.name }}</b>
          <div class="c-book-meta">
            <span v-if="currentComic?.author">{{ currentComic.author }}</span>
            <span v-if="currentComic?.status">{{ currentComic.status }}</span>
            <span v-if="chapters.length">{{ chapters.length }} 话</span>
          </div>
          <div v-if="currentComic?.intro" class="c-book-intro dim">{{ currentComic.intro.slice(0, 80) }}</div>
          <div class="c-actions">
            <button class="btn primary" :disabled="!chapters.length" @click="openChapter(0)">
              <AppIcon name="play" :size="13" /> 从第一话看
            </button>
            <button
              v-if="progressInfo(currentComic || {})"
              class="btn"
              @click="jumpToSaved(loadProgress()[currentComic.key])"
            >继续读 · {{ loadProgress()[currentComic.key]?.name }}</button>
            <div class="c-src-tabs">
              <button
                v-for="(s, i) in currentComic?.sources || []"
                :key="s.sourceId"
                class="chip"
                :class="{ active: i === currentComic?.activeSource }"
                @click="switchSource(i)"
              >{{ s.sourceName }}</button>
            </div>
          </div>
        </div>
      </div>
      <div v-if="bookLoading" class="c-center"><span class="spin"></span> 正在获取章节列表…</div>
      <div v-else-if="bookError" class="c-error">{{ bookError }}</div>
      <template v-else>
        <div class="c-chfilter-row" v-if="chapters.length > 60">
          <input
            v-model="chFilter"
            class="c-chfilter"
            :placeholder="`筛选 ${chapters.length} 话中的章节，如：021 或 特别篇`"
          />
          <span v-if="chFilter" class="dim c-chfilter-n">{{ shownChapters.length }} 话</span>
        </div>
        <div class="c-chapters">
          <button
            v-for="c in shownChapters"
            :key="c._i"
            class="c-ch"
            @click="openChapter(c._i)"
          >{{ c.name }}</button>
        </div>
        <p v-if="!shownChapters.length" class="dim c-empty">没有匹配「{{ chFilter }}」的章节</p>
      </template>
    </template>

    <!-- 阅读态 -->
    <template v-if="stage === 'reader'">
      <div class="reader-head">
        <button class="btn small" @click="stage = 'chapters'"><AppIcon name="list" :size="13" /> 目录</button>
        <div class="reader-title dim">{{ chapterTitle }}</div>
        <div class="reader-nav">
          <button class="btn small" :disabled="chapterIdx <= 0" @click="stepChapter(-1)"><AppIcon name="chevron-left" :size="13" /> 上一话</button>
          <button class="btn small" :disabled="chapterIdx >= chapters.length - 1" @click="stepChapter(1)">下一话 <AppIcon name="chevron-right" :size="13" /></button>
        </div>
      </div>
      <div class="c-reader">
        <div v-if="loading" class="c-center"><span class="spin"></span> 正在加载本话图片…</div>
        <div v-else-if="chError" class="c-error">
          {{ chError }}
          <div style="margin-top: 12px">
            <button class="btn small" @click="openChapter(chapterIdx)">重试</button>
            <button class="btn small" :disabled="chapterIdx >= chapters.length - 1" @click="stepChapter(1)">跳下一话</button>
          </div>
        </div>
        <template v-else>
          <img
            v-for="(u, i) in images"
            :key="i"
            :src="u"
            loading="lazy"
            class="c-img"
            @error="loadFail++"
          />
          <p v-if="loadFail > 0" class="dim c-loadfail">有 {{ loadFail }} 张图片加载失败（源站图床波动），可刷新重试</p>
        </template>
      </div>
      <div class="reader-foot">
        <button class="btn" :disabled="chapterIdx <= 0" @click="stepChapter(-1)"><AppIcon name="chevron-left" :size="14" /> 上一话</button>
        <span class="dim">{{ chapterIdx + 1 }} / {{ chapters.length }}</span>
        <button class="btn primary" :disabled="chapterIdx >= chapters.length - 1" @click="stepChapter(1)">下一话 <AppIcon name="chevron-right" :size="14" /></button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.comic { padding-top: 34px; animation: rise 0.35s ease both; }
h2 { margin: 0 0 6px; }
.page-h { display: flex; align-items: center; gap: 9px; }
.h-icon { color: var(--gold); }
.page-desc { color: var(--text-dim); margin: 0 0 24px; font-size: 14px; }

/* ---- 继续看记录区（与听书/小说同款） ---- */
.rec-sec { margin: 0 0 22px; }
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
.c-search { display: flex; gap: 10px; margin-bottom: 20px; align-items: center; }
.c-search input {
  flex: 1; max-width: 460px;
  height: 38px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0 14px;
  color: var(--text); font-size: 14px; outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.c-search input:focus { border-color: rgba(242, 185, 75, 0.5); box-shadow: 0 0 0 3px rgba(242, 185, 75, 0.1); }
.c-search .btn { height: 38px; }
.c-error { color: var(--red); font-size: 14px; margin: 0 0 14px; }
.c-empty { text-align: center; padding: 60px 0; }
.c-center { display: flex; align-items: center; gap: 10px; color: var(--text-dim); padding: 30px 0; justify-content: center; }

/* 搜索卡片 */
.c-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 16px;
}
.c-card { cursor: pointer; transition: transform 0.18s; }
.c-card:hover { transform: translateY(-3px); }
.c-cover-wrap {
  position: relative;
  aspect-ratio: 3 / 4;
  border-radius: var(--radius);
  overflow: hidden;
  background: linear-gradient(135deg, var(--cover-1), var(--cover-2));
  border: 1px solid var(--border);
}
.c-cover-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; }
.c-cover-fallback {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  color: var(--gold);
  font-size: 34px; font-weight: 700;
}
.c-status {
  position: absolute; top: 6px; left: 6px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
}
.c-progress {
  position: absolute; bottom: 6px; left: 6px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.55);
  color: var(--gold);
}
.c-name {
  margin-top: 8px;
  font-size: 13px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.c-meta { font-size: 12px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-srcs { display: flex; gap: 4px; margin-top: 5px; flex-wrap: wrap; }
.c-srcs .badge { font-size: 11px; }

/* 章节态 */
.c-book-head { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
.c-cover { width: 44px; height: 60px; object-fit: cover; border-radius: 7px; flex-shrink: 0; background: linear-gradient(135deg, var(--cover-1), var(--cover-2)); }
.c-cover.big { width: 110px; height: 146px; border-radius: var(--radius); }
.c-book-info { flex: 1; min-width: 220px; }
.c-book-title { font-size: 18px; display: block; margin-bottom: 6px; }
.c-book-meta { font-size: 13px; color: var(--text-dim); display: flex; gap: 10px; flex-wrap: wrap; }
.c-book-intro { font-size: 12px; margin-top: 5px; line-height: 1.7; }
.c-actions { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.c-src-tabs { display: flex; gap: 6px; }
.chip {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-dim);
}
.chip.active { color: var(--gold); border-color: rgba(242, 185, 75, 0.5); background: var(--gold-soft); }

.c-chfilter-row { display: flex; align-items: center; gap: 10px; max-width: 900px; margin: 0 auto 10px; }
.c-chfilter {
  flex: 1;
  height: 34px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 0 12px;
  color: var(--text); font-size: 13px; outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.c-chfilter:focus { border-color: rgba(242, 185, 75, 0.5); box-shadow: 0 0 0 3px rgba(242, 185, 75, 0.1); }
.c-chfilter-n { font-size: 12px; white-space: nowrap; }

.c-chapters {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 4px;
}
.c-ch {
  padding: 8px 10px;
  text-align: left;
  font-size: 13px;
  color: var(--text-dim);
  border-radius: 7px;
  min-height: 28px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.c-ch:hover { background: var(--surface-2); color: var(--text); }

/* 阅读态 */
.reader-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.reader-title { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reader-nav { display: flex; gap: 6px; }
.c-reader {
  max-width: 820px;
  margin: 0 auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 200px;
}
.c-img { display: block; width: 100%; border-radius: 6px; background: var(--surface-2); min-height: 60px; }
.c-loadfail { text-align: center; padding: 10px 0; font-size: 12px; }
.reader-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 820px;
  margin: 16px auto 0;
}

/* ---- 移动端 H5 ---- */
@media (max-width: 720px) {
  .comic { padding-top: 22px; }
  .c-search input { font-size: 16px; }   /* ≥16px 防 iOS 聚焦自动放大 */
  /* 漫画详情头：与听书同款——返回按钮一行，封面(缩小)与信息并排 */
  .c-book-head { display: grid; grid-template-columns: 84px 1fr; gap: 6px 12px; align-items: start; }
  .c-book-head > .btn.small { grid-column: 1 / -1; justify-self: start; }
  .c-cover.big { grid-column: 1; grid-row: 2; width: 84px; height: 112px; }
  .c-book-info { grid-column: 2; grid-row: 2; min-width: 0; }
  .c-actions { margin-top: 8px; gap: 8px; }
  .c-chapters { grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); }
  .c-reader { padding: 6px; }
  .rec-card { flex: 0 0 180px; }
  .reader-foot .btn { padding: 0 12px; }
}
</style>
