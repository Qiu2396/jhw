const TOKEN_KEY = 'fv_token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export function setToken(t) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* 隐私模式等 */ }
}

async function request(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`响应异常 (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function getJSON(url) {
  return request(url);
}

async function postJSON(url, body) {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
}

/* ---- 账号体系 ---- */

export const apiRegister = (username, password) => postJSON('/api/auth/register', { username, password });

export const apiLogin = (username, password) => postJSON('/api/auth/login', { username, password });

export const apiLogout = () => postJSON('/api/auth/logout');

export const apiMe = () => getJSON('/api/auth/me');

/* ---- 个人播放/阅读记录 ---- */

export const getHistory = (kind) => getJSON(`/api/history?kind=${encodeURIComponent(kind)}&_=${Date.now()}`);

export const putHistory = (entry) => postJSON('/api/history', entry);

export const removeHistoryItem = (kind, key) =>
  request(`/api/history/${encodeURIComponent(kind)}/${encodeURIComponent(key)}`, { method: 'DELETE' });

export const clearHistoryKind = (kind) =>
  request(`/api/history/${encodeURIComponent(kind)}`, { method: 'DELETE' });

export const search = (kw, exclude) =>
  getJSON(`/api/search?kw=${encodeURIComponent(kw)}${exclude ? `&exclude=${encodeURIComponent(exclude)}` : ''}`);

export const getDetail = (source, vid) =>
  getJSON(`/api/detail?source=${encodeURIComponent(source)}&vid=${encodeURIComponent(vid)}`);

export const getSources = () => getJSON('/api/sources');

/* ---- 源管理 ---- */

export const addSource = (data) => postJSON('/api/sources', data);

export async function putSource(id, data) {
  return request(`/api/sources/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export const removeSource = (id) =>
  request(`/api/sources/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const checkSources = (id = 'all') => postJSON('/api/sources/check', { id });

/* ---- 内置频道源（音乐/小说/听书/漫画） ---- */

export const getChannelSources = () => getJSON('/api/channel-sources');

export const toggleChannelSource = (kind, id, disabled) =>
  postJSON('/api/channel-sources/toggle', { kind, id, disabled });

export const checkChannelSource = (kind, id) =>
  postJSON('/api/channel-sources/check', { kind, id });

/* ---- AI ---- */

export const getAiConfig = () => getJSON('/api/ai/config');

export const saveAiConfig = (data) => postJSON('/api/ai/config', data);

export const testAiConnection = () => postJSON('/api/ai/test');

// AI 发现新源可能需要 1~2 分钟（LLM 生成 + 逐个验证），调用方自行做等待态
export const aiDiscoverSources = (autoAdd = true, count = 8) => postJSON('/api/ai/discover-sources', { autoAdd, count });

export const aiAnalyzeHealth = () => postJSON('/api/ai/analyze');

export const aiLogs = () => getJSON('/api/ai/logs');

/* ---- 音乐（免费听歌） ---- */

export const searchMusic = (name, count = 30) =>
  getJSON(`/api/music/search?name=${encodeURIComponent(name)}&count=${count}&_=${Date.now()}`);

export const musicUrl = (songId, br = 320000) =>
  getJSON(`/api/music/url?songId=${songId}&br=${br}&_=${Date.now()}`);

export const musicLyric = (songId) =>
  getJSON(`/api/music/lyric?songId=${songId}&_=${Date.now()}`);

export const musicPic = (songId, size = 300) =>
  getJSON(`/api/music/pic?songId=${songId}&size=${size}&_=${Date.now()}`);

/* ---- 小说 ---- */

export const novelSearch = (kw) =>
  getJSON(`/api/novel/search?kw=${encodeURIComponent(kw)}&_=${Date.now()}`);

export const novelToc = (src, url) =>
  getJSON(`/api/novel/toc?src=${encodeURIComponent(src)}&url=${encodeURIComponent(url)}&_=${Date.now()}`);

export const novelChapter = (src, url) =>
  getJSON(`/api/novel/chapter?src=${encodeURIComponent(src)}&url=${encodeURIComponent(url)}&_=${Date.now()}`);

/* ---- 听书（有声小说） ---- */

export const audiobookSearch = (kw) =>
  getJSON(`/api/audiobook/search?kw=${encodeURIComponent(kw)}&_=${Date.now()}`);

export const audiobookBook = (src, url) =>
  getJSON(`/api/audiobook/book?src=${encodeURIComponent(src)}&url=${encodeURIComponent(url)}&_=${Date.now()}`);

export const audiobookPlay = (src, url) =>
  getJSON(`/api/audiobook/play?src=${encodeURIComponent(src)}&url=${encodeURIComponent(url)}&_=${Date.now()}`);

/* ---- 漫画 ---- */

export const comicSearch = (kw) =>
  getJSON(`/api/comic/search?kw=${encodeURIComponent(kw)}&_=${Date.now()}`);

export const comicBook = (src, url) =>
  getJSON(`/api/comic/book?src=${encodeURIComponent(src)}&url=${encodeURIComponent(url)}&_=${Date.now()}`);

export const comicImages = (src, url) =>
  getJSON(`/api/comic/images?src=${encodeURIComponent(src)}&url=${encodeURIComponent(url)}&_=${Date.now()}`);

/* ---- 全文资源搜索 ---- */

export const resourceSearch = (kw) =>
  getJSON(`/api/resource/search?kw=${encodeURIComponent(kw)}&_=${Date.now()}`);

/* ---- 电台音乐 ---- */

export const popularRadio = () => getJSON(`/api/radio/popular?_=${Date.now()}`);

export const searchRadio = (name) => getJSON(`/api/radio/search?name=${encodeURIComponent(name)}&_=${Date.now()}`);
