<script setup>
const props = defineProps({
  group: { type: Object, required: true },
  favorite: { type: Boolean, default: false }
});
const emit = defineEmits(['play', 'toggleFav']);

function onCoverError(e) {
  e.target.style.display = 'none';
  const fb = e.target.nextElementSibling;
  if (fb) fb.style.display = 'flex';
}
</script>

<template>
  <div class="card" @click="emit('play')">
    <div class="cover">
      <img v-if="group.cover" :src="group.cover" loading="lazy" @error="onCoverError" />
      <div class="cover-fallback">{{ group.title.slice(0, 1) }}</div>
      <span v-if="group.remarks" class="remarks">{{ group.remarks }}</span>
      <button
        class="fav-btn"
        :class="{ on: favorite }"
        :title="favorite ? '取消收藏' : '收藏'"
        @click.stop="emit('toggleFav')"
      >{{ favorite ? '★' : '☆' }}</button>
      <div class="play-hint"><span>▶ 立即播放</span></div>
    </div>
    <div class="info">
      <div class="title" :title="group.title">{{ group.title }}</div>
      <div class="meta">
        <span v-if="group.year">{{ group.year }}</span>
        <span v-if="group.type">{{ group.type }}</span>
      </div>
      <div class="src-row">
        <span v-for="s in group.sources.slice(0, 3)" :key="s.sourceId + s.vodId" class="badge">{{ s.sourceName }}</span>
        <span v-if="group.sources.length > 3" class="badge">+{{ group.sources.length - 3 }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  animation: rise 0.4s ease both;
}
.card:hover {
  transform: translateY(-4px);
  border-color: rgba(242, 185, 75, 0.45);
  box-shadow: var(--shadow-2);
}
.cover {
  position: relative;
  aspect-ratio: 2 / 3;
  background: var(--bg-soft);
  overflow: hidden;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.35s ease;
}
.card:hover .cover img { transform: scale(1.04); }
.cover-fallback {
  display: none;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 42px;
  font-weight: 700;
  color: var(--gold);
  background: linear-gradient(135deg, #262e4a, #1a2030);
}
.remarks {
  position: absolute;
  left: 8px;
  top: 8px;
  max-width: calc(100% - 16px);
  padding: 3px 9px;
  border-radius: 7px;
  font-size: 12px;
  background: rgba(8, 10, 16, 0.72);
  backdrop-filter: blur(6px);
  color: var(--gold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fav-btn {
  position: absolute;
  right: 8px;
  top: 8px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  font-size: 16px;
  line-height: 1;
  color: #fff;
  background: rgba(8, 10, 16, 0.55);
  backdrop-filter: blur(6px);
  transition: all 0.15s;
  opacity: 0;
}
.card:hover .fav-btn, .fav-btn.on { opacity: 1; }
.fav-btn:hover { transform: scale(1.12); background: rgba(8, 10, 16, 0.8); }
.fav-btn.on { color: var(--gold); }
.play-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(to top, rgba(8, 10, 16, 0.7), rgba(8, 10, 16, 0.35));
  opacity: 0;
  transition: opacity 0.2s;
}
.play-hint span {
  padding: 9px 20px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--gold), var(--gold-2));
  color: #201301;
  font-weight: 600;
  font-size: 14px;
  box-shadow: var(--shadow-gold);
}
.card:hover .play-hint { opacity: 1; }
.info { padding: 11px 13px 13px; }
.title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  display: flex;
  gap: 8px;
  margin-top: 3px;
  font-size: 12px;
  color: var(--text-faint);
}
.src-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 9px;
}
.src-row .badge { font-size: 11px; height: 18px; padding: 0 6px; }
</style>
