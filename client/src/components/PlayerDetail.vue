<script setup>
/**
 * 全屏播放详情（网易云风格）：毛玻璃封面做背景，左侧旋转黑胶唱片，
 * 右侧逐行歌词（点击歌词行跳播），底部完整控制区（进度/模式/音量/倍速/队列）。
 * 挂在 MiniPlayer 内 —— 全局播放器在任何页面播放时都能展开。
 */
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useMusicPlayer } from '../musicStore.js';
import PelicanRider from './PelicanRider.vue';
import AppIcon from './AppIcon.vue';

const {
  queue, currentIdx, playing, currentTime, duration, volume, mode,
  lyricLines, lyricIdx, cover, currentSong, rate, detailOpen,
  toggle, jump, seek, setVolume, cycleMode, removeAt, playAt, setRate
} = useMusicPlayer();

/* 封面加载失败时退回鹈鹕唱片兜底（换歌时重置） */
const coverBroken = ref(false);
watch(cover, () => { coverBroken.value = false; });

const RATES = [1, 1.25, 1.5, 2, 0.75, 0.5];
const MODE_META = {
  order:   { icon: 'arrow-right', label: '顺序播放' },
  loop:    { icon: 'repeat',      label: '列表循环' },
  one:     { icon: 'repeat-1',    label: '单曲循环' },
  shuffle: { icon: 'shuffle',     label: '随机播放' }
};
const modeMeta = computed(() => MODE_META[mode.value] || MODE_META.order);

function cycleRate() {
  const i = RATES.indexOf(rate.value);
  setRate(RATES[(i + 1) % RATES.length]);
}

function fmt(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const pct = computed(() => duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0);

/* ---- 进度条拖拽 ---- */
const barEl = ref(null);
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

/* ---- 歌词滚动 + 点击跳播 ---- */
const lyricsEl = ref(null);
watch(lyricIdx, async () => {
  await nextTick();
  const box = lyricsEl.value;
  const cur = box?.querySelector('.lrc.cur');
  if (box && cur) box.scrollTop = cur.offsetTop - box.clientHeight / 2 + cur.clientHeight / 2;
});
function seekToLyric(l) {
  if (isFinite(l.t)) seek(l.t);
}

/* ---- 队列侧栏 ---- */
const showQueue = ref(false);

function onKey(e) {
  if (e.key !== 'Escape') return;
  if (showQueue.value) showQueue.value = false;   // 第一层：先收队列
  else detailOpen.value = false;                  // 第二层：收起详情
}
onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <!-- Teleport 到 body：父级 .mini 有 backdrop-filter，会像 transform 一样
       把 position:fixed 的包含块变成播放条本身，导致详情层被压在底栏里 -->
  <Teleport to="body">
    <Transition name="np">
      <div v-if="currentSong && detailOpen" class="np" @click.self="showQueue = false">
      <!-- 背景：当前封面放大高斯模糊 + 暗色压字层 -->
      <div class="np-bg" :style="cover ? { backgroundImage: `url(${cover})` } : {}"></div>
      <div class="np-shade"></div>

      <!-- 顶栏：收起 + 歌名 -->
      <header class="np-head">
        <button class="np-btn" title="收起 (Esc)" @click="detailOpen = false"><AppIcon name="chevron-down" :size="20" /></button>
        <div class="np-head-meta">
          <div class="np-name" :title="currentSong.name">{{ currentSong.name }}</div>
          <div class="np-artist">{{ currentSong.artist }}<span v-if="currentSong.album" class="dim"> · {{ currentSong.album }}</span></div>
        </div>
        <button class="np-btn" :class="{ on: showQueue }" title="播放列表" @click="showQueue = !showQueue">
          <AppIcon name="list" :size="18" />
        </button>
      </header>

      <!-- 主体：黑胶 + 歌词 -->
      <div class="np-main" @click.self="showQueue = false">
        <div class="np-disc-side" @click.self="showQueue = false">
          <div class="needle" :class="{ on: playing }"><span class="needle-arm"></span><span class="needle-head"></span></div>
          <div class="disc" :class="{ spin: playing }">
            <img v-if="cover && !coverBroken" :src="cover" :key="cover" alt="" @error="coverBroken = true" />
            <div v-else class="disc-fallback"><PelicanRider :size="72" /></div>
            <span class="disc-hole"></span>
          </div>
        </div>

        <div class="np-lyrics" ref="lyricsEl" @click.self="showQueue = false">
          <p v-if="!lyricLines.length" class="lrc none">暂无歌词，戴上耳机慢慢听 🎧</p>
          <p
            v-for="(l, i) in lyricLines"
            :key="i"
            class="lrc"
            :class="{ cur: i === lyricIdx }"
            :title="i === lyricIdx ? '' : '点击跳到这句'"
            @click="seekToLyric(l)"
          >{{ l.text }}</p>
          <p class="lrc tail-space"></p>
        </div>
      </div>

      <!-- 底部控制区 -->
      <footer class="np-foot" @click.self="showQueue = false">
        <div class="np-progress">
          <span class="np-time">{{ fmt(currentTime) }}</span>
          <div class="np-bar" ref="barEl" @pointerdown="onBarDown">
            <div class="np-bar-fill" :style="{ width: pct + '%' }"><span class="np-dot"></span></div>
          </div>
          <span class="np-time">{{ fmt(duration) }}</span>
        </div>

        <div class="np-ctrls">
          <button class="np-btn" :title="modeMeta.label" @click="cycleMode"><AppIcon :name="modeMeta.icon" :size="17" /></button>
          <button class="np-btn big" title="上一首" @click="jump(-1)"><AppIcon name="skip-back" :size="22" /></button>
          <button class="np-play" :title="playing ? '暂停' : '播放'" @click="toggle">
            <AppIcon :name="playing ? 'pause' : 'play'" :size="24" />
          </button>
          <button class="np-btn big" title="下一首" @click="jump(1)"><AppIcon name="skip-forward" :size="22" /></button>
          <button class="np-btn rate" :class="{ on: rate !== 1 }" :title="`倍速（当前 ${rate}x，点击切换）`" @click="cycleRate">{{ rate }}x</button>
        </div>

        <div class="np-right">
          <AppIcon name="volume-2" :size="15" class="dim" />
          <input type="range" min="0" max="1" step="0.02" :value="volume" title="音量" @input="e => setVolume(parseFloat(e.target.value))" />
          <button class="np-btn" :class="{ on: showQueue }" title="播放列表" @click="showQueue = !showQueue">
            <AppIcon name="list" :size="17" />
          </button>
        </div>
      </footer>

      <!-- 队列侧栏 -->
      <Transition name="np-q">
        <aside v-if="showQueue" class="np-queue">
          <div class="nq-head">
            <span>播放列表（{{ queue.length }}）</span>
            <button class="np-btn" @click="showQueue = false"><AppIcon name="x" :size="15" /></button>
          </div>
          <div class="nq-list">
            <div
              v-for="(s, i) in queue"
              :key="i"
              class="nq-row"
              :class="{ cur: i === currentIdx }"
              @click="playAt(i)"
            >
              <span class="nq-idx">{{ i + 1 }}</span>
              <span class="nq-name">{{ s.name }}</span>
              <span class="nq-artist">{{ s.artist }}</span>
              <button class="nq-del" title="移除" @click.stop="removeAt(i)"><AppIcon name="x" :size="12" /></button>
            </div>
          </div>
        </aside>
      </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.np {
  position: fixed;
  inset: 0;
  z-index: 70;                       /* 高于 MiniPlayer(60)，低于弹窗类 */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #fff;
  background: linear-gradient(135deg, #1b1428, #0d0d16);   /* 实底：封面图只是氛围层，不透出底层页面 */
}
/* 背景：封面模糊铺满（z0），内容层 z1 压在上面 */
.np-bg, .np-shade {
  position: absolute;
  z-index: 0;
}
.np-bg {
  inset: -60px;
  background-size: cover;
  background-position: center;
  filter: blur(70px) saturate(1.25) brightness(0.5);
  transform: scale(1.12);
}
.np-shade {
  inset: 0;
  background: linear-gradient(rgba(10, 10, 18, 0.5), rgba(10, 10, 18, 0.68));
}
.np-head, .np-main, .np-foot { position: relative; z-index: 1; }

/* ---- 顶栏 ---- */
.np-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 22px 6px;
  flex-shrink: 0;
}
.np-head-meta { flex: 1; min-width: 0; text-align: center; }
.np-name {
  font-size: 19px;
  font-weight: 700;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.np-artist { font-size: 13px; opacity: 0.75; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.np-btn {
  width: 38px; height: 38px;
  border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  color: rgba(255, 255, 255, 0.78);
  background: rgba(255, 255, 255, 0.07);
  flex-shrink: 0;
  transition: all 0.15s;
}
.np-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.14); }
.np-btn.on { color: var(--gold); background: rgba(242, 185, 75, 0.16); }

/* ---- 主体 ---- */
.np-main {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: clamp(24px, 6vw, 96px);
  padding: 10px clamp(16px, 4vw, 48px);
}

/* 黑胶唱片（宽高显式声明，不依赖 aspect-ratio 推导，防 flex 环境塌陷） */
.np-disc-side {
  position: relative;
  flex-shrink: 0;
  --np: clamp(220px, 30vw, 360px);
  width: var(--np);
  height: var(--np);
}
.disc {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background:
    repeating-radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.055) 0 1.5px, transparent 1.5px 5px),
    radial-gradient(circle, #2a2a33 58%, #191920 100%);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}
.disc img {
  width: 62%;
  aspect-ratio: 1;
  border-radius: 50%;
  object-fit: cover;
  box-shadow: 0 0 0 6px rgba(0, 0, 0, 0.35);
}
.disc-fallback {
  width: 62%;
  aspect-ratio: 1;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--gold);
  background: linear-gradient(135deg, var(--cover-1), var(--cover-2));
  box-shadow: 0 0 0 6px rgba(0, 0, 0, 0.35);
}
.disc-hole {
  position: absolute;
  top: 50%; left: 50%;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: #0c0c11;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.14);
}
.disc.spin { animation: np-spin 22s linear infinite; }
@keyframes np-spin { to { transform: rotate(360deg); } }

/* 唱针：暂停时抬起停在碟外，播放时针尖落在碟面右上沟槽区（≈0.8R）。
   轴心在碟右上角外、臂长 = 碟径 33%，坐标全部按 --np 缩放，
   220~360px 任意碟径下落点比例一致。 */
.needle {
  position: absolute;
  top: -6%;
  right: 1%;
  z-index: 2;
  transform-origin: 8px 9px;
  transform: rotate(2deg);
  transition: transform 0.4s ease;
}
.needle.on { transform: rotate(41deg); }
.needle-arm { display: block; width: 5px; height: calc(var(--np) * 0.36); border-radius: 3px; background: linear-gradient(#e8e8ee, #b9b9c4); }
.needle-head { position: absolute; top: -4px; left: -5px; width: 26px; height: 26px; border-radius: 50%; background: #d8d8e0; box-shadow: inset 0 -2px 4px rgba(0,0,0,0.25); }

/* 歌词 */
.np-lyrics {
  flex: 1;
  min-width: 0;
  max-width: 560px;
  max-height: min(58vh, 560px);
  overflow-y: auto;
  padding: 24vh 8px;               /* 上下留白让当前行能居中 */
  mask-image: linear-gradient(transparent, #000 12%, #000 88%, transparent);
  -webkit-mask-image: linear-gradient(transparent, #000 12%, #000 88%, transparent);
  scroll-behavior: smooth;
}
.lrc {
  margin: 0 0 18px;
  font-size: 14.5px;
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.42);
  text-align: left;
  cursor: pointer;
  transition: color 0.25s, transform 0.25s, font-size 0.25s;
}
.lrc:hover { color: rgba(255, 255, 255, 0.75); }
.lrc.cur {
  color: #fff;
  font-size: 19px;
  font-weight: 700;
  cursor: default;
  text-shadow: 0 0 18px rgba(242, 185, 75, 0.35);
}
.lrc.none { text-align: center; color: rgba(255, 255, 255, 0.5); cursor: default; padding-top: 30vh; }
.lrc.tail-space { height: 20vh; margin: 0; }

/* ---- 底部控制区 ---- */
.np-foot {
  flex-shrink: 0;
  padding: 6px clamp(18px, 4vw, 48px) calc(18px + env(safe-area-inset-bottom, 0));
}
.np-progress { display: flex; align-items: center; gap: 12px; max-width: 760px; margin: 0 auto; }
.np-time { font-size: 12px; color: rgba(255, 255, 255, 0.55); font-variant-numeric: tabular-nums; width: 38px; }
.np-time:last-child { text-align: right; }
.np-bar {
  position: relative;
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.16);
  cursor: pointer;
  touch-action: none;
}
.np-bar-fill {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  border-radius: 3px;
  background: linear-gradient(90deg, var(--gold), var(--gold-2));
}
.np-dot {
  position: absolute;
  right: -5px; top: 50%;
  width: 11px; height: 11px;
  border-radius: 50%;
  background: var(--gold);
  transform: translateY(-50%);
  box-shadow: 0 0 0 3px rgba(242, 185, 75, 0.25);
}

.np-ctrls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: clamp(10px, 2.4vw, 22px);
  padding: 12px 0 4px;
}
.np-btn.big { width: 46px; height: 46px; }
.np-play {
  width: 62px; height: 62px;
  border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--on-gold);
  background: linear-gradient(135deg, var(--gold), var(--gold-2));
  box-shadow: 0 8px 28px rgba(242, 185, 75, 0.4);
  transition: all 0.15s;
}
.np-play:hover { filter: brightness(1.07); transform: scale(1.03); }
.np-btn.rate {
  width: auto;
  min-width: 48px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.np-btn.rate.on { color: var(--on-gold); background: linear-gradient(135deg, var(--gold), var(--gold-2)); }

.np-right { display: flex; align-items: center; justify-content: center; gap: 10px; padding-top: 4px; }
.np-right input[type='range'] { width: 130px; accent-color: var(--gold); cursor: pointer; }

/* ---- 队列侧栏 ---- */
.np-queue {
  position: absolute;
  z-index: 2;
  top: 70px; right: 18px; bottom: 130px;
  width: min(330px, calc(100vw - 36px));
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  background: rgba(16, 16, 24, 0.82);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.nq-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px;
  font-size: 13px; font-weight: 600;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}
.nq-list { flex: 1; overflow-y: auto; padding: 6px; }
.nq-row {
  display: flex; align-items: center; gap: 9px;
  padding: 8px 10px;
  border-radius: 9px;
  font-size: 13px;
  cursor: pointer;
}
.nq-row:hover { background: rgba(255, 255, 255, 0.07); }
.nq-row.cur { background: rgba(242, 185, 75, 0.16); }
.nq-row.cur .nq-name { color: var(--gold); font-weight: 600; }
.nq-idx { width: 22px; text-align: center; color: rgba(255,255,255,0.4); font-size: 12px; flex-shrink: 0; }
.nq-row.cur .nq-idx { color: var(--gold); }
.nq-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nq-artist { color: rgba(255,255,255,0.4); font-size: 12px; max-width: 32%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nq-del { color: rgba(255,255,255,0.35); flex-shrink: 0; }
.nq-del:hover { color: var(--red); }

/* ---- 过渡 ---- */
.np-enter-active, .np-leave-active { transition: transform 0.32s cubic-bezier(0.22, 0.8, 0.3, 1), opacity 0.32s; }
.np-enter-from, .np-leave-to { transform: translateY(100%); opacity: 0.4; }
.np-q-enter-active, .np-q-leave-active { transition: transform 0.22s ease, opacity 0.22s ease; }
.np-q-enter-from, .np-q-leave-to { transform: translateX(24px); opacity: 0; }

/* ---- 移动端：封面在上、歌词在下 ---- */
@media (max-width: 760px) {
  .np-main { flex-direction: column; gap: 8px; padding: 4px 16px; }
  .np-disc-side { display: none; }          /* 小屏以歌词为主（网易云移动端同款取舍） */
  .np-lyrics { max-height: none; flex: 1; width: 100%; text-align: center; padding: 18vh 4px; }
  .lrc { text-align: center; }
  .np-right { display: none; }
  .np-queue { top: 64px; bottom: 150px; }
}
@media (prefers-reduced-motion: reduce) {
  .disc.spin { animation: none; }
}
</style>
