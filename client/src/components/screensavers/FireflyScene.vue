<script setup>
/**
 * 屏保场景：流萤森林 —— 夏夜森林剪影间，点点萤火明灭漂浮，薄雾缓缓流动。
 * 纯场景组件：absolute 铺满父容器；萤火虫双层动画：外层缓慢漂移（随机向量），
 * 内层呼吸式明暗 + 光晕。
 */
const flies = Array.from({ length: 34 }, (_, i) => ({
  id: i,
  x: +(2 + Math.random() * 96).toFixed(2),
  y: +(16 + Math.random() * 74).toFixed(2),
  s: +(4 + Math.random() * 5).toFixed(1),
  dx: Math.round((Math.random() - 0.5) * 220),          // 漂移终点向量 px
  dy: Math.round((Math.random() - 0.5) * 140),
  dur: +(7 + Math.random() * 9).toFixed(2),
  delay: -+(Math.random() * 12).toFixed(2),
  gd: +(2.2 + Math.random() * 3).toFixed(2),            // 明暗呼吸周期
  gDelay: -+(Math.random() * 4).toFixed(2)
}));

const stars = Array.from({ length: 22 }, (_, i) => ({
  id: i,
  x: +(Math.random() * 100).toFixed(2),
  y: +(Math.random() * 30).toFixed(2),
  s: +(0.7 + Math.random() * 1.2).toFixed(1),
  delay: +(Math.random() * 4).toFixed(2),
  dur: +(2.6 + Math.random() * 3).toFixed(2)
}));
</script>

<template>
  <div class="scene ff">
    <div class="sky"></div>
    <span
      v-for="st in stars" :key="st.id" class="star"
      :style="{ left: st.x + '%', top: st.y + '%', width: st.s + 'px', height: st.s + 'px', animationDelay: st.delay + 's', animationDuration: st.dur + 's' }"
    ></span>

    <!-- 树冠与树影 -->
    <div class="canopy"></div>
    <div class="trunk t1"></div>
    <div class="trunk t2"></div>
    <div class="bush"></div>

    <!-- 薄雾 -->
    <div class="mist m1"></div>
    <div class="mist m2"></div>

    <!-- 流萤 -->
    <div
      v-for="f in flies" :key="f.id" class="fly"
      :style="{ left: f.x + '%', top: f.y + '%', animationDuration: f.dur + 's', animationDelay: f.delay + 's', '--dx': f.dx + 'px', '--dy': f.dy + 'px' }"
    >
      <i
        :style="{
          width: f.s + 'px', height: f.s + 'px',
          animationDuration: f.gd + 's', animationDelay: f.gDelay + 's'
        }"
      ></i>
    </div>
  </div>
</template>

<style scoped>
.scene { position: absolute; inset: 0; overflow: hidden; }
.ff { background: linear-gradient(#030d12 0%, #07271e 55%, #0c3a26 100%); }

.star { position: absolute; border-radius: 50%; background: #cfe8d8; opacity: 0.3; animation: ff-twinkle linear infinite; }
@keyframes ff-twinkle { 0%, 100% { opacity: 0.1; } 50% { opacity: 0.7; } }

.canopy {
  position: absolute;
  left: -4%; right: -4%; top: -12%;
  height: 30%;
  background: radial-gradient(46% 88% at 12% 0%, #02130c 98%, transparent), radial-gradient(52% 96% at 42% 0%, #031a10 98%, transparent), radial-gradient(46% 88% at 72% 0%, #02150d 98%, transparent), radial-gradient(40% 80% at 94% 0%, #031a10 98%, transparent);
  filter: blur(2px);
}
.trunk { position: absolute; bottom: 0; width: 3.2%; height: 62%; background: linear-gradient(#052013, #020f09); }
.trunk.t1 { left: 9%; transform: rotate(1.6deg); }
.trunk.t2 { right: 11%; transform: rotate(-2deg); }
.bush {
  position: absolute;
  left: -4%; right: -4%; bottom: -4%;
  height: 26%;
  background: radial-gradient(30% 92% at 6% 100%, #02120b 98%, transparent), radial-gradient(34% 100% at 24% 100%, #041a10 98%, transparent), radial-gradient(30% 90% at 45% 100%, #02150d 98%, transparent), radial-gradient(36% 104% at 68% 100%, #041a10 98%, transparent), radial-gradient(32% 94% at 90% 100%, #02120b 98%, transparent);
  filter: blur(2px);
}

.mist {
  position: absolute;
  height: 14%;
  border-radius: 999px;
  background: rgba(140, 220, 170, 0.07);
  filter: blur(14px);
  animation: ff-mist ease-in-out infinite alternate;
}
.mist.m1 { left: -10%; width: 60%; top: 58%; animation-duration: 34s; }
.mist.m2 { right: -12%; width: 52%; top: 74%; animation-duration: 46s; animation-delay: -12s; }
@keyframes ff-mist { from { transform: translateX(-6%); } to { transform: translateX(9%); } }

/* ---- 萤火虫：外层漂移，内层呼吸发光 ---- */
.fly { position: absolute; width: 0; height: 0; animation: ff-move ease-in-out infinite alternate; will-change: transform; }
@keyframes ff-move { from { transform: translate(0, 0); } to { transform: translate(var(--dx), var(--dy)); } }
.fly i {
  position: absolute;
  display: block;
  border-radius: 50%;
  background: radial-gradient(circle, #fdffe0 0 20%, #d8ff9e 45%, rgba(160, 255, 110, 0.35) 72%, transparent 100%);
  box-shadow: 0 0 14px 5px rgba(190, 255, 130, 0.32);
  animation: ff-glow ease-in-out infinite;
}
@keyframes ff-glow {
  0%, 100% { opacity: 0.08; transform: scale(0.72); }
  50% { opacity: 1; transform: scale(1.12); }
}

@media (prefers-reduced-motion: reduce) {
  .star, .mist, .fly, .fly i { animation: none; }
  .fly i { opacity: 0.75; }
}
</style>
