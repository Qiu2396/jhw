<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import SearchBar from './components/SearchBar.vue';
import ResultCard from './components/ResultCard.vue';
import PlayerModal from './components/PlayerModal.vue';
import SourcesView from './components/SourcesView.vue';
import { search, getSources } from './api.js';

const view = ref('home');          // home | result | sites
const kw = ref('');
const searching = ref(false);
const searchError = ref('');
const groups = ref([]);
const failed = ref([]);
const tookMs = ref(0);

const hotKeywords = ref([]);
const navSites = ref([]);
const sources = ref([]);

const activeGroup = ref(null);     // 打开播放弹窗的聚合条目
const resumeItem = ref(null);      // 从「继续观看」进入的条目 {sourceId, episodeUrl}

const HISTORY_KEY = 'fv_history';
const FAV_KEY = 'fv_favorites';
const DISABLED_KEY = 'fv_disabled_sources';
const history = ref([]);
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

function loadHistory() {
  try { history.value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch { history.value = []; }
}

function saveHistory(item) {
  const old = history.value.find(h => h.key === item.key && h.episodeUrl === item.episodeUrl);
  const progress = item.progress !== undefined ? item.progress : (old?.progress || 0);
  const list = history.value.filter(h => !(h.key === item.key && h.episodeUrl === item.episodeUrl));
  list.unshift({ ...item, progress, ts: Date.now() });
  history.value = list.slice(0, 12);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value));
}

function saveProgress(item) {
  // 只更新进度，不改变排序位置
  const h = history.value.find(x => x.key === item.key && x.episodeUrl === item.episodeUrl);
  if (h) {
    h.progress = item.progress;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value));
  }
}

function clearHistory() {
  history.value = [];
  localStorage.removeItem(HISTORY_KEY);
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
  history.value = history.value.filter(x => x !== h);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value));
}

function parseHash() {
  const h = decodeURIComponent(location.hash || '');
  if (h.startsWith('#/search/')) {
    const word = h.slice('#/search/'.length);
    if (word && word !== kw.value) doSearch(word);
    else if (word) view.value = 'result';
  } else if (h === '#/sites') {
    view.value = 'sites';
  } else if (h === '' || h === '#/') {
    view.value = 'home';
  }
}

onMounted(async () => {
  loadHistory();
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
        <span class="logo-icon">▶</span>
        <span class="logo-text">聚搜影视</span>
        <span class="logo-sub">免费视频聚合导航</span>
      </div>
      <div class="topbar-search">
        <SearchBar v-if="view !== 'home'" :initial="kw" :compact="true" @search="doSearch" />
      </div>
      <nav class="topnav">
        <button :class="{ active: view !== 'sites' }" @click="goHome">首页</button>
        <button :class="{ active: view === 'sites' }" @click="goSites">站点目录</button>
      </nav>
    </div>
  </header>

  <main class="main">
    <!-- 首页 -->
    <div v-if="view === 'home'" class="home">
      <section class="hero">
        <h1>一部作品，<span class="grad">哪里能看</span>，一搜便知</h1>
        <p class="hero-sub">聚合搜索多个免费视频资源站 · 在线播放 · 无需注册</p>
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
          <h2>⭐ 我的收藏</h2>
        </div>
        <div class="history-row">
          <div v-for="f in favorites" :key="'fav-' + f.key" class="history-card" @click="resumeFav(f)">
            <img v-if="f.cover" :src="f.cover" loading="lazy" @error="e => e.target.style.display = 'none'" />
            <div v-else class="cover-fallback">{{ f.title.slice(0, 1) }}</div>
            <div class="history-info">
              <div class="history-title">{{ f.title }}</div>
              <div class="history-ep">{{ f.remarks || f.type || '已收藏' }}</div>
            </div>
            <button class="history-del fav-del" title="取消收藏" @click.stop="removeFav(f)">✕</button>
          </div>
        </div>
      </section>

      <section v-if="history.length" class="section">
        <div class="section-head">
          <h2>继续观看</h2>
          <button class="btn small" @click="clearHistory">清空</button>
        </div>
        <div class="history-row">
          <div v-for="h in history" :key="h.key + h.episodeUrl" class="history-card" @click="resumePlay(h)">
            <img v-if="h.cover" :src="h.cover" loading="lazy" @error="e => e.target.style.display = 'none'" />
            <div v-else class="cover-fallback">{{ h.title.slice(0, 1) }}</div>
            <div class="history-info">
              <div class="history-title">{{ h.title }}</div>
              <div class="history-ep">{{ h.episodeName }} · {{ h.sourceName }}</div>
            </div>
            <button class="history-del" title="删除" @click.stop="removeHistory(h)">✕</button>
          </div>
        </div>
      </section>

      <section class="section features">
        <div class="feature">
          <div class="feature-icon">🔍</div>
          <h3>聚合搜索</h3>
          <p>一次输入，同时查询收录的多个免费资源站，按片名自动聚合去重。</p>
        </div>
        <div class="feature">
          <div class="feature-icon">📺</div>
          <h3>站内播放</h3>
          <p>自动解析剧集播放地址（m3u8），内置播放器直接观看，支持选集与换源。</p>
        </div>
        <div class="feature">
          <div class="feature-icon">🗂️</div>
          <h3>站点目录</h3>
          <p>收录可用资源站与正版免费平台，标注状态，随时了解哪些站活着。</p>
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

    <!-- 站点目录 -->
    <SourcesView v-else :sources="sources" :nav-sites="navSites" />
  </main>

  <footer class="footer">
    <div class="container">
      <p>本工具仅聚合公开搜索接口与链接，不存储、不上传任何视频文件。视频内容均来自第三方站点。</p>
      <p>请在观看时支持正版平台 · 如内容涉及侵权请联系相应站点删除</p>
    </div>
  </footer>

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
  background: rgba(10, 12, 17, 0.8);
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
  color: #201301;
  font-size: 12px;
  box-shadow: var(--shadow-gold);
  padding-left: 2px;
}
.logo-text { font-size: 19px; font-weight: 700; letter-spacing: 0.5px; }
.logo-sub { font-size: 12px; color: var(--text-faint); }
.topbar-search { flex: 1; max-width: 480px; }
.topnav { display: flex; gap: 4px; margin-left: auto; }
.topnav button {
  padding: 7px 15px;
  border-radius: 9px;
  color: var(--text-dim);
  font-size: 14px;
  transition: all 0.15s;
}
.topnav button:hover { color: var(--text); background: var(--surface-2); }
.topnav button.active { color: var(--gold); background: var(--gold-soft); }

.main { flex: 1; padding-bottom: 70px; }

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
  background: rgba(255, 255, 255, 0.03);
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
  background: linear-gradient(135deg, #2a3350, #1b2032);
  color: var(--gold);
  font-size: 20px;
  font-weight: 700;
}
.history-info { min-width: 0; }
.history-title { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-ep { font-size: 12px; color: var(--text-faint); margin-top: 3px; }
.history-del {
  position: absolute; top: 4px; right: 6px;
  color: var(--text-faint); font-size: 12px;
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
.feature-icon { font-size: 26px; margin-bottom: 12px; }
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
  gap: 18px;
}

.footer {
  border-top: 1px solid var(--border);
  padding: 24px 0 32px;
  color: var(--text-faint);
  font-size: 12px;
  text-align: center;
  background: rgba(255, 255, 255, 0.01);
}
.footer p { margin: 4px 0; }

@media (max-width: 720px) {
  .logo-sub { display: none; }
  .topbar-search { max-width: none; }
  .hero h1 { font-size: 26px; }
  .hero { padding-top: 56px; }
  .container { padding: 0 16px; }
}
</style>
