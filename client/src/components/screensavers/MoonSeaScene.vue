<script setup>
/**
 * 屏保场景：海上生明月 —— 云影掠过满月，月光在粼粼波光里铺成一道碎银，孤帆缓缓远去。
 * 纯场景组件：absolute 铺满父容器。
 */
const stars = Array.from({ length: 36 }, (_, i) => ({
  id: i,
  x: +(Math.random() * 100).toFixed(2),
  y: +(Math.random() * 56).toFixed(2),
  s: +(0.8 + Math.random() * 1.5).toFixed(1),
  delay: +(Math.random() * 4).toFixed(2),
  dur: +(2.4 + Math.random() * 3).toFixed(2)
}));

const waves = Array.from({ length: 5 }, (_, i) => ({
  id: i,
  left: +(Math.random() * 50).toFixed(2),
  top: +(8 + i * 17 + Math.random() * 8).toFixed(2),   // 海面内由浅到深分布
  w: +(28 + Math.random() * 34).toFixed(2),
  h: +(2 + Math.random() * 1.6).toFixed(1),
  dur: +(7 + Math.random() * 9).toFixed(2),
  delay: -+(Math.random() * 8).toFixed(2)
}));
</script>

<template>
  <div class="scene ms">
    <div class="sky"></div>
    <span
      v-for="st in stars" :key="st.id" class="star"
      :style="{ left: st.x + '%', top: st.y + '%', width: st.s + 'px', height: st.s + 'px', animationDelay: st.delay + 's', animationDuration: st.dur + 's' }"
    ></span>

    <!-- 满月 -->
    <div class="moon"></div>

    <!-- 云影 -->
    <div class="cloud c1"></div>
    <div class="cloud c2"></div>

    <!-- 海面 -->
    <div class="sea">
      <div class="reflect"></div>
      <div
        v-for="w in waves" :key="w.id" class="wave"
        :style="{ left: w.left + '%', top: w.top + '%', width: w.w + '%', height: w.h + 'px', animationDuration: w.dur + 's', animationDelay: w.delay + 's' }"
      ></div>
    </div>

    <!-- 孤帆 -->
    <div class="sail">
      <i></i>
    </div>
  </div>
</template>

<style scoped>
.scene { position: absolute; inset: 0; overflow: hidden; }
.ms { background: linear-gradient(#050a24 0%, #0b1440 52%, #14245e 66%, #0d1c4a 100%); }

.star { position: absolute; border-radius: 50%; background: #fff; opacity: 0.3; animation: ms-twinkle linear infinite; }
@keyframes ms-twinkle { 0%, 100% { opacity: 0.1; } 50% { opacity: 0.85; } }

.moon {
  position: absolute;
  top: 10%; left: 58%;
  width: 19%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle at 40% 36%, #fffbe8, #ffefb8 58%, #f6d98d);
  box-shadow: 0 0 46px 18px rgba(255, 236, 170, 0.32);
  animation: ms-breathe 10s ease-in-out infinite;
}
@keyframes ms-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.03); } }

.cloud {
  position: absolute;
  height: 7%;
  border-radius: 999px;
  background: rgba(10, 16, 42, 0.55);
  filter: blur(8px);
  animation: ms-cloud linear infinite;
}
.cloud.c1 { top: 14%; width: 42%; animation-duration: 110s; animation-delay: -30s; }
.cloud.c2 { top: 26%; width: 30%; height: 5.5%; animation-duration: 150s; animation-delay: -95s; opacity: 0.8; }
@keyframes ms-cloud { from { transform: translateX(-52vw); } to { transform: translateX(126vw); } }

.sea {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 34%;
  background: linear-gradient(#123063 0%, #081538 42%, #040a20 100%);
  border-top: 1px solid rgba(255, 224, 160, 0.28);
  box-shadow: 0 -1px 18px rgba(255, 228, 160, 0.12);
}

/* 月光倒影：上窄下宽的碎银光带，微微闪烁 */
.reflect {
  position: absolute;
  top: 0; bottom: 0; left: 61%;
  width: 14%;
  background: repeating-linear-gradient(180deg, rgba(255, 238, 190, 0.26) 0 1px, transparent 1px 6px);
  clip-path: polygon(34% 0, 66% 0, 92% 100%, 8% 100%);
  filter: blur(3px);
  animation: ms-shimmer 5s ease-in-out infinite;
  opacity: 0.7;
}
@keyframes ms-shimmer {
  0%, 100% { opacity: 0.45; transform: translateX(0); }
  50% { opacity: 0.8; transform: translateX(1.5%); }
}

.wave {
  position: absolute;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, rgba(160, 200, 255, 0.2) 30% 70%, transparent);
  filter: blur(0.6px);
  animation: ms-wave ease-in-out infinite alternate;
}
@keyframes ms-wave { from { transform: translateX(-5%); } to { transform: translateX(7%); } }

/* 孤帆剪影：贴着海平线缓缓横渡 */
.sail {
  position: absolute;
  top: 63.6%;
  left: -12%;
  width: 3.4%;
  aspect-ratio: 1.5;
  animation: ms-sail 80s linear infinite;
}
.sail i {
  position: absolute;
  inset: 0;
  display: block;
  animation: ms-bob 3.4s ease-in-out infinite alternate;
}
/* 帆 + 船身 */
.sail i::before {
  content: '';
  position: absolute;
  left: 34%; bottom: 34%;
  width: 0; height: 0;
  border-left: 0.42em solid transparent;
  border-right: 0.42em solid transparent;
  border-bottom: 1.15em solid #060d20;
  font-size: 10px;
}
.sail i::after {
  content: '';
  position: absolute;
  left: 8%; bottom: 22%;
  width: 84%; height: 16%;
  border-radius: 40% 60% 46% 54% / 100% 100% 0 0;
  background: #060d20;
}
@keyframes ms-sail { from { left: -12%; } to { left: 110%; } }
@keyframes ms-bob { from { transform: translateY(-1.5px); } to { transform: translateY(1.5px); } }

@media (prefers-reduced-motion: reduce) {
  .star, .moon, .cloud, .wave, .sail, .sail i, .reflect { animation: none; }
  .sail { left: 24%; }
  .cloud { transform: translateX(40%); }
}
</style>
