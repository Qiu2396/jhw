/**
 * 个人播放/阅读记录（模块级单例）
 *
 * 统一管理五个频道的「最近看过/听过」记录：
 *   video | music | audiobook | novel | comic
 *
 * - 已登录：记录同步到服务端（不同设备/浏览器都能续播）
 * - 未登录：退化为 localStorage（本机可用），登录后自动切到服务端
 *
 * 每条记录：{ kind, key, title, subtitle, cover, ts, payload }
 * payload 里存续播所需的全部信息（源、章节地址、集数索引等），
 * 频道页用它「点击直接续播/续读」。
 */
import { ref } from 'vue';
import { getHistory, putHistory, removeHistoryItem, clearHistoryKind } from './api.js';
import { useAuth } from './authStore.js';

export const KINDS = ['video', 'music', 'audiobook', 'novel', 'comic'];
export const KIND_LABEL = { video: '影视', music: '音乐', audiobook: '听书', novel: '小说', comic: '漫画' };

const LOCAL_PREFIX = 'fv_hist_';
const MAX_ITEMS = 60;

const lists = Object.fromEntries(KINDS.map(k => [k, ref([])]));
const loaded = new Set();

/* ---- 跨页续播总线：首页点记录 → 切频道 → 频道页取走并直接续播 ---- */
const pending = ref(null);

export function setPendingResume(entry) {
  pending.value = entry;
}

export function takePendingResume(kind) {
  if (pending.value?.kind === kind) {
    const v = pending.value;
    pending.value = null;
    return v;
  }
  return null;
}

/* ---- 本地兜底 ---- */

function localLoad(kind) {
  try { return JSON.parse(localStorage.getItem(LOCAL_PREFIX + kind) || '[]'); }
  catch { return []; }
}

function localSave(kind, list) {
  try { localStorage.setItem(LOCAL_PREFIX + kind, JSON.stringify(list.slice(0, MAX_ITEMS))); }
  catch { /* 隐私模式等 */ }
}

/**
 * 记录一条（同 key 去重；新记录置顶，keepPos 用于「只更新进度不换位置」）
 */
export function record(entry, { keepPos = false } = {}) {
  if (!entry || !KINDS.includes(entry.kind) || entry.key === undefined || entry.key === null) return;
  const item = { ...entry, key: String(entry.key), ts: entry.ts || Date.now() };
  const old = lists[item.kind].value;
  const prevIdx = old.findIndex(x => x.key === item.key);
  const rest = old.filter(x => x.key !== item.key);
  if (keepPos && prevIdx >= 0) {
    rest.splice(prevIdx, 0, item);
  } else {
    rest.unshift(item);
  }
  lists[item.kind].value = rest.slice(0, MAX_ITEMS);

  const { user } = useAuth();
  if (user.value) {
    putHistory(item).catch(() => { /* 服务端失败不弹错，本地已更新 */ });
  } else {
    localSave(item.kind, lists[item.kind].value);
  }
}

export function removeEntry(kind, key) {
  lists[kind].value = lists[kind].value.filter(x => x.key !== key);
  const { user } = useAuth();
  if (user.value) removeHistoryItem(kind, key).catch(() => {});
  else localSave(kind, lists[kind].value);
}

export function clearKind(kind) {
  lists[kind].value = [];
  const { user } = useAuth();
  if (user.value) clearHistoryKind(kind).catch(() => {});
  else localStorage.removeItem(LOCAL_PREFIX + kind);
}

export function peekList(kind) {
  return lists[kind];
}

/** 频道页进入时调用：拉取该频道记录（登录→服务端刷新；游客→本机读一次） */
export async function loadKind(kind) {
  const { user } = useAuth();
  if (user.value) {
    try {
      lists[kind].value = (await getHistory(kind)).items || [];
    } catch {
      if (!lists[kind].value.length) lists[kind].value = localLoad(kind);
    }
  } else if (!loaded.has(kind)) {
    loaded.add(kind);
    lists[kind].value = localLoad(kind);
  }
  return lists[kind].value;
}

/** 登录态变化后由 App 调用：清缓存标记，重新按新身份拉取 */
export function resetHistoryCache() {
  loaded.clear();
  for (const k of KINDS) lists[k].value = [];
}
