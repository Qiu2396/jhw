<script setup>
/**
 * 屏保场景：樱吹雪 —— 暮色天空、暖色落日与远山剪影，粉色花瓣随风纷飞。
 * 纯场景组件：absolute 铺满父容器（列表卡片 / 预览框 / 全屏舞台通用），
 * 时钟与退出按钮由 ScreensaverView 的全屏外壳负责。
 * 花瓣双层动画：外层 faller 匀速下落（translateY 按容器高百分比），内层左右摇摆 + 自旋。
 */
const petals = Array.from({ length: 42 }, (_, i) => ({
  id: i,
  left: +(Math.random() * 100).toFixed(2),
  size: +(9 + Math.random() * 9).toFixed(1),
  dur: +(8 + Math.random() * 9).toFixed(2),        // 整段下落
  sway: +(1.8 + Math.random() * 1.6).toFixed(2),   // 左右摇摆周期
  spin: +(1.6 + Math.random() * 2.2).toFixed(2),   // 自旋周期
  delay: -+(Math.random() * 18).toFixed(2),        // 负延迟：开局即散布全程
  drift: Math.round(24 + Math.random() * 60),      // 水平漂移幅度 px
  tone: Math.floor(Math.random() * 3),             // 三种粉
  op: +(0.55 + Math.random() * 0.45).toFixed(2)
}));

const stars = Array.from({ length: 26 }, (_, i) => ({
  id: i,
  x: +(Math.random() * 100).toFixed(2),
  y: +(Math.random() * 36).toFixed(2),
  s: +(0.8 + Math.random() * 1.4).toFixed(1),
  delay: +(Math.random() * 4).toFixed(2),
  dur: +(2.4 + Math.random() * 3).toFixed(2)
}));
</script>

<template>
  <div class="scene sk">
    <div class="sky"></div>
    <span
      v-for="st in stars" :key="st.id" class="star"
      :style="{ left: st.x + '%', top: st.y + '%', width: st.s + 'px', height: st.s + 'px', animationDelay: st.delay + 's', animationDuration: st.dur + 's' }"
    ></span>

    <!-- 落日 -->
    <div class="sun"></div>

    <!-- 流云 -->
    <div class="cloud c1"></div>
    <div class="cloud c2"></div>
    <div class="cloud c3"></div>

    <!-- 远山两层剪影 -->
    <div class="mts far"></div>
    <div class="mts near"></div>

    <!-- 花瓣 -->
    <div
      v-for="p in petals" :key="p.id" class="faller"
      :style="{ left: p.left + '%', animationDuration: p.dur + 's', animationDelay: p.delay + 's' }"
    >
      <i
        class="petal"
        :class="'t' + p.tone"
        :style="{
          width: p.size + 'px', height: p.size * 1.15 + 'px', opacity: p.op,
          '--drift': p.drift + 'px',
          animationDuration: p.sway + 's, ' + p.spin + 's'
        }"
      ></i>
    </div>
  </div>
</template>

<style scoped>
.scene { position: absolute; inset: 0; overflow: hidden; }
.sk { background: linear-gradient(#241b3a 0%, #4d2c52 42%, #94486c 72%, #d97b7a 100%); }

.star { position: absolute; border-radius: 50%; background: #fff; opacity: 0.3; animation: sk-twinkle linear infinite; }
@keyframes sk-twinkle { 0%, 100% { opacity: 0.1; } 50% { opacity: 0.8; } }

.sun {
  position: absolute;
  top: 16%; left: 66%;
  width: 21%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle at 40% 38%, #fff3dd, #ffcf9c 60%, #ffb98a);
  box-shadow: 0 0 60px 24px rgba(255, 190, 140, 0.38);
  animation: sk-breathe 9s ease-in-out infinite;
}
@keyframes sk-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.035); } }

.cloud {
  position: absolute;
  height: 6.5%;
  border-radius: 999px;
  background: rgba(255, 220, 210, 0.16);
  filter: blur(9px);
  animation: sk-cloud linear infinite;
}
.cloud.c1 { top: 20%; width: 34%; animation-duration: 96s; animation-delay: -18s; }
.cloud.c2 { top: 34%; width: 26%; height: 5%; animation-duration: 128s; animation-delay: -70s; opacity: 0.8; }
.cloud.c3 { top: 11%; width: 20%; height: 4.5%; animation-duration: 150s; animation-delay: -40s; opacity: 0.6; }
@keyframes sk-cloud { from { transform: translateX(-46vw); } to { transform: translateX(130vw); } }

.mts { position: absolute; left: 0; right: 0; bottom: 0; }
.mts.far {
  height: 42%;
  background: linear-gradient(#6b4168, #45284e);
  clip-path: polygon(0 100%, 0 62%, 12% 44%, 24% 60%, 36% 38%, 50% 58%, 62% 42%, 74% 60%, 86% 46%, 100% 64%, 100% 100%);
  opacity: 0.85;
}
.mts.near {
  height: 30%;
  background: linear-gradient(#3a2145, #241336);
  clip-path: polygon(0 100%, 0 55%, 10% 72%, 22% 30%, 35% 66%, 47% 44%, 60% 74%, 73% 36%, 87% 62%, 100% 48%, 100% 100%);
}

/* ---- 花瓣：faller 负责下落，petal 负责摇摆 + 自旋 ---- */
.faller { position: absolute; top: 0; bottom: 0; width: 0; animation: sk-fall linear infinite; }
@keyframes sk-fall { from { transform: translateY(-12%); } to { transform: translateY(112%); } }
.petal {
  position: absolute;
  top: 0;
  display: block;
  border-radius: 100% 4% 100% 4%;
  background: linear-gradient(135deg, #ffd9e4, #ff9dbb);
  animation: sk-sway ease-in-out infinite alternate, sk-spin linear infinite;
  will-change: transform;
}
.petal.t1 { background: linear-gradient(135deg, #ffc6d8, #f78fb3); }
.petal.t2 { background: linear-gradient(135deg, #ffe7ee, #ffb7cd); }
@keyframes sk-sway { from { transform: translateX(calc(var(--drift) * -1)); } to { transform: translateX(var(--drift)); } }
@keyframes sk-spin { from { rotate: 0deg; } to { rotate: 360deg; } }

@media (prefers-reduced-motion: reduce) {
  .star, .sun, .cloud, .faller, .petal { animation: none; }
  .cloud { transform: translateX(30%); }
  .faller { transform: translateY(40%); }
}
</style>
