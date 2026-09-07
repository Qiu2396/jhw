<script setup>
import { ref } from 'vue';

const props = defineProps({
  initial: { type: String, default: '' },
  compact: { type: Boolean, default: false }
});
const emit = defineEmits(['search']);

const word = ref(props.initial || '');
const HISTORY_KEY = 'fv_search_history';

function submit() {
  const w = word.value.trim();
  if (!w) return;
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const next = [w, ...list.filter(x => x !== w)].slice(0, 8);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
  emit('search', w);
}
</script>

<template>
  <form class="searchbar" :class="{ compact }" @submit.prevent="submit">
    <span class="icon">🔍</span>
    <input
      v-model="word"
      type="text"
      placeholder="输入片名，如：凡人修仙传"
      maxlength="60"
    />
    <button type="submit" class="go">搜索</button>
  </form>
</template>

<style scoped>
.searchbar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 15px;
  padding: 7px 7px 7px 18px;
  transition: border-color 0.2s, box-shadow 0.2s;
  box-shadow: var(--shadow-1);
}
.searchbar:focus-within {
  border-color: rgba(242, 185, 75, 0.55);
  box-shadow: 0 0 0 4px rgba(242, 185, 75, 0.1), var(--shadow-1);
}
.icon { font-size: 15px; opacity: 0.65; }
input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-size: 15px;
}
input::placeholder { color: var(--text-faint); }
.go {
  padding: 0 24px;
  height: 40px;
  border-radius: 11px;
  background: linear-gradient(135deg, var(--gold), var(--gold-2));
  color: #201301;
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
  transition: all 0.18s;
  box-shadow: var(--shadow-gold);
}
.go:hover { filter: brightness(1.07); transform: translateY(-1px); }
.go:active { transform: translateY(0); }
.compact {
  border-radius: 11px;
  padding: 4px 4px 4px 12px;
  box-shadow: none;
}
.compact .go { height: 34px; padding: 0 16px; font-size: 13px; border-radius: 8px; box-shadow: none; }
.compact input { font-size: 14px; }
</style>
