<script setup>
/**
 * 听书频道：真人演播有声小说，模式与音乐频道一致 ——
 * 本组件只负责「找书 + 排队列」，播放本体在全局 musicStore + MiniPlayer（底部常驻条）里，
 * 所以选好章节后切到小说页/首页，听书照常继续、自动连播下一集。
 *
 * 入队的每个章节带一个懒解析器 resolve()：播到该集时才向后端要真实音频地址，
 * 整本书上千集也能瞬间入队，不用提前逐集请求。
 */
import { ref, computed, onMounted } from 'vue';
import { audiobookSearch, audiobookBook, audiobookPlay } from '../api.js';
import { useMusicPlayer } from '../musicStore.js';
import { peekList, loadKind, removeEntry, record, clearKind, takePendingResume } from '../historyStore.js';
import PelicanRider from './PelicanRider.vue';
import AppIcon from './AppIcon.vue';

const PROGRESS_KEY = 'ab_progress';

const { playList, currentIdx, currentSong } = useMusicPlayer();

// 两态：search 搜索列表 / book 章节列表
const stage = ref('search');
const kw = ref('');
const searching = ref(false);
const searchError = ref('');
const books = ref([]);

const currentBook = ref(null);       // 打开的书（含当前使用的 source）
const chapters = ref([]);
const bookLoading = ref(false);
const bookError = ref('');
const openedFrom = ref(null);        // 打开时的搜索结果（用于多源切换）

const playing = computed(() =>
  !!currentSong.value && currentSong.value.album === currentBook.value?.bookName
);
const playingIdx = computed(() =>
  playing.value ? currentSong.value?._ch ?? -1 : -1
);

// 章节筛选：上千章里按编号或标题快速定位
const chFilter = ref('');
const shownChapters = computed(() => {
  const k = chFilter.value.trim().toLowerCase();
  const all = chapters.value.map((c, i) => ({ ...c, _i: i }));
  return k ? all.filter(c => c.name.toLowerCase().includes(k)) : all;
});

// 解析结果缓存：同一章节重复播放不重复请求
const playCache = new Map();

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); }
  catch { return {}; }
}
function saveProgress(entry) {
  const all = loadProgress();
  all[entry.key] = { idx: entry.idx, url: entry.url, name: entry.name, ts: Date.now() };
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
}
function progressInfo(b) {
  const p = loadProgress()[b.key];
  return p ? `听到 ${p.name}` : '';
}

// ---- 个人听书记录（登录同步云端，游客存本机） ----
const abHistory = peekList('audiobook');

async function recordBookProgress(book, src, idx, url, name) {
  saveProgress({ key: book.key, idx, url, name, srcId: src.sourceId });
  record({
    kind: 'audiobook',
    key: book.key,
    title: book.bookName,
    subtitle: [book.broadcaster, name].filter(Boolean).join(' · '),
    cover: book.cover || '',
    payload: {
      bookName: book.bookName,
      author: book.author || '',
      broadcaster: book.broadcaster || '',
      cover: book.cover || '',
      key: book.key,
      sources: book.sources,
      srcId: src.sourceId,
      chapterIdx: idx,
      chapterUrl: url,
      chapterName: name
    }
  });
}

/** 从记录直接续播：打开对应源的章节列表并从上次那集开始播 */
async function resumeEntry(e) {
  const p = e.payload || {};
  if (!p.sources?.length) return;
  const srcIdx = Math.max(p.sources.findIndex(s => s.sourceId === p.srcId), 0);
  openBook(
    { key: p.key || e.key, bookName: p.bookName, author: p.author, broadcaster: p.broadcaster, cover: p.cover, sources: p.sources },
    srcIdx,
    Math.max(p.chapterIdx || 0, 0)
  );
}

async function doSearch() {
  const w = kw.value.trim();
  if (!w || searching.value) return;
  searching.value = true;
  searchError.value = '';
  books.value = [];
  try {
    const d = await audiobookSearch(w);
    books.value = d.books || [];
  } catch (e) {
    searchError.value = e.message;
  } finally {
    searching.value = false;
  }
}

/** 组装播放队列：每章一个懒解析器，播到该集时才向后端要音频地址；
 *  解析即开播，所以进度记忆也挂在解析器里 —— 无论用户此刻在哪个页面，
 *  听到哪集就记到哪（全局播放器播完整本书时本组件可以早已卸载） */
function buildQueue(book, src) {
  return chapters.value.map((c, i) => {
    const name = c.name.replace(/^\d+[_\-.、\s]*/, '') || c.name;
    return {
      name,
      artist: [book.bookName, book.broadcaster].filter(Boolean).join(' · '),
      album: book.bookName,
      cover: book.cover || '',
      kind: 'audiobook',
      _ch: i,
      resolveError: '本集音频获取失败，已自动跳到下一集',
      resolve: async () => {
        recordBookProgress(book, src, i, c.url, name);
        if (playCache.has(c.url)) return playCache.get(c.url);
        const d = await audiobookPlay(src.sourceId, c.url);
        playCache.set(c.url, d);
        return d;
      }
    };
  });
}

async function openBook(b, sourceIdx = 0, autoplayIdx = -1) {
  if (bookLoading.value) return;           // 防双击/连点重复请求
  currentBook.value = { ...b };
  chapters.value = [];
  stage.value = 'book';
  bookLoading.value = true;
  bookError.value = '';
  try {
    const src = b.sources[sourceIdx];
    const d = await audiobookBook(src.sourceId, src.bookUrl);
    chapters.value = d.chapters || [];
    currentBook.value = { ...b, ...d, sources: b.sources, activeSource: sourceIdx };
    if (autoplayIdx >= 0 && chapters.value.length) playChapter(autoplayIdx);
  } catch (e) {
    if (b.sources.length > sourceIdx + 1) return openBook(b, sourceIdx + 1, autoplayIdx);
    bookError.value = e.message;
  } finally {
    bookLoading.value = false;
  }
}

function switchSource(i) {
  if (!openedFrom.value || i === currentBook.value?.activeSource) return;
  const wasPlaying = playing.value;
  openBook(openedFrom.value, i, wasPlaying ? currentIdx.value : -1);
}

/** 点章节 / 播放全部：整本书入队，从第 i 集开始播 */
function playChapter(i) {
  if (!chapters.value.length) return;
  const b = currentBook.value;
  const src = b.sources[b.activeSource || 0];
  playList(buildQueue(b, src), i);
}

function continueBook(b) {
  const p = loadProgress()[b.key];
  const srcIdx = p ? b.sources.findIndex(s => s.sourceId === p.srcId) : -1;
  openBook(b, srcIdx >= 0 ? srcIdx : 0, p ? p.idx : -1);
}

function clearAll() {
  if (confirm('确定清空全部听书记录？')) clearKind('audiobook');
}

onMounted(async () => {
  await loadKind('audiobook');
  // 从首页「继续听」跳转过来：直接续播
  const pendingEntry = takePendingResume('audiobook');
  if (pendingEntry) resumeEntry(pendingEntry);
});
</script>

<template>
  <div class="ab container">
    <h2 class="page-h">
      <PelicanRider v-if="playing" :size="27" class="h-icon" />
      <AppIcon v-else name="headphones" :size="22" class="h-icon" />
      听书
    </h2>
    <p class="page-desc">真人演播的有声小说，搜书名免费听。选一章，剩下的自动连播；切页、听歌都不打断。</p>

    <!-- 搜索态 -->
    <template v-if="stage === 'search'">
      <form class="ab-search" @submit.prevent="doSearch">
        <input v-model="kw" placeholder="搜索书名，如：斗破苍穹" maxlength="40" />
        <button class="btn primary" type="submit" :disabled="searching">
          <span v-if="searching" class="spin"></span> 搜索
        </button>
      </form>

      <!-- 继续听：个人听书记录，点击直接从上次那集接着播 -->
      <section v-if="abHistory.length" class="rec-sec">
        <div class="rec-head">
          <h3 class="blk-title"><AppIcon name="history" :size="16" /> 继续听</h3>
          <button class="btn small" @click="clearAll">清空记录</button>
        </div>
        <div class="rec-row">
          <div v-for="e in abHistory" :key="e.key" class="rec-card" @click="resumeEntry(e)">
            <img v-if="e.cover" :src="e.cover" loading="lazy" @error="e2 => e2.target.style.display = 'none'" />
            <div v-else class="rec-cover">{{ (e.title || '').slice(0, 1) }}</div>
            <div class="rec-info">
              <div class="rec-title">{{ e.title }}</div>
              <div class="rec-sub">{{ e.subtitle || '点击继续收听' }}</div>
            </div>
            <button class="rec-del" title="删除这条记录" @click.stop="removeEntry('audiobook', e.key)"><AppIcon name="x" :size="12" /></button>
          </div>
        </div>
      </section>

      <p v-if="searchError" class="ab-error">⚠ {{ searchError }}</p>
      <p v-if="!searching && !searchError && !books.length" class="dim ab-empty">找一部想听的书，通勤路上不无聊 🎧</p>
      <div v-if="books.length" class="ab-list">
        <div v-for="b in books" :key="b.key" class="ab-book" @click="continueBook(b)">
          <img v-if="b.cover" :src="b.cover" loading="lazy" class="ab-cover" @error="e => e.target.style.display = 'none'" />
          <div v-else class="ab-cover fallback">{{ (b.bookName || '').slice(0, 1) }}</div>
          <div class="ab-book-body">
            <div class="ab-book-name">{{ b.bookName }}</div>
            <div class="ab-book-meta">
              <span v-if="b.broadcaster">{{ b.broadcaster }}</span>
              <span v-if="b.author" class="dim">{{ b.author }}</span>
              <span v-if="progressInfo(b)" class="badge gold">{{ progressInfo(b) }}</span>
            </div>
            <div v-if="b.intro" class="ab-book-intro dim">{{ b.intro.slice(0, 60) }}</div>
          </div>
          <div class="src-row">
            <span v-for="s in b.sources" :key="s.sourceId" class="badge">{{ s.sourceName }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 章节态 -->
    <template v-if="stage === 'book'">
      <div class="ab-book-head">
        <button class="btn small" @click="stage = 'search'"><AppIcon name="arrow-left" :size="13" /> 返回搜索</button>
        <img v-if="currentBook?.cover" :src="currentBook.cover" class="ab-cover big" @error="e => e.target.style.display = 'none'" />
        <div class="ab-book-info">
          <b class="ab-book-title">《{{ currentBook?.bookName }}》</b>
          <div class="ab-book-meta">
            <span v-if="currentBook?.broadcaster">主播：{{ currentBook.broadcaster }}</span>
            <span v-if="chapters.length">{{ chapters.length }} 集</span>
          </div>
          <div v-if="currentBook?.intro" class="ab-book-intro dim">{{ currentBook.intro.slice(0, 80) }}</div>
          <div class="ab-actions">
            <button class="btn primary" :disabled="!chapters.length" @click="playChapter(0)">
              <AppIcon name="play" :size="13" /> {{ progressInfo(currentBook || {}) ? '从头播放' : '播放全部' }}
            </button>
            <div class="src-tabs">
              <button
                v-for="(s, i) in currentBook?.sources || []"
                :key="s.sourceId"
                class="chip"
                :class="{ active: i === currentBook?.activeSource }"
                @click="switchSource(i)"
              >{{ s.sourceName }}</button>
            </div>
          </div>
        </div>
      </div>
      <div v-if="bookLoading" class="ab-center"><span class="spin"></span> 正在获取章节列表…</div>
      <div v-else-if="bookError" class="ab-error">{{ bookError }}</div>
      <template v-else>
        <div class="ab-chfilter-row" v-if="chapters.length > 60">
          <input
            v-model="chFilter"
            class="ab-chfilter"
            :placeholder="`筛选 ${chapters.length} 集中的章节，如：0021 或 药老`"
          />
          <span v-if="chFilter" class="dim ab-chfilter-n">{{ shownChapters.length }} 集</span>
        </div>
        <div class="ab-chapters">
          <button
            v-for="c in shownChapters"
            :key="c._i"
            class="ab-ch"
            :class="{ cur: playingIdx === c._i }"
            :title="playingIdx === c._i ? '正在播放' : '播放这一集'"
            @click="playChapter(c._i)"
          >
            <span v-if="playingIdx === c._i" class="eq"><i></i><i></i><i></i></span>
            <span class="ab-ch-name">{{ c.name }}</span>
          </button>
        </div>
        <p v-if="!shownChapters.length" class="dim ab-empty">没有匹配「{{ chFilter }}」的章节</p>
      </template>
    </template>
  </div>
</template>

<style scoped>
.ab { padding-top: 34px; animation: rise 0.35s ease both; }
h2 { margin: 0 0 6px; }
.page-h { display: flex; align-items: center; gap: 9px; }
.h-icon { color: var(--gold); }
.page-desc { color: var(--text-dim); margin: 0 0 24px; font-size: 14px; }

/* ---- 继续听记录区 ---- */
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

.ab-search { display: flex; gap: 10px; margin-bottom: 22px; align-items: center; }
.ab-search input {
  flex: 1; max-width: 460px;
  height: 38px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0 14px;
  color: var(--text); font-size: 14px; outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.ab-search input:focus { border-color: rgba(242, 185, 75, 0.5); box-shadow: 0 0 0 3px rgba(242, 185, 75, 0.1); }
.ab-search .btn { height: 38px; }
.ab-error { color: var(--red); font-size: 14px; margin: 0 0 14px; }
.ab-empty { text-align: center; padding: 60px 0; }
.ab-center { display: flex; align-items: center; gap: 10px; color: var(--text-dim); padding: 30px 0; justify-content: center; }

.ab-chfilter-row { display: flex; align-items: center; gap: 10px; max-width: 900px; margin: 0 auto 10px; }
.ab-chfilter {
  flex: 1;
  height: 34px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 0 12px;
  color: var(--text); font-size: 13px; outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.ab-chfilter:focus { border-color: rgba(242, 185, 75, 0.5); box-shadow: 0 0 0 3px rgba(242, 185, 75, 0.1); }
.ab-chfilter-n { font-size: 12px; white-space: nowrap; }

.ab-list { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--surface); }
.ab-book {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.12s;
}
.ab-book:last-child { border-bottom: none; }
.ab-book:hover { background: rgba(255, 255, 255, 0.03); }
.ab-cover {
  width: 44px; height: 60px;
  object-fit: cover;
  border-radius: 7px;
  flex-shrink: 0;
  background: linear-gradient(135deg, var(--cover-1), var(--cover-2));
}
.ab-cover.big { width: 96px; height: 128px; }
.ab-cover.fallback {
  display: flex; align-items: center; justify-content: center;
  color: var(--gold);
  font-size: 20px; font-weight: 700;
}
.ab-book-body { min-width: 0; flex: 1; }
.ab-book-name { font-size: 15px; font-weight: 600; }
.ab-book-meta { font-size: 13px; color: var(--text-dim); margin-top: 3px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ab-book-intro { font-size: 12px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.src-row { display: flex; gap: 5px; flex-wrap: wrap; flex-shrink: 0; }

.ab-book-head { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.ab-book-info { flex: 1; min-width: 220px; }
.ab-book-title { font-size: 18px; display: block; margin-bottom: 6px; }
.ab-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
.src-tabs { display: flex; gap: 6px; }
.chip {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-dim);
}
.chip.active { color: var(--gold); border-color: rgba(242, 185, 75, 0.5); background: var(--gold-soft); }

.ab-chapters {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 4px;
}
.ab-ch {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  text-align: left;
  font-size: 13px;
  color: var(--text-dim);
  border-radius: 7px;
  min-height: 28px;
}
.ab-ch:hover { background: var(--surface-2); color: var(--text); }
.ab-ch.cur { background: var(--gold-soft); color: var(--gold); font-weight: 600; }
.ab-ch-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 正在播放的均衡器小动画（与 MiniPlayer 同款） */
.eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 11px; flex-shrink: 0; }
.eq i { width: 2.5px; border-radius: 1px; background: var(--gold); animation: ab-eq 0.9s ease-in-out infinite; }
.eq i:nth-child(1) { height: 62%; animation-delay: 0s; }
.eq i:nth-child(2) { height: 100%; animation-delay: 0.25s; }
.eq i:nth-child(3) { height: 45%; animation-delay: 0.5s; }
@keyframes ab-eq { 0%, 100% { transform: scaleY(0.45); } 50% { transform: scaleY(1); } }

/* ---- 移动端 H5 ---- */
@media (max-width: 720px) {
  .ab { padding-top: 22px; }
  .ab-search input { font-size: 16px; }   /* ≥16px 防 iOS 聚焦自动放大 */
  .ab-book { flex-wrap: wrap; padding: 12px; }
  .src-row { width: 100%; }
  /* 书籍详情头：返回按钮独占一行，封面(缩小)与书名/主播/操作并排，避免各元素纵向堆叠 */
  .ab-book-head { display: grid; grid-template-columns: 76px 1fr; gap: 6px 12px; align-items: start; }
  .ab-book-head > .btn.small { grid-column: 1 / -1; justify-self: start; }
  .ab-cover.big { grid-column: 1; grid-row: 2; width: 76px; height: 101px; }
  .ab-book-info { grid-column: 2; grid-row: 2; min-width: 0; }
  .ab-actions { margin-top: 8px; gap: 8px; }
  .ab-chapters { grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); }
  .rec-card { flex: 0 0 180px; }
  .ab-book-intro { display: none; }
}
</style>
