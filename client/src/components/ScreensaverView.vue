<script setup>
/**
 * 屏保频道：唯美动画屏保合集。
 *
 * - 列表页：每个屏保一张「实时动画」卡片，卡片上有 预览 / 全屏 按钮；
 * - 预览：页内弹层小窗播放（Teleport 到 body），不进全屏，可从预览直接转全屏；
 * - 全屏：fixed 覆盖层 + Fullscreen API 真全屏（Esc 退出回到本页），不支持全屏的环境
 *   （部分 iOS）退化为页内全屏；时钟、控制条自动隐藏、Wake Lock 防息屏由外壳统一负责。
 * - 各场景是纯展示组件（screensavers/*.Scene.vue），只负责画面本身。
 */
import { ref, computed, defineAsyncComponent, nextTick, onMounted, onUnmounted } from 'vue';
import AppIcon from './AppIcon.vue';

const SCENES = [
  {
    id: 'sakura', name: '樱吹雪', mood: '浪漫',
    desc: '暮色天空里花瓣纷飞，落日与远山温柔作伴',
    comp: defineAsyncComponent(() => import('./screensavers/SakuraScene.vue'))
  },
  {
    id: 'aurora', name: '极光之夜', mood: '治愈',
    desc: '绿紫极光在星空雪原上缓缓流动，湖面映着微光',
    comp: defineAsyncComponent(() => import('./screensavers/AuroraScene.vue'))
  },
  {
    id: 'firefly', name: '流萤森林', mood: '静谧',
    desc: '夏夜森林薄雾流动，点点萤火明灭漂浮',
    comp: defineAsyncComponent(() => import('./screensavers/FireflyScene.vue'))
  },
  {
    id: 'moonsea', name: '海上生明月', mood: '诗意',
    desc: '云影掠过满月，碎银波光里一叶孤帆缓缓远去',
    comp: defineAsyncComponent(() => import('./screensavers/MoonSeaScene.vue'))
  },
  {
    id: 'pelican', name: '彩虹鹈鹕骑行', mood: '趣味',
    desc: '夜色公路上彩色鹈鹕车队双向骑行，点击画面加一辆车',
    comp: defineAsyncComponent(() => import('./screensavers/PelicanScene.vue'))
  }
];

const previewItem = ref(null);      // 预览弹层中的屏保
const activeItem = ref(null);       // 全屏运行中的屏保
const now = ref(new Date());
const controlsVisible = ref(true);
const stageEl = ref(null);          // 全屏舞台（请求 Fullscreen API 的元素）
const fsSupported = typeof document !== 'undefined' && document.documentElement.requestFullscreen;

let clockTimer = 0;
let hideTimer = 0;
let wakeLock = null;
let everFullscreen = false;   // 真正进过全屏后，退出全屏才联动结束（防环境杂散事件误退出）

const activeComp = computed(() => activeItem.value?.comp);

/* ---- 时钟：每秒刷新，顺带做「全屏丢失」兜底检测 ——
      部分 webview 不派发 fullscreenchange 事件，靠轮询把退出联动兜住 ---- */
function tick() {
  now.value = new Date();
  if (activeItem.value && everFullscreen && !document.fullscreenElement) exitFull();
}
const hhmm = () => now.value.toTimeString().slice(0, 5);
const dateLine = () => {
  const d = now.value;
  return `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`;
};

/* ---- 控制区自动隐藏 ---- */
function showControls() {
  if (!activeItem.value) return;
  controlsVisible.value = true;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { controlsVisible.value = false; }, 2600);
}

/* ---- Wake Lock：全屏运行时防息屏 ---- */
async function requestWake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* 不支持/被拒绝就算了 */ }
}
function releaseWake() {
  try { wakeLock?.release(); } catch { /* ignore */ }
  wakeLock = null;
}
function onVisibility() {
  if (activeItem.value && document.visibilityState === 'visible') requestWake();
}

/* ---- 开始 / 退出全屏 ---- */
async function startFull(item) {
  previewItem.value = null;
  activeItem.value = item;
  everFullscreen = false;
  clockTimer = setInterval(tick, 1000);
  tick();
  showControls();
  requestWake();
  await nextTick();   // 等舞台渲染出来再请求真全屏
  try {
    await stageEl.value?.requestFullscreen?.({ navigationUI: 'hide' });
    everFullscreen = true;          // promise 成功即确认进过全屏（不依赖事件派发）
  } catch { /* 页内全屏兜底 */ }
}

function exitFull() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  activeItem.value = null;
  clearInterval(clockTimer);
  clearTimeout(hideTimer);
  releaseWake();
}

function onFsChange() {
  if (document.fullscreenElement) {
    everFullscreen = true;
    return;
  }
  // 用户按 Esc 退出浏览器全屏 → 结束屏保回到列表（页内兜底模式从没进过全屏，不受影响）
  if (activeItem.value && everFullscreen) exitFull();
}
function onKey(e) {
  if (e.key !== 'Escape') return;
  if (previewItem.value) { previewItem.value = null; return; }   // 先关预览
  if (activeItem.value) exitFull();   // 全屏中浏览器会自行退出，这里幂等兜底
}

onMounted(() => {
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
});
onUnmounted(() => {
  exitFull();
  document.removeEventListener('fullscreenchange', onFsChange);
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <div class="ss container">
    <h2 class="page-h"><AppIcon name="monitor" :size="21" class="h-icon" /> 屏保</h2>
    <p class="page-desc">唯美动画屏保合集：先预览，喜欢就全屏挂着 —— 自带时钟、防息屏，Esc 或右上角按钮退出。</p>

    <div class="ss-grid">
      <div v-for="s in SCENES" :key="s.id" class="ss-card">
        <div class="ss-live" title="点击预览" @click="previewItem = s">
          <component :is="s.comp" />
        </div>
        <span class="ss-mood">{{ s.mood }}</span>
        <div class="ss-meta">
          <div class="ss-txt">
            <h3>{{ s.name }}</h3>
            <p>{{ s.desc }}</p>
          </div>
          <div class="ss-actions">
            <button class="btn small" title="小窗预览" @click="previewItem = s">
              <AppIcon name="search" :size="13" /> 预览
            </button>
            <button class="btn primary small" title="进入全屏" @click="startFull(s)">
              <AppIcon name="monitor" :size="13" /> 全屏
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 预览弹层：Teleport 到 body，fixed 定位不受祖先影响 -->
    <Teleport to="body">
      <div v-if="previewItem" class="pv-mask" @click.self="previewItem = null">
        <div class="pv-box">
          <div class="pv-head">
            <span class="pv-name">{{ previewItem.name }}</span>
            <span class="badge">{{ previewItem.mood }}</span>
            <button class="pv-close" title="关闭预览" @click="previewItem = null"><AppIcon name="x" :size="16" /></button>
          </div>
          <div class="pv-stage">
            <component :is="previewItem.comp" />
          </div>
          <div class="pv-foot">
            <span class="dim pv-tip">{{ fsSupported ? '全屏后 Esc 退出' : '当前环境不支持全屏，将以页内全屏播放' }}</span>
            <button class="btn primary" @click="startFull(previewItem)">
              <AppIcon name="monitor" :size="14" /> 全屏播放
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 全屏舞台：Teleport 到 body -->
    <Teleport to="body">
      <div
        v-if="activeItem"
        ref="stageEl"
        class="fs-stage"
        @mousemove="showControls"
        @touchstart="showControls"
        @click="showControls"
      >
        <component :is="activeComp" />
        <div class="clock">
          <div class="clock-time">{{ hhmm() }}</div>
          <div class="clock-date">{{ dateLine() }}</div>
        </div>
        <div class="controls" :class="{ show: controlsVisible }">
          <span class="fs-name">{{ activeItem.name }}</span>
          <button class="exit-btn" title="退出屏保 (Esc)" @click.stop="exitFull"><AppIcon name="x" :size="18" /></button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ss { padding-top: 34px; animation: rise 0.35s ease; }
.page-h { display: flex; align-items: center; gap: 9px; margin: 0 0 6px; }
.h-icon { color: var(--gold); }
.page-desc { color: var(--text-dim); margin: 0 0 22px; font-size: 14px; }

.ss-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
  padding-bottom: 30px;
}
.ss-card {
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  overflow: hidden;
  transition: border-color 0.18s, transform 0.18s, box-shadow 0.18s;
}
.ss-card:hover {
  border-color: rgba(242, 185, 75, 0.45);
  transform: translateY(-2px);
  box-shadow: var(--shadow-1);
}
.ss-live {
  aspect-ratio: 16 / 9;
  position: relative;
  cursor: pointer;
  background: #0b1030;
}
.ss-live > * { position: absolute; inset: 0; }   /* 异步场景组件铺满预览区 */

.ss-mood {
  position: absolute;
  top: 10px; right: 10px;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  pointer-events: none;
}
.ss-meta { display: flex; align-items: center; gap: 12px; padding: 12px 14px; }
.ss-txt { flex: 1; min-width: 0; }
.ss-txt h3 { margin: 0 0 3px; font-size: 15px; }
.ss-txt p {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-faint);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ss-actions { display: flex; gap: 8px; flex-shrink: 0; }

/* ---- 预览弹层 ---- */
.pv-mask {
  position: fixed; inset: 0; z-index: 110;
  background: rgba(8, 8, 12, 0.88);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
  padding: 18px;
  animation: fade-in 0.18s ease both;
}
.pv-box {
  width: min(920px, 96vw);
  border: 1px solid var(--border-strong);
  border-radius: 14px;
  background: var(--surface);
  overflow: hidden;
  box-shadow: 0 12px 60px rgba(0, 0, 0, 0.55);
}
.pv-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; }
.pv-name { font-weight: 700; font-size: 15px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-close {
  width: 34px; height: 34px;
  border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-dim);
  background: var(--hover);
  transition: all 0.15s;
}
.pv-close:hover { color: var(--text); }
.pv-stage {
  position: relative;
  aspect-ratio: 16 / 9;
  max-height: 62vh;
  margin: 0 14px;
  border-radius: 10px;
  overflow: hidden;
  background: #0b1030;
}
.pv-stage > * { position: absolute; inset: 0; }
.pv-foot { display: flex; align-items: center; gap: 12px; padding: 12px 14px; }
.pv-tip { flex: 1; min-width: 0; font-size: 12.5px; }

/* ---- 全屏舞台 ---- */
.fs-stage {
  position: fixed;
  inset: 0;
  z-index: 55;                       /* 低于 MiniPlayer(60)：听歌时播放条仍在 */
  overflow: hidden;
  user-select: none;
}
.fs-stage > * { position: absolute; inset: 0; }

.clock {
  top: 7%; left: 6%; bottom: auto; right: auto;
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

.controls {
  position: absolute;
  top: 16px; right: 16px; bottom: auto; left: auto;
  display: flex; align-items: center; gap: 12px;
  opacity: 0; transition: opacity 0.3s; pointer-events: none;
}
.controls.show { opacity: 1; pointer-events: auto; }
.fs-name {
  color: rgba(255, 255, 255, 0.75);
  font-size: 13px;
  letter-spacing: 0.06em;
  text-shadow: 0 1px 10px rgba(0, 0, 0, 0.5);
}
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

@media (max-width: 720px) {
  .ss { padding-top: 22px; }
  .ss-grid { grid-template-columns: 1fr; gap: 12px; }
  .pv-stage { max-height: 52vh; }
}
</style>
