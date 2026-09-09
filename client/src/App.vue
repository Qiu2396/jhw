<script setup>
import { ref, computed, watch, defineAsyncComponent, onMounted, onUnmounted } from 'vue';
import SearchBar from './components/SearchBar.vue';
import ResultCard from './components/ResultCard.vue';
import MiniPlayer from './components/MiniPlayer.vue';
import AppIcon from './components/AppIcon.vue';
import AuthModal from './components/AuthModal.vue';
import { useMusicPlayer } from './musicStore.js';
import { useAuth, initAuth } from './authStore.js';
import {
  peekList, loadKind, record, removeEntry, clearKind,
  resetHistoryCache, setPendingResume, KIND_LABEL
} from './historyStore.js';
import { search, getSources } from './api.js';

// 各频道视图按需加载（路由级代码分割）：首屏只带核心搜索/播放条，
// 其余功能（含 hls.js 等大依赖）进入对应频道时才拉取对应 chunk
const PlayerModal = defineAsyncComponent(() => import('./components/PlayerModal.vue'));
const SourcesView = defineAsyncComponent(() => import('./components/SourcesView.vue'));
const MusicView = defineAsyncComponent(() => import('./components/MusicView.vue'));
const NovelView = defineAsyncComponent(() => import('./components/NovelView.vue'));
const AudiobookView = defineAsyncComponent(() => import('./components/AudiobookView.vue'));
const ComicView = defineAsyncComponent(() => import('./components/ComicView.vue'));
const ResourceView = defineAsyncComponent(() => import('./components/ResourceView.vue'));
const ToolsView = defineAsyncComponent(() => import('./components/ToolsView.vue'));
const ResumeEditor = defineAsyncComponent(() => import('./components/ResumeEditor.vue'));

const view = ref('home');          // home | result | sites | audio | comic | tools
const kw = ref('');
const searching = ref(false);
const searchError = ref('');
const groups = ref([]);
const failed = ref([]);
const tookMs = ref(0);

// 全局音乐播放器（底部常驻条），queue 非空即显示并给内容让位
const { queue: musicQueue } = useMusicPlayer();

// ---- 日间 / 夜间主题 ----
const THEME_KEY = 'fv_theme';
const theme = ref(
  localStorage.getItem(THEME_KEY) ||
  (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
);
function applyTheme() { document.documentElement.dataset.theme = theme.value; }
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, theme.value);
  applyTheme();
}
applyTheme();

const hotKeywords = ref([]);
const navSites = ref([]);
const sources = ref([]);

const activeGroup = ref(null);     // 打开播放弹窗的聚合条目
const resumeItem = ref(null);      // 从「继续观看」进入的条目 {sourceId, episodeUrl}

// ---- 账号体系（可选登录，游客也能用全部功能） ----
const { user, ready, showAuth, openAuth, doLogout } = useAuth();
const userMenuOpen = ref(false);

const FAV_KEY = 'fv_favorites';
const DISABLED_KEY = 'fv_disabled_sources';
const favorites = ref([]);

const typeFilter = ref('全部');
const sortMode = ref('default');   // default | recent | sources

const TYPE_RULES = [
  ['动漫', /动漫|动画|番/],
  ['综艺', /综艺|真人秀|晚会|演唱会/],
  ['解说', /解说/],
  ['其他', /纪录片|记录片|预告片|花絮/],
  ['电影', /电影|片$|院线/],
  ['剧集', /剧|连续/],
];
function classifyType(t) {
  return (TYPE_RULES.find(([, re]) => re.test(t || '')) || ['其他', null])[0];
}

const filteredGroups = computed(() => {
  let list = groups.value;
  if (typeFilter.value !== '全部') {
    list = list.filter(g => classifyType(g.type) === typeFilter.value);
  }
  if (sortMode.value === 'sources') {
    list = [...list].sort((a, b) => b.sources.length - a.sources.length);
  } else if (sortMode.value === 'recent') {
    list = [...list].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }
  return list;
});

const typeCounts = computed(() => {
  const m = { 全部: groups.value.length };
  for (const g of groups.value) {
    const c = classifyType(g.type);
    m[c] = (m[c] || 0) + 1;
  }
  return m;
});

const typeChips = computed(() => {
  const order = ['全部', '动漫', '电影', '剧集', '综艺', '解说', '其他'];
  return order.filter(t => typeCounts.value[t] !== undefined);
});

function loadFavorites() {
  try { favorites.value = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); }
  catch { favorites.value = []; }
}

function isFav(group) {
  return favorites.value.some(f => f.key === group.key);
}

function toggleFav(group) {
  if (isFav(group)) {
    favorites.value = favorites.value.filter(f => f.key !== group.key);
  } else {
    favorites.value.unshift({
      key: group.key, title: group.title, cover: group.cover,
      year: group.year || '', type: group.type || '', remarks: group.remarks || '',
      sources: group.sources, ts: Date.now()
    });
  }
  localStorage.setItem(FAV_KEY, JSON.stringify(favorites.value));
}

function removeFav(f) {
  favorites.value = favorites.value.filter(x => x !== f);
  localStorage.setItem(FAV_KEY, JSON.stringify(favorites.value));
}

// ---- 「继续观看」：统一走个人记录存储（登录→云端，游客→本机） ----
const videoList = peekList('video');
// 记录条目为 {kind,key,title,subtitle,cover,ts,payload}，播放器相关字段都在 payload 里
const history = computed(() => videoList.value.map(e => ({ ...(e.payload || {}), ts: e.ts })));

function videoEntry(item) {
  return {
    kind: 'video',
    key: `${item.key}|${item.episodeUrl}`,
    title: item.title,
    subtitle: item.episodeName || '',
    cover: item.cover || '',
    payload: { ...item }
  };
}

function saveHistory(item) {
  record(videoEntry(item));
}

function saveProgress(item) {
  // 只更新进度，不改变排序位置
  record(videoEntry(item), { keepPos: true });
}

function clearHistory() {
  clearKind('video');
}

/** 老版本 fv_history（纯本机）迁移到统一记录，仅游客且未初始化过时执行一次 */
function migrateOldVideoHistory() {
  try {
    if (user.value || localStorage.getItem('fv_hist_video')) return;
    const old = JSON.parse(localStorage.getItem('fv_history') || '[]');
    if (!Array.isArray(old)) return;
    for (const it of old) {
      record({ ...videoEntry(it), ts: it.ts || Date.now() }, { keepPos: true });
    }
  } catch { /* 忽略坏数据 */ }
}

function disabledList() {
  try { return JSON.parse(localStorage.getItem(DISABLED_KEY) || '[]'); }
  catch { return []; }
}

async function doSearch(word) {
  word = String(word || '').trim();
  if (!word || searching.value) return;
  kw.value = word;
  view.value = 'result';
  location.hash = `#/search/${encodeURIComponent(word)}`;
  searching.value = true;
  searchError.value = '';
  groups.value = [];
  failed.value = [];
  try {
    const data = await search(word, disabledList().join(','));
    groups.value = data.groups || [];
    failed.value = data.failed || [];
    tookMs.value = data.tookMs || 0;
  } catch (e) {
    searchError.value = e.message || '搜索失败';
  } finally {
    searching.value = false;
  }
}

function goHome() {
  view.value = 'home';
  activeGroup.value = null;
  location.hash = '';
}

function goSites() {
  view.value = 'sites';
  location.hash = '#/sites';
}

function goMusic() {
  view.value = 'music';
  location.hash = '#/music';
}

function goNovel() {
  view.value = 'novel';
  location.hash = '#/novel';
}

function goAudio() {
  view.value = 'audio';
  location.hash = '#/audio';
}

function goComic() {
  view.value = 'comic';
  location.hash = '#/comic';
}

function goTools() {
  view.value = 'tools';
  location.hash = '#/tools';
}

function goResource() {
  view.value = 'resource';
  location.hash = '#/resource';
}

function openPlayer(group, resume = null) {
  resumeItem.value = resume;
  activeGroup.value = group;
}

function onPlayed(record) {
  saveHistory(record);
}

function resumePlay(h) {
  const group = {
    key: h.key,
    title: h.title,
    cover: h.cover,
    year: h.year || '',
    type: h.type || '',
    remarks: '',
    sources: [{
      sourceId: h.sourceId,
      sourceName: h.sourceName,
      vodId: h.vodId,
      remarks: h.remarks || ''
    }]
  };
  openPlayer(group, { sourceId: h.sourceId, episodeUrl: h.episodeUrl, progress: h.progress || 0 });
}

function resumeFav(f) {
  openPlayer({ ...f, remarks: f.remarks || '' }, null);
}

function removeHistory(h) {
  removeEntry('video', `${h.key}|${h.episodeUrl}`);
}

// ---- 首页「继续听 · 继续读」：听书/小说/漫画/音乐记录合并，点击跨页直连续播 ----
const continueAll = computed(() => {
  const out = [];
  for (const k of ['audiobook', 'novel', 'comic', 'music']) {
    for (const e of peekList(k).value) out.push(e);
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, 12);
});

function resumeAny(e) {
  setPendingResume(e);
  if (e.kind === 'audiobook') goAudio();
  else if (e.kind === 'novel') goNovel();
  else if (e.kind === 'comic') goComic();
  else if (e.kind === 'music') goMusic();
}

async function reloadHistories() {
  resetHistoryCache();
  userMenuOpen.value = false;
  await loadKind('video');
  for (const k of ['audiobook', 'novel', 'comic', 'music']) loadKind(k);
}

// 登录/登出后：记录列表切换数据源（云端 ↔ 本机）
watch(user, () => { reloadHistories(); });

// 切换频道时回到页面顶部，避免新频道停留在上一页的滚动位置
watch(view, () => window.scrollTo({ top: 0 }));

function parseHash() {
  const h = decodeURIComponent(location.hash || '');
  if (h.startsWith('#/search/')) {
    const word = h.slice('#/search/'.length);
    if (word && word !== kw.value) doSearch(word);
    else if (word) view.value = 'result';
  } else if (h === '#/sites') {
    view.value = 'sites';
  } else if (h === '#/music') {
    view.value = 'music';
  } else if (h === '#/novel') {
    view.value = 'novel';
  } else if (h === '#/audio') {
    view.value = 'audio';
  } else if (h === '#/comic') {
    view.value = 'comic';
  } else if (h === '#/tools') {
    view.value = 'tools';
  } else if (h === '#/resource') {
    view.value = 'resource';
  } else if (h === '#/resume') {
    view.value = 'resume';
  } else if (h === '' || h === '#/') {
    view.value = 'home';
  }
}

onMounted(async () => {
  await initAuth();
  migrateOldVideoHistory();
  await loadKind('video');
  for (const k of ['audiobook', 'novel', 'comic', 'music']) loadKind(k);
  loadFavorites();
  try {
    const data = await getSources();
    hotKeywords.value = data.hotKeywords || [];
    navSites.value = data.navSites || [];
    sources.value = data.sources || [];
  } catch { /* 后端未就绪时静默 */ }
  window.addEventListener('hashchange', parseHash);
  parseHash();
});

onUnmounted(() => window.removeEventListener('hashchange', parseHash));
</script>

<template>
  <header class="topbar">
    <div class="container topbar-inner">
      <div class="logo" @click="goHome">
        <span class="logo-icon"><AppIcon name="play" :size="14" /></span>
        <span class="logo-text">聚搜王</span>
        <span class="logo-sub">影视 · 音乐 · 书 · 漫画 · 资源</span>
      </div>
      <div v-if="view !== 'home'" class="topbar-search">
        <SearchBar :initial="kw" :compact="true" @search="doSearch" />
      </div>
      <!-- 导航行：桌面整体靠右；移动端独占一行，导航横向滚动、用户/主题钉在行尾 -->
      <div class="nav-row">
        <nav class="topnav">
          <button :class="{ active: !['sites','music','novel','audio','comic','tools','resource'].includes(view) }" @click="goHome">首页</button>
          <button :class="{ active: view === 'music' }" @click="goMusic">音乐</button>
          <button :class="{ active: view === 'novel' }" @click="goNovel">小说</button>
          <button :class="{ active: view === 'audio' }" @click="goAudio">听书</button>
          <button :class="{ active: view === 'comic' }" @click="goComic">漫画</button>
          <button :class="{ active: view === 'resource' }" @click="goResource">资源</button>
          <button :class="{ active: view === 'tools' }" @click="goTools">工具</button>
          <button :class="{ active: view === 'sites' }" @click="goSites">站点目录</button>
        </nav>

        <!-- 用户区：游客可登录（可选），已登录显示身份 -->
        <div v-if="ready" class="user-area">
          <button v-if="!user" class="login-btn" @click="openAuth()">
            <AppIcon name="user" :size="14" /> 登录
          </button>
          <div v-else class="user-wrap">
            <button class="user-btn" @click="userMenuOpen = !userMenuOpen">
              <AppIcon name="user" :size="14" />
              <span class="user-name">{{ user.username }}</span>
              <span v-if="user.isAdmin" class="badge gold">超管</span>
            </button>
            <Transition name="mp-panel">
              <div v-if="userMenuOpen" class="user-menu">
                <div class="um-head dim">{{ user.isAdmin ? '超级管理员' : '已登录' }} · 记录云端同步</div>
                <button class="um-item" @click="userMenuOpen = false; doLogout()">退出登录</button>
              </div>
            </Transition>
          </div>
        </div>

        <button
          class="theme-btn"
          :title="theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'"
          @click="toggleTheme"
        ><AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" :size="17" /></button>
      </div>
    </div>
  </header>

  <main class="main" :class="{ 'has-player': musicQueue.length }">
    <!-- 首页 -->
    <div v-if="view === 'home'" class="home">
      <section class="hero">
        <h1>想看的、想听的、想读的，<span class="grad">一搜便知</span></h1>
        <p class="hero-sub">慢下来 · 找一部想看的剧，听一首想听的歌，读完一段没读完的故事</p>
        <div class="hero-search">
          <SearchBar :initial="kw" @search="doSearch" />
        </div>
        <div class="hot">
          <span class="hot-label">热门：</span>
          <button v-for="w in hotKeywords" :key="w" class="hot-tag" @click="doSearch(w)">{{ w }}</button>
        </div>
      </section>

      <section v-if="favorites.length" class="section">
        <div class="section-head">
          <h2 class="sec-h"><AppIcon name="star-full" :size="17" class="sec-ic" /> 我的收藏</h2>
        </div>
        <div class="history-row">
          <div v-for="f in favorites" :key="'fav-' + f.key" class="history-card" @click="resumeFav(f)">
            <img v-if="f.cover" :src="f.cover" loading="lazy" @error="e => e.target.style.display = 'none'" />
            <div v-else class="cover-fallback">{{ (f.title || "").slice(0, 1) }}</div>
            <div class="history-info">
              <div class="history-title">{{ f.title }}</div>
              <div class="history-ep">{{ f.remarks || f.type || '已收藏' }}</div>
            </div>
            <button class="history-del fav-del" title="取消收藏" @click.stop="removeFav(f)"><AppIcon name="x" :size="12" /></button>
          </div>
        </div>
      </section>

      <!-- 继续听 · 继续读：听书/小说/漫画/音乐个人记录，点击直接续 -->
      <section v-if="continueAll.length" class="section">
        <div class="section-head">
          <h2 class="sec-h"><AppIcon name="history" :size="17" class="sec-ic" /> 继续听 · 继续读</h2>
        </div>
        <div class="history-row">
          <div v-for="e in continueAll" :key="e.kind + '-' + e.key" class="history-card" @click="resumeAny(e)">
            <img v-if="e.cover" :src="e.cover" loading="lazy" @error="e2 => e2.target.style.display = 'none'" />
            <div v-else class="cover-fallback">{{ (e.title || "").slice(0, 1) }}</div>
            <div class="history-info">
              <div class="history-title">{{ e.title }}</div>
              <div class="history-ep">
                <span class="kind-badge" :class="'k-' + e.kind">{{ KIND_LABEL[e.kind] }}</span>
                {{ e.subtitle }}
              </div>
            </div>
          </div>
        </div>
        <p v-if="!user" class="guest-tip dim">游客记录保存在本机 · <button class="link-btn" @click="openAuth('登录后记录云端同步，换设备也能继续')">登录同步到云端</button></p>
      </section>

      <section v-if="history.length" class="section">
        <div class="section-head">
          <h2>继续观看</h2>
          <button class="btn small" @click="clearHistory">清空</button>
        </div>
        <div class="history-row">
          <div v-for="h in history" :key="h.key + h.episodeUrl" class="history-card" @click="resumePlay(h)">
            <img v-if="h.cover" :src="h.cover" loading="lazy" @error="e => e.target.style.display = 'none'" />
            <div v-else class="cover-fallback">{{ (h.title || "").slice(0, 1) }}</div>
            <div class="history-info">
              <div class="history-title">{{ h.title }}</div>
              <div class="history-ep">{{ h.episodeName }} · {{ h.sourceName }}</div>
            </div>
            <button class="history-del" title="删除" @click.stop="removeHistory(h)"><AppIcon name="x" :size="12" /></button>
          </div>
        </div>
      </section>

      <section class="section features">
        <div class="feature">
          <div class="feature-icon"><AppIcon name="search" :size="26" /></div>
          <h3>聚合搜索</h3>
          <p>一次输入，同时问遍多个免费资源站。把找片的时间，留给喜欢的剧情。</p>
        </div>
        <div class="feature">
          <div class="feature-icon"><AppIcon name="monitor" :size="26" /></div>
          <h3>站内播放</h3>
          <p>自动解析播放地址，点开就看。深夜追剧，记得把音量调小一点。</p>
        </div>
        <div class="feature">
          <div class="feature-icon"><AppIcon name="headphones" :size="26" /></div>
          <h3>听歌 · 听书 · 阅读 · 漫画</h3>
          <p>治愈歌单免费听，有声小说自动连播，小说漫画随手读。都挂在底部播放条，切页不打断。</p>
        </div>
      </section>
    </div>

    <!-- 搜索结果 -->
    <div v-else-if="view === 'result'" class="result container">
      <div class="result-status">
        <template v-if="searching">
          <span class="spin"></span> 正在聚合搜索「<b>{{ kw }}</b>」…
        </template>
        <template v-else-if="searchError">
          <span class="badge red">搜索失败</span> {{ searchError }}
        </template>
        <template v-else>
          <span class="badge gold">{{ groups.length }} 部作品</span>
          <span class="dim">搜索「{{ kw }}」耗时 {{ (tookMs / 1000).toFixed(1) }} 秒</span>
          <span v-if="failed.length" class="dim fail-note">
            （{{ failed.map(f => f.name).join('、') }} 暂时不可用）
          </span>
        </template>
      </div>

      <div v-if="!searching && !searchError && groups.length" class="filter-bar">
        <div class="chips">
          <button
            v-for="t in typeChips"
            :key="t"
            class="chip"
            :class="{ active: typeFilter === t }"
            @click="typeFilter = t"
          >{{ t }} <span class="chip-n">{{ typeCounts[t] || 0 }}</span></button>
        </div>
        <select v-model="sortMode" class="sort-select" title="排序方式">
          <option value="default">默认排序</option>
          <option value="sources">来源最多</option>
          <option value="recent">最近更新</option>
        </select>
      </div>

      <div v-if="!searching && !searchError && !filteredGroups.length && groups.length" class="empty">
        <div class="empty-icon">🫙</div>
        <p>该分类下没有结果</p>
        <p class="dim">试试其他分类</p>
      </div>
      <div v-else-if="!searching && !searchError && !groups.length" class="empty">
        <div class="empty-icon">🍿</div>
        <p>没有找到「{{ kw }}」相关资源</p>
        <p class="dim">试试换个说法，比如「凡人修仙传」或「凡人修仙」</p>
      </div>

      <div v-else class="grid">
        <ResultCard
          v-for="g in filteredGroups"
          :key="g.key"
          :group="g"
          :favorite="isFav(g)"
          @play="openPlayer(g)"
          @toggle-fav="toggleFav(g)"
        />
      </div>
    </div>

    <!-- 音乐频道 -->
    <MusicView v-else-if="view === 'music'" />

    <!-- 小说频道 -->
    <NovelView v-else-if="view === 'novel'" />

    <!-- 听书频道 -->
    <AudiobookView v-else-if="view === 'audio'" />

    <!-- 漫画频道 -->
    <ComicView v-else-if="view === 'comic'" />

    <!-- 小工具 -->
    <ToolsView v-else-if="view === 'tools'" />

    <!-- 全文资源搜索 -->
    <ResourceView v-else-if="view === 'resource'" />

    <!-- 在线简历 -->
    <ResumeEditor v-else-if="view === 'resume'" />

    <!-- 站点目录 -->
    <SourcesView v-else :sources="sources" :nav-sites="navSites" />
  </main>

  <footer class="footer" :class="{ 'with-player': musicQueue.length }">
    <div class="container">
      <p>本工具仅聚合公开搜索接口与链接，不存储、不上传任何文件。内容均来自第三方站点。</p>
      <p>请在观影、听歌、阅读时支持正版平台 · 如内容涉及侵权请联系相应站点删除</p>
      <p class="footer-wish">愿每个夜晚都有剧可追、有歌可听、有故事可读 ☾</p>
    </div>
  </footer>

  <!-- 登录 / 注册弹窗（可选，游客直接用） -->
  <AuthModal />

  <!-- 全局迷你播放器：不随页面切换卸载，音乐不断 -->
  <MiniPlayer />

  <PlayerModal
    v-if="activeGroup"
    :group="activeGroup"
    :resume="resumeItem"
    @close="activeGroup = null; resumeItem = null"
    @played="onPlayed"
    @progress="saveProgress"
  />
</template>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: 50;
  background: var(--topbar-bg);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--border);
}
.topbar-inner {
  display: flex;
  align-items: center;
  gap: 20px;
  height: 62px;
}
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  white-space: nowrap;
}
.logo-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: linear-gradient(135deg, var(--gold), var(--gold-2));
  color: var(--on-gold);
  box-shadow: var(--shadow-gold);
}
.logo-icon .app-icon { margin-left: 1px; }
.logo-text { font-size: 19px; font-weight: 700; letter-spacing: 0.5px; }
.logo-sub { font-size: 12px; color: var(--text-faint); }
.section-head h2 { font-size: 18px; margin: 0; }
.sec-h { display: flex; align-items: center; gap: 8px; }
.sec-ic { color: var(--gold); }
.topbar-search { flex: 1; max-width: 480px; }
.nav-row { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-shrink: 0; }
.topnav { display: flex; gap: 4px; }
.topnav button {
  padding: 7px 15px;
  border-radius: 9px;
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1.4;
  user-select: none;
  white-space: nowrap;
  transition: all 0.15s;
}
.topnav button:hover { color: var(--text); background: var(--hover); }
.topnav button.active { color: var(--gold); background: var(--gold-soft); }
.theme-btn { font-size: 16px; line-height: 1; }

/* ---- 用户区 ---- */
.user-area { position: relative; flex-shrink: 0; }
.login-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: var(--on-gold);
  background: linear-gradient(135deg, var(--gold), var(--gold-2));
  box-shadow: var(--shadow-gold);
  white-space: nowrap;
}
.login-btn:hover { filter: brightness(1.06); }
.user-wrap { position: relative; }
.user-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--text-dim);
  border: 1px solid var(--border);
  background: var(--surface);
  white-space: nowrap;
}
.user-btn:hover { color: var(--gold); border-color: rgba(242, 185, 75, 0.45); }
.user-name { max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  min-width: 190px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  box-shadow: var(--shadow-2);
  overflow: hidden;
  z-index: 70;
}
.um-head { padding: 10px 14px; font-size: 12px; border-bottom: 1px solid var(--border); }
.um-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--text-dim);
}
.um-item:hover { color: var(--red); background: rgba(255, 107, 107, 0.06); }

/* ---- 首页继续听/读 ---- */
.kind-badge {
  display: inline-block;
  padding: 0 6px;
  height: 16px;
  line-height: 16px;
  margin-right: 2px;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 600;
  vertical-align: 1px;
}
.kind-badge.k-audiobook { background: var(--gold-soft); color: var(--gold); }
.kind-badge.k-novel { background: rgba(90, 168, 255, 0.12); color: var(--blue); }
.kind-badge.k-comic { background: rgba(52, 209, 137, 0.12); color: var(--green); }
.kind-badge.k-music { background: rgba(226, 149, 42, 0.14); color: var(--gold-2); }
.guest-tip { font-size: 12px; margin: 8px 2px 0; }
.link-btn { color: var(--gold); font-size: 12px; padding: 0; }
.link-btn:hover { text-decoration: underline; }

.main { flex: 1; padding-bottom: 70px; }
.main.has-player { padding-bottom: 130px; }

/* ---------- 首页 ---------- */
.home .hero { text-align: center; padding: 96px 20px 44px; animation: rise 0.5s ease both; }
.hero h1 {
  font-size: 40px;
  margin: 0 0 14px;
  letter-spacing: 1px;
  font-weight: 700;
  line-height: 1.35;
}
.hero h1 .grad {
  background: linear-gradient(120deg, var(--gold) 20%, #ffd98a 50%, var(--gold-2) 80%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero-sub { color: var(--text-dim); margin: 0 0 38px; font-size: 16px; }
.hero-search { max-width: 660px; margin: 0 auto 28px; }
.hot { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; align-items: center; }
.hot-label { color: var(--text-faint); font-size: 13px; }
.hot-tag {
  padding: 6px 16px;
  border-radius: 999px;
  font-size: 13px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-dim);
  transition: all 0.18s;
}
.hot-tag:hover {
  color: var(--gold);
  border-color: rgba(242, 185, 75, 0.45);
  background: var(--gold-soft);
  transform: translateY(-2px);
}

.section { max-width: 1220px; margin: 40px auto 0; padding: 0 24px; }
.section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.section-head h2 { font-size: 18px; margin: 0; }
.history-row {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 4px 2px 10px;
}
.history-card {
  position: relative;
  flex: 0 0 210px;
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: all 0.18s;
}
.history-card:hover {
  border-color: rgba(242, 185, 75, 0.45);
  transform: translateY(-2px);
  box-shadow: var(--shadow-1);
}
.history-card img, .history-card .cover-fallback {
  width: 44px; height: 60px;
  object-fit: cover;
  border-radius: 7px;
  flex-shrink: 0;
}
.cover-fallback {
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--cover-1), var(--cover-2));
  color: var(--gold);
  font-size: 20px;
  font-weight: 700;
}
.history-info { min-width: 0; }
.history-title { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-ep { font-size: 12px; color: var(--text-faint); margin-top: 3px; }
.history-del {
  position: absolute; top: 4px; right: 6px;
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  border-radius: 6px;
  color: var(--text-faint);
  opacity: 0; transition: opacity 0.15s;
}
.history-card:hover .history-del { opacity: 1; }
.history-del:hover { color: var(--red); }

.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  margin-top: 56px;
}
.feature {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 26px 24px;
  transition: all 0.2s;
}
.feature:hover {
  border-color: var(--border-strong);
  transform: translateY(-3px);
  box-shadow: var(--shadow-1);
}
.feature-icon {
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
.feature h3 { margin: 0 0 8px; font-size: 16px; }
.feature p { margin: 0; color: var(--text-dim); font-size: 14px; line-height: 1.7; }

/* ---------- 结果页 ---------- */
.result { padding-top: 34px; animation: rise 0.35s ease both; }
.result-status {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 24px;
  min-height: 28px;
  flex-wrap: wrap;
}
.dim { color: var(--text-dim); font-size: 14px; }
.fail-note { color: var(--text-faint); }

.filter-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 22px;
  flex-wrap: wrap;
}
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  padding: 5px 13px;
  border-radius: 999px;
  font-size: 13px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-dim);
  transition: all 0.15s;
}
.chip:hover { color: var(--text); border-color: var(--border-strong); }
.chip.active { color: var(--gold); border-color: rgba(242, 185, 75, 0.5); background: var(--gold-soft); font-weight: 600; }
.chip-n { font-size: 11px; opacity: 0.75; margin-left: 2px; }
.sort-select {
  margin-left: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--text-dim);
  font-size: 13px;
  padding: 6px 10px;
  outline: none;
  cursor: pointer;
  font-family: inherit;
}
.sort-select:hover { border-color: var(--border-strong); color: var(--text); }
.fav-del { color: var(--gold); }
.empty { text-align: center; padding: 90px 0; color: var(--text-dim); }
.empty-icon { font-size: 46px; margin-bottom: 12px; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(172px, 1fr));
  gap: 16px;
}

.footer {
  border-top: 1px solid var(--border);
  padding: 24px 0 32px;
  color: var(--text-faint);
  font-size: 12px;
  text-align: center;
  background: var(--footer-bg);
}
.footer.with-player { padding-bottom: 110px; }
.footer p { margin: 4px 0; }
.footer-wish { margin-top: 10px; color: var(--gold); opacity: 0.85; }

@media (max-width: 720px) {
  .logo-sub { display: none; }
  .topbar-inner { flex-wrap: wrap; height: auto; padding: 8px 0; gap: 10px; row-gap: 6px; }
  /* 窄屏结构性两行：第一行 logo+搜索；第二行 导航(横向滚动)+用户+主题（钉在行尾，
     登录态再宽也不换行、不被滚走） */
  .topbar-search { order: 1; flex: 1 1 100px; max-width: none; min-width: 0; }
  .nav-row { order: 2; width: 100%; margin-left: 0; gap: 8px; }
  .topnav {
    flex: 1 1 0;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .topnav::-webkit-scrollbar { display: none; }
  .topnav button { flex: 0 0 auto; padding: 7px 10px; font-size: 13px; }
  .user-area { flex-shrink: 0; }
  .theme-btn { flex-shrink: 0; }
  .user-name { display: none; }
  .user-btn { padding: 0 10px; gap: 4px; }
  .login-btn { padding: 0 11px; }
  .hero h1 { font-size: 26px; }
  .hero { padding-top: 56px; }
  .container { padding: 0 16px; }
  .history-card { flex: 0 0 168px; }
  .grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
  .section { padding: 0 16px; }
}
</style>
