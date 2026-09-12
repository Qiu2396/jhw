<script setup>
/**
 * 壁纸频道：多源聚合搜索（4K Wallpapers + WallpaperCave）+ 必应每日精选。
 * 模式与漫画/听书一致 —— 服务端代理解析源站，前端拿结构化数据渲染；
 * 缩略图/预览图客户端直连源站（实测无防盗链），「下载」走本站代理落盘为附件。
 */
import { ref, onMounted } from 'vue';
import { wallpaperSearch, wallpaperDaily, wallpaperDetail, wallpaperImgProxy } from '../api.js';
import AppIcon from './AppIcon.vue';

// 热门分类：cat 是 4kwallpapers 的分类直连（比搜索更准），wpc 仍走关键词搜索
const HOT = [
  { label: '风景', kw: 'nature', cat: 'nature' },
  { label: '动漫', kw: 'anime', cat: 'anime' },
  { label: '抽象', kw: 'abstract', cat: 'abstract' },
  { label: '汽车', kw: 'car', cat: 'cars' },
  { label: '游戏', kw: 'game', cat: 'games' },
  { label: '动物', kw: 'animals', cat: 'animals' },
  { label: '建筑', kw: 'architecture', cat: 'architecture' },
  { label: '星空', kw: 'galaxy' },
  { label: '城市', kw: 'city' },
  { label: '极简', kw: 'minimalist' },
  { label: '海洋', kw: 'ocean' },
  { label: '樱花', kw: 'cherry blossom' },
  { label: '极光', kw: 'aurora' }
];

const kw = ref('');
const searching = ref(false);
const searchError = ref('');
const results = ref([]);          // 搜索结果（跨页累加）
const page = ref(0);              // 已加载的页码
const hasMore = ref(false);
const failedSrc = ref([]);        // 本页失败的源名
const activeCat = ref('');        // 当前分类直连（空 = 关键词搜索）
const stage = ref('daily');       // daily 每日精选 | result 搜索结果
const daily = ref([]);
const dailyLoading = ref(false);
const dailyLoadingMore = ref(false);
const dailyError = ref('');
const dailyPage = ref(0);
const dailyHasMore = ref(false);

// 预览灯箱
const preview = ref(null);        // 当前预览的壁纸条目
const detail = ref(null);         // 详情解析结果（下载列表等）
const detailLoading = ref(false);
const detailError = ref('');

async function loadDaily() {
  if (daily.value.length || dailyLoading.value) return;
  await fetchDailyPage(1);
}

async function loadMoreDaily() {
  if (dailyLoadingMore.value || !dailyHasMore.value) return;
  await fetchDailyPage(dailyPage.value + 1);
}

async function fetchDailyPage(p) {
  if (p === 1) dailyLoading.value = true;
  else dailyLoadingMore.value = true;
  dailyError.value = '';
  try {
    const d = await wallpaperDaily(p);
    const fresh = d.wallpapers || [];
    if (p === 1) daily.value = fresh;
    else {
      const seen = new Set(daily.value.map(x => x.id));
      daily.value.push(...fresh.filter(x => !seen.has(x.id)));
    }
    dailyPage.value = p;
    dailyHasMore.value = !!d.hasMore && fresh.length > 0;
  } catch (e) {
    dailyError.value = e.message;
  } finally {
    dailyLoading.value = false;
    dailyLoadingMore.value = false;
  }
}

async function doSearch(word, cat = '') {
  const w = (word ?? kw.value).trim();
  if ((!w && !cat) || searching.value) return;
  kw.value = w;
  activeCat.value = cat;
  searching.value = true;
  searchError.value = '';
  results.value = [];
  page.value = 0;
  failedSrc.value = [];
  stage.value = 'result';
  await fetchPage(1);
  searching.value = false;
}

async function loadMore() {
  if (searching.value || !hasMore.value) return;
  searching.value = true;
  await fetchPage(page.value + 1);
  searching.value = false;
}

async function fetchPage(p) {
  try {
    const d = await wallpaperSearch(kw.value, p, activeCat.value);
    const fresh = d.wallpapers || [];
    const seen = new Set(results.value.map(x => x.id));
    results.value.push(...fresh.filter(x => !seen.has(x.id)));
    page.value = p;
    hasMore.value = fresh.length > 0;
    failedSrc.value = d.failed || [];
    if (p === 1 && !results.value.length) searchError.value = failedSrc.value.length
      ? `搜索失败：${failedSrc.value.join('、')}`
      : '';
  } catch (e) {
    searchError.value = e.message;
    hasMore.value = false;
  }
}

async function openPreview(item) {
  preview.value = item;
  detail.value = null;
  detailError.value = '';
  if (item.downloads) { detail.value = { preview: item.preview, downloads: item.downloads }; return; }
  detailLoading.value = true;
  try {
    detail.value = await wallpaperDetail(item.sourceId, item.detailUrl);
  } catch (e) {
    detailError.value = e.message;
  } finally {
    detailLoading.value = false;
  }
}

function closePreview() {
  preview.value = null;
  detail.value = null;
}

function dlName(item, dl) {
  const base = (item.title || 'wallpaper').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 60);
  return `${base}-${dl.label}`;
}

onMounted(loadDaily);
</script>

<template>
  <div class="wp container">
    <h2 class="page-h"><AppIcon name="image" :size="21" class="h-icon" /> 壁纸</h2>
    <p class="page-desc">聚合必应图片、4K Wallpapers、WallpaperCave 的免费壁纸，附必应每日精选；中英文都能搜，点开可按 4K / 2K / 手机分辨率下载。</p>

    <form class="wp-search" @submit.prevent="doSearch()">
      <input v-model="kw" placeholder="搜索壁纸，中英文均可：风景 / 赛博朋克 / mountain" maxlength="40" />
      <button class="btn primary" type="submit" :disabled="searching">
        <span v-if="searching" class="spin"></span> 搜索
      </button>
    </form>

    <div class="wp-hot">
      <button
        v-for="h in HOT" :key="h.cat || h.kw"
        class="chip" :class="{ active: stage === 'result' && activeCat === (h.cat || '') && kw === h.kw }"
        @click="doSearch(h.kw, h.cat || '')"
      >{{ h.label }}</button>
    </div>

    <p v-if="searchError" class="wp-error">⚠ {{ searchError }}</p>

    <!-- 搜索结果 -->
    <template v-if="stage === 'result'">
      <p class="dim wp-count" v-if="results.length">「{{ kw }}」的结果<span v-if="failedSrc.length" class="dim">（{{ failedSrc.join('、') }} 暂时失败）</span></p>
      <div v-if="results.length" class="wp-grid">
        <div v-for="w in results" :key="w.id" class="wp-card" title="点击预览 / 下载" @click="openPreview(w)">
          <img :src="w.thumb" loading="lazy" @error="e => e.target.style.opacity = 0" />
          <span v-if="w.badge" class="wp-badge">{{ w.badge }}</span>
          <span class="wp-src">{{ w.sourceName }}</span>
          <div class="wp-cap">{{ w.title }}</div>
        </div>
      </div>
      <div v-if="searching && page" class="wp-center"><span class="spin"></span> 正在加载更多…</div>
      <div class="wp-more-row" v-if="hasMore && !searching">
        <button class="btn" @click="loadMore">加载更多</button>
      </div>
      <p v-if="!searching && !results.length && !searchError" class="dim wp-empty">没找到相关壁纸，换个词试试（中文英文都行）🖼</p>
    </template>

    <!-- 每日精选（默认态） -->
    <template v-if="stage === 'daily'">
      <div class="wp-sec-head">
        <h3 class="blk-title"><AppIcon name="clock" :size="15" /> 每日精选 · 图集</h3>
        <span class="dim wp-sec-tip">必应每日壁纸（含 4K UHD）+ Picsum 摄影图</span>
        <button v-if="dailyHasMore && !dailyLoading" class="btn small" @click="loadMoreDaily">
          {{ dailyLoadingMore ? '加载中…' : '加载往期' }}
        </button>
      </div>
      <div v-if="dailyLoading" class="wp-center"><span class="spin"></span> 正在获取每日壁纸…</div>
      <p v-else-if="dailyError" class="wp-error">⚠ {{ dailyError }}（每日精选不可用不影响搜索）</p>
      <div v-else class="wp-grid">
        <div v-for="w in daily" :key="w.id" class="wp-card" title="点击预览 / 下载" @click="openPreview(w)">
          <img :src="w.thumb" loading="lazy" @error="e => e.target.style.opacity = 0" />
          <span class="wp-badge">{{ w.badge }}</span>
          <div class="wp-cap">{{ w.title }}</div>
        </div>
      </div>
    </template>

    <!-- 预览灯箱：Teleport 到 body，fixed 定位不受任何祖先 transform 影响 -->
    <Teleport to="body">
      <div v-if="preview" class="lb-mask" @click.self="closePreview">
        <div class="lb-top">
          <span class="lb-title" :title="preview.title">{{ preview.title }}</span>
          <span class="badge">{{ preview.sourceName }}</span>
          <button class="lb-close" title="关闭预览" @click="closePreview"><AppIcon name="x" :size="16" /></button>
        </div>
        <div class="lb-body">
          <img :src="preview.preview || preview.thumb" :alt="preview.title" @error="e => e.target.src = preview.thumb" />
        </div>
        <div class="lb-foot">
          <template v-if="detailLoading"><span class="spin"></span> <span class="dim">正在解析原图地址…</span></template>
          <template v-else-if="detailError"><span class="wp-error">⚠ {{ detailError }}</span></template>
          <template v-else-if="detail?.downloads?.length">
            <span class="dim lb-dl-tip">下载</span>
            <a
              v-for="d in detail.downloads"
              :key="d.url"
              class="chip dl"
              :href="d.direct ? d.url : wallpaperImgProxy(d.url, dlName(preview, d))"
              target="_blank"
              rel="noopener"
            ><AppIcon name="download" :size="12" /> {{ d.label }}<i v-if="d.note" class="dl-note">{{ d.note }}</i></a>
          </template>
          <a class="lb-src dim" :href="preview.detailUrl" target="_blank" rel="noopener">打开源页面 ↗</a>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.wp { padding-top: 34px; animation: rise 0.35s ease; }
.page-h { display: flex; align-items: center; gap: 9px; margin: 0 0 6px; }
.h-icon { color: var(--gold); }
.page-desc { color: var(--text-dim); margin: 0 0 20px; font-size: 14px; }

.wp-search { display: flex; gap: 10px; margin-bottom: 12px; }
.wp-search input {
  flex: 1; min-width: 0; max-width: 460px;
  height: 38px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0 14px;
  color: var(--text); font-size: 14px; outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.wp-search input:focus { border-color: rgba(242, 185, 75, 0.5); box-shadow: 0 0 0 3px rgba(242, 185, 75, 0.1); }
.wp-search .btn { height: 38px; }

.wp-hot { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 22px; }
.chip {
  padding: 5px 13px;
  border-radius: 999px;
  font-size: 12.5px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-dim);
  transition: all 0.15s;
}
.chip:hover { color: var(--gold); border-color: rgba(242, 185, 75, 0.45); }
.chip.active { color: var(--gold); border-color: rgba(242, 185, 75, 0.5); background: var(--gold-soft); }

.wp-error { color: var(--red); font-size: 14px; margin: 0 0 14px; }
.wp-center { display: flex; align-items: center; gap: 10px; color: var(--text-dim); padding: 26px 0; justify-content: center; }
.wp-empty { text-align: center; padding: 60px 0; }
.wp-count { margin: 0 0 12px; font-size: 13px; }

.wp-sec-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.blk-title { display: flex; align-items: center; gap: 7px; font-size: 15px; margin: 0; color: var(--gold); }
.wp-sec-tip { font-size: 12px; }

.wp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-bottom: 22px; }
.wp-card {
  position: relative;
  border-radius: 11px;
  overflow: hidden;
  cursor: pointer;
  aspect-ratio: 16 / 10;
  background: var(--surface-2);
  border: 1px solid var(--border);
  transition: border-color 0.18s, transform 0.18s;
}
.wp-card:hover { border-color: rgba(242, 185, 75, 0.45); transform: translateY(-2px); }
.wp-card img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.25s ease, opacity 0.2s; }
.wp-card:hover img { transform: scale(1.045); }
.wp-badge {
  position: absolute; top: 8px; right: 8px;
  padding: 2px 8px;
  font-size: 11px; font-weight: 600;
  border-radius: 999px;
  color: var(--gold);
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
}
.wp-src {
  position: absolute; top: 8px; left: 8px;
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(0, 0, 0, 0.45);
  opacity: 0;
  transition: opacity 0.18s;
}
.wp-card:hover .wp-src { opacity: 1; }
.wp-cap {
  position: absolute; inset: auto 0 0 0;
  padding: 22px 10px 8px;
  font-size: 12px;
  color: #fff;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.72));
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  opacity: 0;
  transition: opacity 0.18s;
}
.wp-card:hover .wp-cap { opacity: 1; }

.wp-more-row { text-align: center; padding: 4px 0 26px; }

/* ---- 预览灯箱 ---- */
.lb-mask {
  position: fixed; inset: 0; z-index: 110;
  background: rgba(8, 8, 12, 0.88);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex; flex-direction: column;
  padding: 14px 16px calc(12px + env(safe-area-inset-bottom, 0));
  animation: fade-in 0.18s ease both;
}
.lb-top { display: flex; align-items: center; gap: 10px; flex-shrink: 0; padding-bottom: 10px; }
.lb-title { color: #eee; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.lb-close {
  width: 34px; height: 34px;
  border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  color: #ccc;
  background: rgba(255, 255, 255, 0.08);
  transition: all 0.15s;
}
.lb-close:hover { color: #fff; background: rgba(255, 255, 255, 0.16); }
.lb-body { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.lb-body img {
  max-width: 100%; max-height: 100%;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
}
.lb-foot {
  flex-shrink: 0;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding-top: 12px;
  max-height: 30vh; overflow-y: auto;
}
.lb-dl-tip { font-size: 12.5px; flex-shrink: 0; }
.chip.dl {
  display: inline-flex; align-items: center; gap: 5px;
  color: var(--gold);
  border-color: rgba(242, 185, 75, 0.4);
  background: var(--gold-soft);
  font-weight: 600;
}
.chip.dl:hover { border-color: rgba(242, 185, 75, 0.65); background: var(--gold-soft); }
.dl-note { font-style: normal; font-weight: 400; font-size: 11px; color: var(--text-faint); }
.lb-src { margin-left: auto; font-size: 12.5px; color: var(--text-faint); flex-shrink: 0; }
.lb-src:hover { color: var(--gold); }

/* ---- 移动端 H5 ---- */
@media (max-width: 720px) {
  .wp { padding-top: 22px; }
  .wp-search input { font-size: 16px; }   /* ≥16px 防 iOS 聚焦自动放大 */
  .wp-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .lb-mask { padding: 10px 10px calc(10px + env(safe-area-inset-bottom, 0)); }
  .lb-foot { max-height: 24vh; }
  .lb-src { width: 100%; margin-left: 0; }
}
</style>
