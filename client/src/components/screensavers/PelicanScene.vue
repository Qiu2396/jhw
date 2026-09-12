<script setup>
/**
 * 屏保场景：彩虹鹈鹕骑行 —— 夜色公路上彩色鹈鹕车队双向骑行。
 * 纯场景组件：absolute 铺满父容器（列表卡片 / 预览框 / 全屏舞台通用），
 * 时钟与退出按钮由 ScreensaverView 的全屏外壳负责。
 * 点击画面加一辆车（上限 24）；鹈鹕本体是 PelicanRider（currentColor 线稿）。
 */
import { ref, onMounted } from 'vue';
import PelicanRider from '../PelicanRider.vue';

const LANES = 6;
const riders = ref([]);
let rid = 0;

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

function spawnAtClick() { spawnRider(); }

onMounted(() => {
  for (let i = 0; i < 8; i++) spawnRider();
});
</script>

<template>
  <div class="scene pk" @click="spawnAtClick">
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
  </div>
</template>

<style scoped>
.scene { position: absolute; inset: 0; overflow: hidden; }
.pk { background: linear-gradient(#0b1030 0%, #191443 46%, #3a1d58 74%, #63294e 100%); cursor: crosshair; }

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

@media (prefers-reduced-motion: reduce) {
  .star, .hills, .road-line, .rider { animation: none; }
  .hills.far { background-position: 0 0; }
}
</style>
