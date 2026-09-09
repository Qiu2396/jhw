<script setup>
/**
 * 全文资源搜索：一次输入，聚合多个公开资源索引实例，
 * 合并去重返回资源名称 + 网盘类型 + 链接（含提取码）。
 * 支持：一键复制（链接+提取码）、新窗口打开、关键词高亮。
 */
import { ref, computed } from 'vue';
import { resourceSearch } from '../api.js';
import AppIcon from './AppIcon.vue';

const kw = ref('');
const searching = ref(false);
const error = ref('');
const tookMs = ref(0);
const failed = ref([]);
const results = ref([]);

const copiedKey = ref('');
let copyTimer = null;

const hasSearched = computed(() => searching.value || !!results.value.length || !!error.value);

async function doSearch(word) {
  const w = String(word ?? kw.value).trim();
  if (!w || searching.value) return;
  kw.value = w;
  searching.value = true;
  error.value = '';
  results.value = [];
  try {
    const d = await resourceSearch(w);
    results.value = d.results || [];
    failed.value = d.failed || [];
    tookMs.value = d.tookMs || 0;
  } catch (e) {
    error.value = e.message;
  } finally {
    searching.value = false;
  }
}

/** 关键词高亮：把名称切成 [文本, 命中, 文本...] 段渲染（避免 v-html 注入） */
function segments(name) {
  const k = kw.value.trim();
  if (!k) return [{ text: name, hit: false }];
  const out = [];
  const lower = name.toLowerCase();
  const kl = k.toLowerCase();
  let i = 0;
  while (i < name.length) {
    const at = lower.indexOf(kl, i);
    if (at < 0) { out.push({ text: name.slice(i), hit: false }); break; }
    if (at > i) out.push({ text: name.slice(i, at), hit: false });
    out.push({ text: name.slice(at, at + k.length), hit: true });
    i = at + k.length;
  }
  return out;
}

async function copyOne(r) {
  const text = r.name + '\n' + r.url + (r.password ? '\n提取码：' + r.password : '');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 剪贴板不可用时的兜底
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  copiedKey.value = r.url;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copiedKey.value = ''; }, 1500);
}
</script>

<template>
  <div class="res container">
    <h2 class="page-h"><AppIcon name="search" :size="22" class="h-icon" /> 全文搜资源</h2>
    <p class="page-desc">一次输入，聚合多个公开资源索引：软件、资料、影视、书籍……名称命中排前，一键复制链接和提取码。</p>

    <form class="r-search" @submit.prevent="doSearch()">
      <input v-model="kw" placeholder="输入资源名，如：7-Zip、KDE、斗破苍穹" maxlength="60" />
      <button class="btn primary" type="submit" :disabled="searching">
        <span v-if="searching" class="spin"></span> 搜索
      </button>
    </form>

    <p v-if="error" class="r-error">⚠ {{ error }}</p>

    <div v-if="searching" class="r-center"><span class="spin"></span> 正在聚合搜索「<b>{{ kw }}</b>」…</div>

    <template v-else-if="results.length">
      <div class="r-status">
        <span class="badge gold">{{ results.length }} 条结果</span>
        <span class="dim">耗时 {{ (tookMs / 1000).toFixed(1) }} 秒</span>
        <span v-if="failed.length" class="dim">（{{ failed.join('、') }} 暂时不可用）</span>
      </div>
      <div class="r-list">
        <div v-for="r in results" :key="r.url" class="r-item">
          <span class="badge pan">{{ r.panType }}</span>
          <div class="r-body">
            <div class="r-name" :title="r.name">
              <template v-for="(s, i) in segments(r.name)" :key="i">
                <b v-if="s.hit" class="hl">{{ s.text }}</b>
                <template v-else>{{ s.text }}</template>
              </template>
            </div>
            <div class="r-url dim">{{ r.url }}<template v-if="r.password"> · 提取码 {{ r.password }}</template></div>
          </div>
          <div class="r-ops">
            <button class="btn small" :class="{ gold: copiedKey === r.url }" @click="copyOne(r)">
              <AppIcon :name="copiedKey === r.url ? 'star-full' : 'plus'" :size="12" />
              {{ copiedKey === r.url ? '已复制' : '复制' }}
            </button>
            <a class="btn small go" :href="r.url" target="_blank" rel="noopener noreferrer">打开</a>
            <span class="badge from">{{ r.from }}</span>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="hasSearched">
      <div class="r-empty">
        <div class="r-empty-icon">🔍</div>
        <p>没有找到「{{ kw }}」相关资源</p>
        <p class="dim">换个关键词试试，比如软件名、书名或剧名</p>
      </div>
    </template>

    <p v-else class="dim r-empty">输入任意关键词：免费软件、学习资料、想追的书和剧，一搜便知 ✨</p>
  </div>
</template>

<style scoped>
.res { padding-top: 34px; animation: rise 0.35s ease both; }
h2 { margin: 0 0 6px; }
.page-h { display: flex; align-items: center; gap: 9px; }
.h-icon { color: var(--gold); }
.page-desc { color: var(--text-dim); margin: 0 0 24px; font-size: 14px; }
.r-search { display: flex; gap: 10px; margin-bottom: 22px; align-items: center; }
.r-search input {
  flex: 1; max-width: 520px;
  height: 38px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0 14px;
  color: var(--text); font-size: 14px; outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.r-search input:focus { border-color: rgba(242, 185, 75, 0.5); box-shadow: 0 0 0 3px rgba(242, 185, 75, 0.1); }
.r-search .btn { height: 38px; }
.r-error { color: var(--red); font-size: 14px; margin: 0 0 14px; }
.r-center { display: flex; align-items: center; gap: 10px; color: var(--text-dim); padding: 30px 0; justify-content: center; }
.r-empty { text-align: center; padding: 60px 0; }
.r-empty-icon { font-size: 40px; margin-bottom: 10px; }

.r-status { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.r-list {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface);
}
.r-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--border);
  transition: background 0.12s;
}
.r-item:last-child { border-bottom: none; }
.r-item:hover { background: rgba(255, 255, 255, 0.03); }

.badge.pan { flex-shrink: 0; min-width: 44px; text-align: center; }
.r-body { flex: 1; min-width: 0; }
.r-name { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.r-name .hl { color: var(--gold); }
.r-url { font-size: 12px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.r-ops { display: flex; align-items: center; gap: 8px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
.r-ops .btn { display: inline-flex; align-items: center; gap: 4px; }
.r-ops .btn.gold { color: var(--gold); border-color: rgba(242, 185, 75, 0.5); }
.badge.from { font-size: 11px; opacity: 0.75; }

@media (max-width: 720px) {
  .r-item { flex-wrap: wrap; }
  .r-body { flex: 1 1 100%; }
  .r-ops { width: 100%; justify-content: flex-start; }
}
</style>
