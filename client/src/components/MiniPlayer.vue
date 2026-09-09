<script setup>
/**
 * 底部常驻迷你播放条：挂在 App.vue 根部、不随页面切换卸载，
 * 所以切到小说页/首页音乐照常播放。队列与歌词面板也从这里展开。
 */
import { ref, computed, watch, nextTick } from 'vue';
import { useMusicPlayer } from '../musicStore.js';
import PelicanRider from './PelicanRider.vue';
import AppIcon from './AppIcon.vue';

const {
  queue, currentIdx, playing, buffering, error,
  currentTime, duration, bufferedEnd, volume, mode,
  lyricLines, lyricIdx, currentSong,
  toggle, jump, playAt, seek, setVolume, cycleMode, removeAt, clearQueue
} = useMusicPlayer();

const MODE_META = {
  order:   { icon: 'arrow-right', label: '顺序播放' },
  loop:    { icon: 'repeat',      label: '列表循环' },
  one:     { icon: 'repeat-1',    label: '单曲循环' },
  shuffle: { icon: 'shuffle',     label: '随机播放' }
};
const modeMeta = computed(() => MODE_META[mode.value] || MODE_META.order);

const panelTab = ref('');          // '' | 'queue' | 'lyric'
const lyricsEl = ref(null);
const barEl = ref(null);

const pct = computed(() => duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0);
const bufPct = computed(() => duration.value > 0 ? Math.min((bufferedEnd.value / duration.value) * 100, 100) : 0);
const curLyric = computed(() => lyricLines.value[lyricIdx.value]?.text || '');

function fmt(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function volIconName() {
  if (volume.value === 0) return 'volume-x';
  return volume.value < 0.5 ? 'volume-1' : 'volume-2';
}

// ---- 进度条拖拽 seek ----
let dragging = false;
function posToTime(e) {
  const el = barEl.value;
  if (!el || !duration.value) return 0;
  const r = el.getBoundingClientRect();
  const ratio = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
  return ratio * duration.value;
}
function onBarDown(e) {
  dragging = true;
  seek(posToTime(e));
  window.addEventListener('pointermove', onBarMove);
  window.addEventListener('pointerup', onBarUp);
}
function onBarMove(e) { if (dragging) seek(posToTime(e)); }
function onBarUp() {
  dragging = false;
  window.removeEventListener('pointermove', onBarMove);
  window.removeEventListener('pointerup', onBarUp);
}

// ---- 歌词面板自动滚动到当前行 ----
watch(lyricIdx, async () => {
  if (panelTab.value !== 'lyric') return;
  await nextTick();
  const box = lyricsEl.value;
  const cur = box?.querySelector('.lrc.cur');
  if (box && cur) box.scrollTop = cur.offsetTop - box.clientHeight / 2 + cur.clientHeight / 2;
});

watch(queue, (q) => { if (!q.length) panelTab.value = ''; });

function togglePanel(tab) {
  panelTab.value = panelTab.value === tab ? '' : tab;
}
</script>

<template>
  <Transition name="mp-rise">
    <div v-if="queue.length" class="mini">
      <!-- 顶部细进度条（可拖拽） -->
      <div class="progress" ref="barEl" @pointerdown="onBarDown">
        <div class="p-buf" :style="{ width: bufPct + '%' }"></div>
        <div class="p-fill" :style="{ width: pct + '%' }"><span class="p-dot"></span></div>
      </div>

      <div class="mini-inner">
        <!-- 左：封面 + 信息 -->
        <div class="m-left">
          <!-- 唱片位常驻鹈鹕骑车：播放时蹬车前进，暂停时定格 -->
          <div class="disc">
            <PelicanRider :size="36" :paused="!playing" />
          </div>
          <div class="m-meta">
            <div class="m-name" :title="currentSong?.name">{{ currentSong?.name }}</div>
            <div class="m-sub" :class="{ err: error }">
              <template v-if="error">⚠ {{ error }}</template>
              <template v-else-if="buffering"><span class="spin"></span> 缓冲中…</template>
              <template v-else>{{ currentSong?.artist }}<template v-if="curLyric"> · {{ curLyric }}</template></template>
            </div>
          </div>
        </div>

        <!-- 中：播放控制 -->
        <div class="m-center">
          <button class="pill" :title="modeMeta.label" @click="cycleMode">
            <AppIcon :name="modeMeta.icon" :size="13" /><span class="pill-txt">{{ modeMeta.label }}</span>
          </button>
          <button class="ctrl" title="上一首" @click="jump(-1)"><AppIcon name="skip-back" :size="16" /></button>
          <button class="ctrl play" :title="playing ? '暂停' : '播放'" @click="toggle">
            <span v-if="buffering" class="spin dark"></span>
            <AppIcon v-else :name="playing ? 'pause' : 'play'" :size="18" />
          </button>
          <button class="ctrl" title="下一首" @click="jump(1)"><AppIcon name="skip-forward" :size="16" /></button>
        </div>

        <!-- 右：时间 / 音量 / 面板 / 关闭 -->
        <div class="m-right">
          <span class="time">{{ fmt(currentTime) }} / {{ fmt(duration) }}</span>
          <div class="vol">
            <button class="ctrl" :title="volume === 0 ? '取消静音' : '静音'" @click="setVolume(volume === 0 ? 0.9 : 0)">
              <AppIcon :name="volIconName()" :size="16" />
            </button>
            <input
              type="range" min="0" max="1" step="0.02"
              :value="volume"
              title="音量"
              @input="e => setVolume(parseFloat(e.target.value))"
            />
          </div>
          <button class="ctrl" :class="{ on: panelTab === 'lyric' }" title="歌词" @click="togglePanel('lyric')"><AppIcon name="audio-lines" :size="15" /></button>
          <button class="ctrl" :class="{ on: panelTab === 'queue' }" title="播放列表" @click="togglePanel('queue')"><AppIcon name="list" :size="15" /></button>
          <button class="ctrl close" title="停止并清空播放列表" @click="clearQueue"><AppIcon name="x" :size="15" /></button>
        </div>
      </div>

      <!-- 上浮面板：歌词 / 播放列表 -->
      <Transition name="mp-panel">
        <div v-if="panelTab" class="panel">
          <div v-if="panelTab === 'lyric'" class="lyrics" ref="lyricsEl">
            <p v-if="!lyricLines.length" class="lrc none">暂无歌词</p>
            <p
              v-for="(l, i) in lyricLines"
              :key="i"
              class="lrc"
              :class="{ cur: i === lyricIdx }"
            >{{ l.text }}</p>
          </div>
          <template v-else>
            <div class="q-head">
              <span>播放列表（{{ queue.length }} 首 · {{ modeMeta.label }}）</span>
              <button class="q-clear" @click="clearQueue">清空</button>
            </div>
            <div class="q-list">
              <div
                v-for="(s, i) in queue"
                :key="i"
                class="q-row"
                :class="{ cur: i === currentIdx }"
                @click="playAt(i)"
              >
                <span class="q-idx">
                  <span v-if="i === currentIdx && playing" class="eq"><i></i><i></i><i></i></span>
                  <template v-else>{{ i + 1 }}</template>
                </span>
                <span class="q-name">{{ s.name }}</span>
                <span class="q-artist">{{ s.artist }}</span>
                <button class="q-del" title="移除" @click.stop="removeAt(i)"><AppIcon name="x" :size="12" /></button>
              </div>
            </div>
          </template>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.mini {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  z-index: 60;
  background: var(--topbar-bg);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border-top: 1px solid var(--border);
}

/* ---- 进度条 ---- */
.progress {
  position: relative;
  height: 5px;
  cursor: pointer;
  background: var(--surface-2);
  transition: height 0.12s;
  touch-action: none;
}
.progress:hover { height: 7px; }
.p-buf { position: absolute; left: 0; top: 0; bottom: 0; background: var(--surface-3); }
.p-fill {
  position: absolute; left: 0; top: 0; bottom: 0;
  background: linear-gradient(90deg, var(--gold), var(--gold-2));
}
.p-dot {
  position: absolute; right: -5px; top: 50%;
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--gold);
  transform: translateY(-50%);
  box-shadow: 0 0 0 3px var(--gold-soft);
  opacity: 0;
  transition: opacity 0.12s;
}
.progress:hover .p-dot { opacity: 1; }

/* ---- 主体 ---- */
.mini-inner {
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: 1280px;
  margin: 0 auto;
  padding: 10px 20px;
}
.m-left { display: flex; align-items: center; gap: 13px; min-width: 0; flex: 1; }
.disc {
  width: 46px; height: 46px;
  border-radius: 50%;
  flex-shrink: 0;
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--cover-1), var(--cover-2));
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-1);
  color: var(--gold);
}

/* 正在播放的均衡器小动画 */
.eq {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 11px;
}
.eq i {
  width: 2.5px;
  border-radius: 1px;
  background: var(--gold);
  animation: eq-b 0.9s ease-in-out infinite;
}
.eq i:nth-child(1) { height: 62%; animation-delay: 0s; }
.eq i:nth-child(2) { height: 100%; animation-delay: 0.25s; }
.eq i:nth-child(3) { height: 45%; animation-delay: 0.5s; }
@keyframes eq-b { 0%, 100% { transform: scaleY(0.45); } 50% { transform: scaleY(1); } }

.m-meta { min-width: 0; }
.m-name {
  font-size: 14px; font-weight: 700;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.m-sub {
  font-size: 12px; color: var(--text-dim);
  margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 40vw;
}
.m-sub.err { color: var(--red); }

/* ---- 控制区 ---- */
.m-center { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.ctrl {
  width: 34px; height: 34px;
  border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1;
  user-select: none;
  transition: all 0.15s;
}
.ctrl:hover { color: var(--text); background: var(--hover); }
.ctrl.on { color: var(--gold); background: var(--gold-soft); }
.ctrl.play {
  width: 42px; height: 42px;
  color: var(--on-gold);
  background: linear-gradient(135deg, var(--gold), var(--gold-2));
  box-shadow: var(--shadow-gold);
}
.ctrl.play:hover { filter: brightness(1.07); color: var(--on-gold); }
.ctrl.close:hover { color: var(--red); background: rgba(255, 107, 107, 0.1); }
.spin.dark { border-color: rgba(0, 0, 0, 0.25); border-top-color: var(--on-gold); }

.pill {
  display: inline-flex; align-items: center; gap: 5px;
  height: 28px;
  padding: 0 11px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--border);
  white-space: nowrap;
  user-select: none;
  transition: all 0.15s;
}
.pill span { line-height: 1; }
.pill:hover { color: var(--gold); border-color: rgba(242, 185, 75, 0.45); }

/* ---- 右侧 ---- */
.m-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.time { font-size: 12px; color: var(--text-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
.vol { display: flex; align-items: center; gap: 4px; }
.vol input[type='range'] {
  width: 74px;
  height: 34px;
  margin: 0;
  accent-color: var(--gold);
  cursor: pointer;
}

/* ---- 上浮面板 ---- */
.panel {
  position: absolute;
  right: 16px;
  bottom: calc(100% + 8px);
  width: min(420px, calc(100vw - 32px));
  max-height: min(46vh, 380px);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 14px;
  box-shadow: var(--shadow-2);
  overflow: hidden;
}
.q-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  font-size: 13px; font-weight: 600;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.q-clear { font-size: 12px; color: var(--text-faint); }
.q-clear:hover { color: var(--red); }
.q-list { overflow-y: auto; padding: 6px; }
.q-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.q-row:hover { background: var(--hover); }
.q-row.cur { background: var(--gold-soft); }
.q-row.cur .q-name { color: var(--gold); font-weight: 600; }
.q-idx { width: 20px; text-align: center; color: var(--text-faint); font-size: 12px; flex-shrink: 0; }
.q-row.cur .q-idx { color: var(--gold); }
.q-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.q-artist { color: var(--text-faint); font-size: 12px; max-width: 30%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.q-del { color: var(--text-faint); font-size: 11px; opacity: 0; flex-shrink: 0; }
.q-row:hover .q-del { opacity: 1; }
.q-del:hover { color: var(--red); }

.lyrics { overflow-y: auto; padding: 18px 14px; scroll-behavior: smooth; }
.lrc { margin: 0 0 10px; font-size: 13px; color: var(--text-faint); text-align: center; transition: color 0.2s; }
.lrc.cur { color: var(--gold); font-size: 15px; font-weight: 700; }
.lrc.none { padding: 40px 0; }

/* ---- 过渡 ---- */
.mp-rise-enter-active, .mp-rise-leave-active { transition: transform 0.25s ease, opacity 0.25s ease; }
.mp-rise-enter-from, .mp-rise-leave-to { transform: translateY(100%); opacity: 0; }
.mp-panel-enter-active, .mp-panel-leave-active { transition: transform 0.2s ease, opacity 0.2s ease; }
.mp-panel-enter-from, .mp-panel-leave-to { transform: translateY(10px); opacity: 0; }

@media (max-width: 860px) {
  .vol, .time { display: none; }
  .pill-txt { display: none; }
  .pill { padding: 0 8px; }
  .m-sub { max-width: 46vw; }
}
@media (max-width: 560px) {
  .mini-inner { padding: 8px 12px; gap: 8px; }
  .disc { width: 38px; height: 38px; }
  .m-right { gap: 2px; }
}
</style>
