<script setup>
/**
 * 屏保：彩虹鹈鹕骑行 —— 夜色公路上彩色鹈鹕车队双向骑行。
 *
 * - 场景为 fixed 全屏覆盖（顶栏隐藏），支持 Fullscreen API 真全屏（Esc 退出会连浏览器全屏一起还原并自动回到首页）；
 *   不支持全屏的环境（部分 iOS）退化为页内全屏。
 * - 点击画面加一辆车（上限 24），Esc / 右上角按钮退出；Wake Lock 防息屏。
 * - 鹈鹕本体是 PelicanRider（currentColor 线稿），彩色 = hue 随机 + 霓虹光晕。
 */
import { ref, onMounted, onUnmounted } from 'vue';
import PelicanRider from './PelicanRider.vue';
import AppIcon from './AppIcon.vue';

const LANES = 6;

const started = ref(false);
const now = ref(new Date());
const riders = ref([]);
const controlsVisible = ref(true);
const sceneEl = ref(null);
const fsSupported = typeof document !== 'undefined' && document.documentElement.requestFullscreen;

let rid = 0;
let clockTimer = 0;
let hideTimer = 0;
let wakeLock = null;
let everFullscreen = false;   // 真正进过全屏后，退出全屏才联动结束屏保（防环境杂散事件误退出）

/* ---- 星空（一次性生成） ---- */
const stars = Array.from({ length: 70 }, (_, i) => ({
  id: i,
  x: Math.random() * 100,
  y: Math.random() * 58,
  s: 1 + Math.random() * 1.8,
  delay: +(Math.random() * 4).toFixed(2),
  dur: +(2.2 + Math.random() * 3).toFixed(2)
}));

/* ---- 车队 ---- */
function spawnRider() {
  if (riders.value.length >= 24) return;
  const lane = Math.floor(Math.random() * LANES);
  riders.value.push({
    id: ++rid,
    lane,
    dir: lane % 2 === 0 ? 1 : -1,          // 偶数车道向右，奇数车道向左（双车道）
    size: 72 + Math.round(Math.random() * 96),
    dur: +(7 + Math.random() * 9).toFixed(2),
    hue: Math.floor(Math.random() * 360),
    delay: -+(Math.random() * 24).toFixed(2)  // 负延迟：开局就散布在路途各处
  });
}

function spawnAtClick(e) {
  if (!started.value) return;
  spawnRider();
  wake();
  showControls();
}

/* ---- 时钟 ---- */
function tick() { now.value = new Date(); }
const hhmm = () => now.value.toTimeString().slice(0, 5);
const dateLine = () => {
  const d = now.value;
  return `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`;
};

/* ---- 控制按钮自动隐藏 ---- */
function showControls() {
  controlsVisible.value = true;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { controlsVisible.value = false; }, 2600);
}

/* ---- Wake Lock：屏保运行时防息屏 ---- */
async function requestWake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* 不支持/被拒绝就算了 */ }
}
function releaseWake() {
  try { wakeLock?.release(); } catch { /* ignore */ }
  wakeLock = null;
}
function onVisibility() {
  if (started.value && document.visibilityState === 'visible') requestWake();
}

/* ---- 开始 / 退出 ---- */
async function start() {
  started.value = true;
  if (!riders.value.length) for (let i = 0; i < 8; i++) spawnRider();
  clockTimer = setInterval(tick, 1000);
  showControls();
  requestWake();
  try { await sceneEl.value?.requestFullscreen?.({ navigationUI: 'hide' }); } catch { /* 页内全屏兜底 */ }
}

function exit() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  try { location.hash = '#/'; } catch { /* ignore */ }
}

function onFsChange() {
  if (document.fullscreenElement) {
    everFullscreen = true;
    return;
  }
  // 用户按 Esc 退出浏览器全屏 → 视为结束屏保（页内兜底模式从没进过全屏，不受影响）
  if (started.value && everFullscreen) exit();
}
function onKey(e) {
  if (e.key === 'Escape' && started.value) exit();
}

onMounted(() => {
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  showControls();
});
onUnmounted(() => {
  clearInterval(clockTimer);
  clearTimeout(hideTimer);
  releaseWake();
  document.removeEventListener('fullscreenchange', onFsChange);
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <div ref="sceneEl" class="ss" @click="spawnAtClick" @mousemove="showControls" @touchstart="showControls">
    <!-- 夜空 -->
    <div class="sky"></div>
    <span
      v-for="st in stars"
      :key="st.id"
      class="star"
      :style="{ left: st.x + '%', top: st.y + '%', width: st.s + 'px', height: st.s + 'px', animationDelay: st.delay + 's', animationDuration: st.dur + 's' }"
    ></span>
    <div class="moon"></div>

    <!-- 远山 / 近丘（视差滚动） -->
    <div class="hills far"></div>
    <div class="hills near"></div>

    <!-- 公路与车队 -->
    <div class="road">
      <div class="road-line"></div>
      <div
        v-for="r in riders"
        :key="r.id"
        class="rider"
        :class="{ back: r.dir === -1 }"
        :style="{
          top: 6 + r.lane * 15 + '%',
          animationDuration: r.dur + 's',
          animationDelay: r.delay + 's'
        }"
      >
        <span class="rider-flip" :style="{ color: `hsl(${r.hue} 92% 66%)` }">
          <PelicanRider :size="r.size" />
        </span>
      </div>
    </div>

    <!-- 时钟 -->
    <div v-if="started" class="clock">
      <div class="clock-time">{{ hhmm() }}</div>
      <div class="clock-date">{{ dateLine() }}</div>
    </div>

    <!-- 控制区：鼠标动一下出现，2.6s 后隐去 -->
    <div class="controls" :class="{ show: controlsVisible }">
      <button class="exit-btn" title="退出屏保 (Esc)" @click.stop="exit"><AppIcon name="x" :size="18" /></button>
    </div>

    <!-- 启动页 -->
    <div v-if="!started" class="intro" @click.stop>
      <div class="intro-riders" aria-hidden="true">
        <span class="intro-rider" style="color: hsl(45 92% 66%)"><PelicanRider :size="150" /></span>
        <span class="intro-rider d" style="color: hsl(320 92% 68%)"><PelicanRider :size="110" /></span>
        <span class="intro-rider u" style="color: hsl(150 92% 62%)"><PelicanRider :size="88" /></span>
      </div>
      <h2 class="intro-title">彩虹鹈鹕骑行</h2>
      <p class="intro-sub">夜色公路 · 彩色鹈鹕车队 · 时钟与防息屏</p>
      <button class="btn primary big" @click="start">
        <AppIcon name="play" :size="14" /> {{ fsSupported ? '开始屏保（全屏）' : '开始屏保' }}
      </button>
      <p class="intro-hint dim">全屏后点击画面可加车 · Esc 或右上角退出</p>
    </div>
  </div>
</template>

<style scoped>
.ss {
  position: fixed;
  inset: 0;
  z-index: 55;                       /* 低于 MiniPlayer(60)：听歌时播放条仍在 */
  overflow: hidden;
  background: linear-gradient(#0b1030 0%, #191443 46%, #3a1d58 74%, #63294e 100%);
  cursor: crosshair;
  user-select: none;
}

/* ---- 夜空 ---- */
.sky { position: absolute; inset: 0; }
.star {
  position: absolute;
  border-radius: 50%;
  background: #fff;
  opacity: 0.25;
  animation: ss-twinkle linear infinite;
}
@keyframes ss-twinkle { 0%, 100% { opacity: 0.15; } 50% { opacity: 0.95; } }
.moon {
  position: absolute;
  top: 7%; right: 9%;
  width: 72px; height: 72px;
  border-radius: 50%;
  background: radial-gradient(circle at 34% 34%, #fff7d8, #ffe9a3 58%, #f4cf72);
  box-shadow: 0 0 34px 10px rgba(255, 232, 160, 0.35);
}

/* ---- 视差山丘（重复圆弧，background-position 滚动） ---- */
.hills {
  position: absolute;
  left: 0; right: 0;
  background-repeat: repeat-x;
  background-size: 680px 100%;
}
.hills.far {
  bottom: 24%;
  height: 17%;
  background-image: radial-gradient(140px 120px at 50% 100%, #232a52 98%, transparent 100%);
  animation: ss-roll 64s linear infinite;
  opacity: 0.9;
}
.hills.near {
  bottom: 24.6%;
  height: 12%;
  background-image: radial-gradient(190px 150px at 50% 100%, #171c3c 98%, transparent 100%);
  animation: ss-roll 38s linear infinite;
}
@keyframes ss-roll { to { background-position-x: -1360px; } }
.hills.back { animation-direction: reverse; }

/* ---- 公路 ---- */
.road {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 26%;
  background: linear-gradient(#101527, #0a0d1b);
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}
.road-line {
  position: absolute;
  inset: auto 0 50%;
  height: 3px;
  background: repeating-linear-gradient(90deg, rgba(255, 214, 120, 0.5) 0 34px, transparent 34px 74px);
  animation: ss-dash 1.1s linear infinite;
  opacity: 0.5;
}
@keyframes ss-dash { to { background-position-x: -108px; } }

/* ---- 骑手：横穿动画，reverse = 反向车道 ---- */
.rider {
  position: absolute;
  left: 0;
  width: 40vw;
  pointer-events: none;
  animation: ss-ride linear infinite;
}
.rider.back { animation-direction: reverse; }
@keyframes ss-ride {
  from { transform: translateX(-46vw); }
  to { transform: translateX(130vw); }
}
.rider-flip {
  display: inline-block;
  filter:
    drop-shadow(0 0 5px currentColor)
    drop-shadow(0 0 16px rgba(255, 255, 255, 0.18));
}
.rider.back .rider-flip { transform: scaleX(-1); }

/* ---- 时钟 ---- */
.clock {
  position: absolute;
  top: 7%; left: 6%;
  color: rgba(255, 244, 214, 0.88);
  text-shadow: 0 2px 18px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
.clock-time {
  font-size: clamp(56px, 11vw, 130px);
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
}
.clock-date { margin-top: 8px; font-size: clamp(15px, 2.2vw, 24px); opacity: 0.8; }

/* ---- 控制区 ---- */
.controls { position: absolute; top: 16px; right: 16px; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
.controls.show { opacity: 1; pointer-events: auto; }
.exit-btn {
  width: 42px; height: 42px;
  border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(6px);
  transition: all 0.15s;
}
.exit-btn:hover { background: rgba(255, 255, 255, 0.2); color: #fff; }

/* ---- 启动页 ---- */
.intro {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 20px;
}
.intro-riders { display: flex; align-items: flex-end; gap: 26px; margin-bottom: 14px; }
.intro-rider { filter: drop-shadow(0 0 8px currentColor); }
.intro-rider.d { transform: translateY(10px); }
.intro-rider.u { transform: translateY(22px); }
.intro-title { color: #fff; font-size: clamp(26px, 5vw, 44px); margin: 0; letter-spacing: 0.06em; }
.intro-sub { color: rgba(255, 244, 214, 0.75); margin: 0 0 22px; font-size: 15px; }
.intro-hint { font-size: 13px; margin: 14px 0 0; color: rgba(255, 255, 255, 0.4); }
.btn.big { height: 46px; padding: 0 26px; font-size: 16px; border-radius: 12px; }

@media (prefers-reduced-motion: reduce) {
  .star, .hills, .road-line, .rider { animation: none; }
  .hills.far { background-position: 0 0; }
}
</style>
