<script setup>
/**
 * 屏保场景：极光之夜 —— 绿紫极光在星空与雪原山脊上缓缓流动，湖面映着微光。
 * 纯场景组件：absolute 铺满父容器；极光用大块模糊渐变 + mix-blend screen 发光，
 * 三条飘带各自不同周期摆动（alternate 往返，无跳变）。
 */
const stars = Array.from({ length: 80 }, (_, i) => ({
  id: i,
  x: +(Math.random() * 100).toFixed(2),
  y: +(Math.random() * 62).toFixed(2),
  s: +(0.8 + Math.random() * 1.6).toFixed(1),
  delay: +(Math.random() * 4).toFixed(2),
  dur: +(2.2 + Math.random() * 3.4).toFixed(2)
}));
</script>

<template>
  <div class="scene au">
    <div class="sky"></div>
    <span
      v-for="st in stars" :key="st.id" class="star"
      :style="{ left: st.x + '%', top: st.y + '%', width: st.s + 'px', height: st.s + 'px', animationDelay: st.delay + 's', animationDuration: st.dur + 's' }"
    ></span>

    <!-- 极光飘带 ×3 -->
    <div class="ribbon r1"></div>
    <div class="ribbon r2"></div>
    <div class="ribbon r3"></div>

    <!-- 月亮 -->
    <div class="moon"></div>

    <!-- 雪原山脊两层 -->
    <div class="mts far"></div>
    <div class="mts near"></div>

    <!-- 湖面 + 极光倒影 -->
    <div class="lake"></div>
    <div class="mirror"></div>
  </div>
</template>

<style scoped>
.scene { position: absolute; inset: 0; overflow: hidden; }
.au { background: linear-gradient(#01030f 0%, #041028 45%, #0a1e3c 78%, #123049 100%); }

.star { position: absolute; border-radius: 50%; background: #fff; opacity: 0.3; animation: au-twinkle linear infinite; }
@keyframes au-twinkle { 0%, 100% { opacity: 0.12; } 50% { opacity: 0.9; } }

.ribbon {
  position: absolute;
  left: -15%;
  width: 130%;
  filter: blur(26px);
  mix-blend-mode: screen;
  animation: au-sway ease-in-out infinite alternate;
  will-change: transform;
}
.ribbon.r1 {
  top: -4%; height: 38%;
  background: linear-gradient(105deg, transparent 6%, rgba(64, 255, 178, 0.44) 30%, rgba(140, 255, 214, 0.26) 46%, rgba(64, 158, 255, 0.30) 64%, transparent 90%);
  animation-duration: 15s;
}
.ribbon.r2 {
  top: 6%; height: 30%;
  background: linear-gradient(100deg, transparent 10%, rgba(150, 110, 255, 0.34) 38%, rgba(94, 234, 212, 0.30) 60%, transparent 88%);
  animation-duration: 21s;
  animation-delay: -8s;
  opacity: 0.85;
}
.ribbon.r3 {
  top: 14%; height: 22%;
  background: linear-gradient(98deg, transparent 14%, rgba(56, 224, 255, 0.26) 42%, rgba(120, 255, 190, 0.22) 62%, transparent 86%);
  animation-duration: 27s;
  animation-delay: -15s;
  opacity: 0.7;
}
@keyframes au-sway {
  from { transform: translateX(-4%) rotate(-3deg) scaleY(1); }
  to { transform: translateX(5%) rotate(3.5deg) scaleY(1.28); }
}

.moon {
  position: absolute;
  top: 9%; right: 10%;
  width: 7%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle at 36% 34%, #fdfbf1, #e8e4d0 62%, #cfcbb6);
  box-shadow: 0 0 26px 8px rgba(240, 240, 210, 0.28);
}

.mts { position: absolute; left: 0; right: 0; bottom: 0; }
.mts.far {
  bottom: 12%;
  height: 34%;
  background: linear-gradient(#1c3157, #101f3d);
  clip-path: polygon(0 100%, 0 58%, 9% 34%, 18% 52%, 30% 24%, 42% 50%, 53% 30%, 65% 54%, 77% 28%, 88% 48%, 100% 36%, 100% 100%);
}
.mts.near {
  height: 26%;
  background: linear-gradient(#0e1c38, #060e21);
  clip-path: polygon(0 100%, 0 46%, 12% 68%, 25% 22%, 39% 60%, 52% 38%, 66% 70%, 80% 30%, 92% 58%, 100% 44%, 100% 100%);
}

.lake {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 13%;
  background: linear-gradient(180deg, rgba(90, 140, 255, 0.14), rgba(2, 6, 18, 0.4) 85%);
  border-top: 1px solid rgba(160, 200, 255, 0.18);
}
.mirror {
  position: absolute;
  left: -15%; bottom: 1.5%;
  width: 130%; height: 11%;
  background: linear-gradient(100deg, transparent 12%, rgba(64, 255, 178, 0.20) 36%, rgba(110, 160, 255, 0.16) 60%, transparent 86%);
  filter: blur(16px);
  mix-blend-mode: screen;
  animation: au-sway 19s ease-in-out infinite alternate;
  opacity: 0.6;
}

@media (prefers-reduced-motion: reduce) {
  .star, .ribbon, .mirror { animation: none; }
  .ribbon.r1, .ribbon.r2, .mirror { transform: rotate(-2deg); }
}
</style>
