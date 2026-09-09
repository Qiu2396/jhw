<script setup>
/**
 * 鹈鹕骑车动画（线稿风格，颜色随 currentColor）：
 * 车轮与脚蹬旋转、鹈鹕身体起伏、路面虚线后掠。
 * paused 为 true 时全部动画定格（用于暂停态）。
 */
defineProps({
  size: { type: Number, default: 36 },
  paused: { type: Boolean, default: false }
});
</script>

<template>
  <svg
    class="pelican-rider"
    :class="{ paused }"
    :width="size"
    :height="Math.round(size * 64 / 96)"
    viewBox="0 0 96 64"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- 路面（虚线后掠） -->
    <line class="prd-ground" x1="3" y1="61" x2="93" y2="61" stroke-dasharray="7 5" />

    <!-- 车轮 -->
    <g class="prd-wheel">
      <circle cx="20" cy="48" r="11" />
      <line x1="20" y1="37.5" x2="20" y2="58.5" />
      <line x1="9.5" y1="48" x2="30.5" y2="48" />
      <line x1="12.7" y1="40.7" x2="27.3" y2="55.3" />
      <line x1="12.7" y1="55.3" x2="27.3" y2="40.7" />
    </g>
    <g class="prd-wheel">
      <circle cx="76" cy="48" r="11" />
      <line x1="76" y1="37.5" x2="76" y2="58.5" />
      <line x1="65.5" y1="48" x2="86.5" y2="48" />
      <line x1="68.7" y1="40.7" x2="83.3" y2="55.3" />
      <line x1="68.7" y1="55.3" x2="83.3" y2="40.7" />
    </g>

    <!-- 车架 -->
    <path d="M20 48 L44 48 L38 26" />
    <path d="M38 26 L66 26" />
    <path d="M44 48 L68 30 L76 48" />
    <path d="M38 26 L35 21" />
    <path d="M29 21 L41 21" />
    <path d="M66 26 L63 19" />
    <path d="M58 19 Q63 15.5 68 19" />

    <!-- 脚蹬曲柄（旋转，bbox 中心恰为中轴） -->
    <g class="prd-crank">
      <line x1="44" y1="48" x2="52" y2="53" />
      <line x1="44" y1="48" x2="36" y2="43" />
      <circle cx="53.5" cy="54" r="2" />
      <circle cx="34.5" cy="42" r="2" />
    </g>

    <!-- 鹈鹕（身体轻微起伏） -->
    <g class="prd-bird">
      <path d="M23 16 L16.5 11.5 M24 20 L16.5 17.5" />
      <ellipse cx="34" cy="20" rx="13" ry="8.5" />
      <path d="M43 14.5 C49 12.5 50 9 52 7" />
      <circle cx="54" cy="7" r="4" />
      <path d="M57.5 5.5 L74.5 9 L58 11.5" />
      <path d="M58 11.5 Q67 15.5 73 9.8" />
      <circle class="prd-eye" cx="55.6" cy="6" r="1" fill="currentColor" stroke="none" />
      <path d="M28 16.5 Q36 23 44.5 19" />
      <path d="M39 27.5 Q43.5 38 44.5 45.5" />
      <path d="M32 28 Q37.5 40 38.5 44" />
    </g>
  </svg>
</template>

<style scoped>
.prd-wheel,
.prd-crank {
  transform-box: fill-box;
  transform-origin: center;
  animation: prd-spin 1.1s linear infinite;
}
.prd-bird { animation: prd-bob 0.65s ease-in-out infinite alternate; }
.prd-ground { animation: prd-road 0.4s linear infinite; }

@keyframes prd-spin { to { transform: rotate(360deg); } }
@keyframes prd-bob { from { transform: translateY(0); } to { transform: translateY(1.6px); } }
@keyframes prd-road { to { stroke-dashoffset: -12; } }

.paused .prd-wheel,
.paused .prd-crank,
.paused .prd-bird,
.paused .prd-ground { animation-play-state: paused; }

@media (prefers-reduced-motion: reduce) {
  .prd-wheel, .prd-crank, .prd-bird, .prd-ground { animation: none; }
}
</style>
