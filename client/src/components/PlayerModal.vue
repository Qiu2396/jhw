<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import Hls from 'hls.js';
import { getDetail } from '../api.js';

const props = defineProps({
  group: { type: Object, required: true },
  resume: { type: Object, default: null }   // {sourceId, episodeUrl} 从「继续观看」进入
});
const emit = defineEmits(['close', 'played']);

const detail = ref(null);          // 当前源详情 {plays:[{from, episodes:[{name,url}]}]}
const loading = ref(false);
const error = ref('');
const activeSourceId = ref('');    // 当前使用的资源站 sourceId
const activeFrom = ref('');        // 当前播放线路
const currentUrl = ref('');
const currentName = ref('');
const videoEl = ref(null);
const bodyEl = ref(null);
const rate = ref(1);               // 倍速
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

let hls = null;
let pendingSeek = 0;               // 续播待跳转的秒数
let progressTimer = null;

const activeSource = computed(() =>
  props.group.sources.find(s => s.sourceId === activeSourceId.value) || props.group.sources[0]
);
const currentPlay = computed(() =>
  detail.value?.plays.find(p => p.from === activeFrom.value) || detail.value?.plays[0]
);
const epIndex = computed(() =>
  currentPlay.value ? currentPlay.value.episodes.findIndex(e => e.url === currentUrl.value) : -1
);

function recordPayload() {
  const g = props.group;
  return {
    key: g.key,
    title: g.title,
    cover: g.cover,
    year: g.year || '',
    type: g.type || '',
    remarks: activeSource.value?.remarks || '',
    sourceId: activeSourceId.value,
    sourceName: activeSource.value?.sourceName || '',
    vodId: activeSource.value?.vodId || '',
    episodeName: currentName.value,
    episodeUrl: currentUrl.value
  };
}

/** 把当前播放进度写入「继续观看」（不改变排序） */
function saveProgressNow() {
  const v = videoEl.value;
  if (v && currentUrl.value && v.currentTime > 5) {
    emit('progress', { ...recordPayload(), progress: Math.floor(v.currentTime) });
  }
}

function play(name, url, seekSec = 0) {
  saveProgressNow();               // 切走前保存上一集进度
  currentName.value = name;
  currentUrl.value = url;
  pendingSeek = seekSec;
  nextTick(() => setupVideo(url));
  emit('played', recordPayload());
  startProgressTimer();
}

function setupVideo(url) {
  const video = videoEl.value;
  if (!video) return;
  destroyHls();
  const applySeek = () => {
    // duration 在 loadedmetadata 后才可靠（MANIFEST_PARSED 时可能仍为 NaN）
    if (pendingSeek > 0 && isFinite(video.duration) && video.duration > 0) {
      video.currentTime = Math.min(pendingSeek, Math.max(video.duration - 10, 0));
      pendingSeek = 0;
    }
    video.playbackRate = rate.value;
  };
  video.addEventListener('loadedmetadata', applySeek, { once: true });
  if (Hls.isSupported()) {
    hls = new Hls({ maxBufferLength: 30 });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) error.value = '视频加载失败，该集地址可能已失效，试试其他集或「换个源」。';
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url; // Safari 原生 HLS
  } else {
    error.value = '当前浏览器不支持 HLS 播放';
  }
}

function startProgressTimer() {
  clearInterval(progressTimer);
  progressTimer = setInterval(saveProgressNow, 15000);
}

function destroyHls() {
  if (hls) { hls.destroy(); hls = null; }
}

function playAt(offset) {
  const list = currentPlay.value?.episodes;
  if (!list) return;
  const target = list[epIndex.value + offset];
  if (target) play(target.name, target.url);
}

function setRate(r) {
  rate.value = r;
  if (videoEl.value) videoEl.value.playbackRate = r;
}

async function loadDetail(sourceId, vodId, { preferEpisodeUrl = '', preferProgress = 0 } = {}) {
  loading.value = true;
  error.value = '';
  detail.value = null;
  try {
    const d = await getDetail(sourceId, vodId);
    detail.value = d;
    activeSourceId.value = sourceId;
    // 选线路：优先集数最多的
    const plays = [...d.plays].sort((a, b) => b.episodes.length - a.episodes.length);
    const target = plays[0];
    activeFrom.value = target?.from || '';
    // 定位首集 / 继续观看的集
    let ep = target?.episodes[0];
    if (preferEpisodeUrl && target) {
      ep = target.episodes.find(e => e.url === preferEpisodeUrl) || ep;
    }
    if (ep) play(ep.name, ep.url, preferProgress);
  } catch (e) {
    error.value = e.message || '获取详情失败';
  } finally {
    loading.value = false;
  }
}

function switchSource(s) {
  if (s.sourceId === activeSourceId.value) return;
  loadDetail(s.sourceId, s.vodId);
}

function switchFrom(from) {
  activeFrom.value = from;
}

watch(() => props.group, () => {
  const first = props.group.sources[0];
  const resumeSrc = props.resume?.sourceId &&
    props.group.sources.find(s => s.sourceId === props.resume.sourceId);
  const target = resumeSrc || first;
  if (target) loadDetail(target.sourceId, target.vodId, {
    preferEpisodeUrl: resumeSrc ? props.resume?.episodeUrl : '',
    preferProgress: resumeSrc ? (props.resume?.progress || 0) : 0
  });
}, { immediate: true });

function onKeydown(e) {
  if (e.key === 'Escape') {
    saveProgressNow();
    emit('close');
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  document.body.style.overflow = 'hidden';
  nextTick(() => bodyEl.value?.focus());
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = '';
  clearInterval(progressTimer);
  saveProgressNow();
  destroyHls();
});
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="modal" ref="bodyEl" tabindex="-1">
      <div class="modal-head">
        <div class="head-info">
          <h3>{{ group.title }}</h3>
          <span v-if="group.year" class="badge">{{ group.year }}</span>
          <span v-if="group.type" class="badge">{{ group.type }}</span>
          <span v-if="activeSource" class="badge gold">{{ activeSource.sourceName }}</span>
        </div>
        <div class="head-actions">
          <span v-if="currentName" class="now-playing">正在播放：{{ currentName }}</span>
          <button class="btn small" @click="saveProgressNow(); emit('close')">关闭 ✕</button>
        </div>
      </div>

      <div class="modal-body">
        <div class="player-side">
          <div v-if="loading && !detail" class="player-tip"><span class="spin"></span> 正在获取播放地址…</div>
          <div v-else-if="error && !currentUrl" class="player-tip error">{{ error }}</div>
          <video
            v-show="currentUrl"
            ref="videoEl"
            controls
            autoplay
            playsinline
            class="video"
          ></video>
          <div v-if="currentUrl && error" class="player-error-note">{{ error }}</div>

          <div v-if="currentPlay && epIndex >= 0" class="ctrl-bar">
            <button class="btn small" :disabled="epIndex <= 0" @click="playAt(-1)">⏮ 上一集</button>
            <button
              class="btn small"
              :disabled="epIndex >= currentPlay.episodes.length - 1"
              @click="playAt(1)"
            >下一集 ⏭</button>
            <div class="rates">
              <button
                v-for="r in RATES"
                :key="r"
                class="rate-btn"
                :class="{ on: rate === r }"
                @click="setRate(r)"
              >{{ r }}x</button>
            </div>
          </div>

          <div v-if="currentPlay" class="blurb">
            <div v-if="detail.actor || detail.director" class="credit">
              <span v-if="detail.director">导演：{{ detail.director }}</span>
              <span v-if="detail.actor">主演：{{ detail.actor }}</span>
            </div>
            <p v-if="detail.blurb">{{ detail.blurb.slice(0, 160) }}{{ detail.blurb.length > 160 ? '…' : '' }}</p>
          </div>
        </div>

        <div class="list-side">
          <div class="side-label">切换站点</div>
          <div class="src-tabs">
            <button
              v-for="s in group.sources"
              :key="s.sourceId + s.vodId"
              class="src-tab"
              :class="{ active: s.sourceId === activeSourceId }"
              :title="s.remarks"
              @click="switchSource(s)"
            >{{ s.sourceName }}</button>
          </div>

          <div v-if="loading" class="ep-tip"><span class="spin"></span> 加载剧集…</div>
          <template v-else-if="currentPlay">
            <div v-if="detail.plays.length > 1" class="side-label">
              线路
              <span class="line-tabs">
                <button
                  v-for="p in detail.plays"
                  :key="p.from"
                  class="line-tab"
                  :class="{ active: p.from === (currentPlay?.from) }"
                  @click="switchFrom(p.from)"
                >{{ p.from }}</button>
              </span>
            </div>
            <div class="side-label">{{ currentPlay.episodes.length }} 集</div>
            <div class="ep-list">
              <button
                v-for="ep in currentPlay.episodes"
                :key="ep.url"
                class="ep"
                :class="{ active: ep.url === currentUrl }"
                @click="play(ep.name, ep.url)"
              >{{ ep.name }}</button>
            </div>
          </template>
          <div v-else-if="!loading" class="ep-tip dim">该源暂无剧集数据</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(5, 7, 11, 0.8);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  animation: fade-in 0.18s ease both;
}
.modal {
  width: 100%;
  max-width: 1080px;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  overflow: hidden;
  outline: none;
  box-shadow: var(--shadow-2);
  animation: pop-in 0.22s ease both;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 15px 20px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.head-info { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.head-info h3 { margin: 0; font-size: 17px; }
.head-actions { display: flex; align-items: center; gap: 12px; }
.now-playing { font-size: 13px; color: var(--gold); }

.modal-body {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 18px;
  padding: 18px 20px 20px;
  overflow: hidden;
  flex: 1;
  min-height: 0;
}
.player-side { min-width: 0; display: flex; flex-direction: column; }
.video {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: 10px;
  outline: none;
  box-shadow: var(--shadow-1);
}
.player-tip {
  width: 100%;
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-dim);
  background: var(--bg-soft);
  border-radius: 10px;
}
.player-tip.error { color: var(--red); }
.player-error-note {
  margin-top: 8px;
  font-size: 13px;
  color: var(--red);
}
.ctrl-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.rates { display: flex; gap: 4px; margin-left: auto; }
.rate-btn {
  padding: 4px 9px;
  border-radius: 7px;
  font-size: 12px;
  color: var(--text-faint);
  background: var(--surface-2);
  border: 1px solid var(--border);
  transition: all 0.13s;
}
.rate-btn:hover { color: var(--text); }
.rate-btn.on { color: var(--gold); border-color: rgba(242, 185, 75, 0.45); background: var(--gold-soft); }
.blurb { margin-top: 14px; font-size: 13px; color: var(--text-dim); }
.credit { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 6px; color: var(--text-faint); }
.credit span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.blurb p { margin: 0; line-height: 1.75; }

.list-side { display: flex; flex-direction: column; min-height: 0; }
.side-label { font-size: 12px; color: var(--text-faint); margin: 4px 0 8px; display: flex; align-items: center; gap: 10px; }
.src-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.src-tab {
  padding: 5px 13px;
  border-radius: 8px;
  font-size: 13px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-dim);
  transition: all 0.15s;
}
.src-tab:hover { color: var(--text); border-color: var(--border-strong); }
.src-tab.active {
  background: var(--gold-soft);
  border-color: rgba(242, 185, 75, 0.5);
  color: var(--gold);
  font-weight: 600;
}
.line-tabs { display: flex; gap: 5px; }
.line-tab {
  padding: 2px 10px;
  border-radius: 6px;
  font-size: 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-dim);
}
.line-tab.active { color: var(--blue); border-color: rgba(90, 168, 255, 0.4); }
.ep-tip { display: flex; align-items: center; gap: 8px; color: var(--text-dim); padding: 20px 0; }
.ep-list {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 6px;
  align-content: start;
  padding-right: 4px;
}
.ep {
  padding: 7px 4px;
  border-radius: 7px;
  font-size: 12px;
  text-align: center;
  background: var(--surface-2);
  border: 1px solid transparent;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: all 0.13s;
}
.ep:hover { color: var(--text); border-color: var(--border-strong); transform: translateY(-1px); }
.ep.active {
  background: var(--gold-soft);
  border-color: rgba(242, 185, 75, 0.55);
  color: var(--gold);
  font-weight: 600;
}

@media (max-width: 860px) {
  .modal-body { grid-template-columns: 1fr; overflow-y: auto; }
  .list-side { max-height: 320px; }
  .mask { padding: 10px; }
}
</style>
