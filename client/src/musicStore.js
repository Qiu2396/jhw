/**
 * 全局音乐播放器（模块级单例）
 *
 * 音频元素不挂在任何路由组件里，而是常驻内存 ——
 * 这样从音乐页切到小说/首页时音乐不会中断，可以边听歌边看小说。
 *
 * 歌单里的歌可以只有 {name, artist}（推荐歌单），播放时按需搜索解析 songId。
 */
import { ref, computed } from 'vue';
import { searchMusic, musicUrl, musicLyric, musicPic } from './api.js';

const VOL_KEY = 'fv_volume';

// ---- 响应式状态（模块级，全 app 共享） ----
const queue = ref([]);            // 播放队列 [{songId?, name, artist, album?}]
const currentIdx = ref(-1);
const playing = ref(false);
const buffering = ref(false);
const error = ref('');
const currentTime = ref(0);
const duration = ref(0);
const bufferedEnd = ref(0);
const volume = ref(parseFloat(localStorage.getItem(VOL_KEY) || '0.9'));
const mode = ref('order');        // order 顺序 | loop 列表循环 | one 单曲循环 | shuffle 随机
const lyricLines = ref([]);       // [{t, text}]
const lyricIdx = ref(-1);
const cover = ref('');

const currentSong = computed(() => queue.value[currentIdx.value] || null);

let audio = null;
let loadSeq = 0;                  // 防止并发加载互相覆盖
let consecutiveFails = 0;         // 连续解析/播放失败次数（歌单自动跳歌用，超限停下）
let resolveRetryUsed = false;     // 懒解析条目（听书）直链失效后，重解析只自动试一次
const baseTitle = typeof document !== 'undefined' ? document.title : '';

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  audio.volume = volume.value;
  audio.addEventListener('loadedmetadata', () => { duration.value = audio.duration || 0; });
  audio.addEventListener('timeupdate', onTime);
  audio.addEventListener('progress', () => {
    try { bufferedEnd.value = audio.buffered.end(audio.buffered.length - 1) || 0; } catch { /* ignore */ }
  });
  audio.addEventListener('playing', () => {
    playing.value = true; buffering.value = false; consecutiveFails = 0; resolveRetryUsed = false; updateTitle();
  });
  audio.addEventListener('pause', () => { playing.value = false; updateTitle(); });
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('error', () => {
    if (audio.src) onFail(new Error('音源加载失败，已自动跳到下一首'), true);
  });
  if (typeof window !== 'undefined') window.__fvAudio = audio;   // 诊断用（同 __vueErrs 惯例）
  return audio;
}

function onTime() {
  currentTime.value = audio.currentTime || 0;
  const ls = lyricLines.value;
  if (!ls.length) { lyricIdx.value = -1; return; }
  let idx = -1;
  for (let i = 0; i < ls.length; i++) {
    if (ls[i].t <= currentTime.value + 0.25) idx = i;
    else break;
  }
  lyricIdx.value = idx;
}

/** 自然播完：按模式推进（顺序播放到队尾即停） */
function onEnded() {
  if (mode.value === 'one') {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  const t = targetIndex(1);
  if (t === -1 || t === currentIdx.value) {
    playing.value = false; updateTitle();
    return;
  }
  currentIdx.value = t;
  loadCurrent();
}

/** 计算下一首目标（shuffle 随机；loop 环绕；order 到头返回 -1） */
function targetIndex(step) {
  const n = queue.value.length;
  if (!n) return -1;
  if (mode.value === 'shuffle' && n > 1) {
    let r;
    do { r = Math.floor(Math.random() * n); } while (r === currentIdx.value);
    return r;
  }
  const next = currentIdx.value + step;
  if (mode.value === 'loop') return (next + n) % n;
  return next >= 0 && next < n ? next : -1;
}

function onFail(e, fromAudio = false) {
  buffering.value = false;
  error.value = e.message || '播放失败';
  // 听书直链会过期（token 10 分钟 / 音频服务器迁移）：媒体加载失败先重解析当前集，
  // 只自动重试一次（成功续播后 resolveRetryUsed 在 playing 事件复位）；再失败走跳下一集
  const cur = queue.value[currentIdx.value];
  if (fromAudio && !resolveRetryUsed && cur && typeof cur.resolve === 'function') {
    resolveRetryUsed = true;
    const seqAtRetry = loadSeq;
    cur.resolve().then(re => {
      if (seqAtRetry !== loadSeq || !re?.url) return skipCurrent();
      queue.value[currentIdx.value] = { ...cur, ...re, resolve: cur.resolve };
      const a = ensureAudio();
      error.value = '';
      buffering.value = true;
      a.src = re.url;
      a.play().catch(() => {});
    }).catch(() => skipCurrent());
    return;
  }
  skipCurrent();
}

/** 原有逻辑：自动跳下一集（连续失败太多次就停） */
function skipCurrent() {
  consecutiveFails++;
  // 歌单场景自动跳过坏歌；连续失败太多次（比如断网）就停
  if (queue.value.length > 1 && consecutiveFails < 4) {
    let t = currentIdx.value + 1;
    if (t >= queue.value.length) t = mode.value === 'order' ? -1 : 0;
    if (t !== -1 && t !== currentIdx.value) {
      currentIdx.value = t;
      setTimeout(() => loadCurrent(), 500);
    }
  }
}

/** 推荐歌单条目没有 songId，播放前按「歌名 + 歌手」搜索解析；
 *  听书条目带 resolve()，播到该集时才解析真实音频地址（整本书可提前入队）。
 *  解析后 resolve 保留在条目上：直链过期时（error 事件）还能再次解析续播 */
async function resolveSong(song) {
  if (song.url) return song;
  if (typeof song.resolve === 'function') {
    const r = await song.resolve();
    if (!r || !r.url) throw new Error(song.resolveError || '该集音频解析失败，已自动跳到下一集');
    return { ...song, ...r, resolve: song.resolve };
  }
  if (song.songId) return song;
  const kw = song.artist ? `${song.name} ${song.artist}` : song.name;
  const d = await searchMusic(kw, 10);
  const list = d.songs || [];
  const norm = s => String(s || '').replace(/\s+/g, '');
  const exact = list.find(s =>
    norm(s.name) === norm(song.name) && (!song.artist || String(s.artist || '').includes(song.artist))
  );
  const pick = exact || list.find(s => norm(s.name) === norm(song.name)) || list[0];
  if (!pick) throw new Error(`「${song.name}」没有找到可用音源`);
  return { ...song, songId: pick.songId, name: pick.name || song.name, artist: pick.artist || song.artist, album: pick.album || '' };
}

function parseLrc(lrc) {
  const out = [];
  for (const line of String(lrc || '').split('\n')) {
    const stamps = [...line.matchAll(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!text) continue;
    for (const m of stamps) {
      const frac = m[3] ? parseFloat('0.' + m[3]) : 0;
      out.push({ t: +m[1] * 60 + +m[2] + frac, text });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

async function loadCurrent(autoplay = true) {
  const song = queue.value[currentIdx.value];
  if (!song) return;
  const a = ensureAudio();
  const seq = ++loadSeq;
  resolveRetryUsed = false;
  error.value = '';
  buffering.value = true;
  lyricLines.value = [];
  lyricIdx.value = -1;
  currentTime.value = 0;
  duration.value = 0;
  bufferedEnd.value = 0;
  try {
    const resolved = await resolveSong(song);
    if (seq !== loadSeq) return;
    queue.value[currentIdx.value] = resolved;
    updateTitle();
    // 直链条目（听书章节）：直接播，不走歌曲解析/歌词/封面
    if (resolved.url) {
      cover.value = resolved.cover || '';
      a.src = resolved.url;
      if (autoplay) await a.play().catch(() => {});
      updateMediaSession(resolved);
      return;
    }
    const [u, l, pic] = await Promise.allSettled([
      musicUrl(resolved.songId, 320000),
      musicLyric(resolved.songId),
      musicPic(resolved.songId, 300)
    ]);
    if (seq !== loadSeq) return;
    if (u.status !== 'fulfilled' || !u.value.url) {
      throw new Error(u.status === 'rejected' ? u.reason.message : '该歌曲暂无免费音源，试试其他版本');
    }
    if (pic.status === 'fulfilled' && pic.value.url) cover.value = pic.value.url;
    else cover.value = '';
    lyricLines.value = l.status === 'fulfilled' ? parseLrc(l.value.lyric) : [];
    a.src = u.value.url;
    if (autoplay) await a.play().catch(() => { /* 浏览器拦截时等用户手动点播放 */ });
    updateMediaSession(resolved);
  } catch (e) {
    if (seq !== loadSeq) return;
    onFail(e);
  }
}

function updateTitle() {
  if (typeof document === 'undefined') return;
  const s = queue.value[currentIdx.value];
  document.title = playing.value && s ? `🎵 ${s.name} - ${s.artist}` : baseTitle;
}

function updateMediaSession(s) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: s.name, artist: s.artist, album: s.album || '',
      artwork: cover.value ? [{ src: cover.value, sizes: '300x300' }] : []
    });
    navigator.mediaSession.setActionHandler('play', () => toggle());
    navigator.mediaSession.setActionHandler('pause', () => toggle());
    navigator.mediaSession.setActionHandler('previoustrack', () => jump(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => jump(1));
  } catch { /* 浏览器不支持时忽略 */ }
}

// ---- 对外操作 ----

/** 整表播放：把列表设为队列并从 startIndex 开始 */
function playList(list, startIndex = 0) {
  if (!Array.isArray(list) || !list.length) return;
  queue.value = list.map(s => ({ ...s }));
  currentIdx.value = Math.max(0, Math.min(startIndex, queue.value.length - 1));
  consecutiveFails = 0;
  loadCurrent();
}

/** 立刻插播一首：插入当前歌后面并播放（不打断整表顺序） */
function playSong(s) {
  if (!queue.value.length) return playList([s], 0);
  queue.value.splice(currentIdx.value + 1, 0, { ...s });
  currentIdx.value += 1;
  loadCurrent();
}

/** 追加到队尾 */
function addToQueue(s) {
  if (!queue.value.length) return playList([s], 0);
  queue.value.push({ ...s });
}

function toggle() {
  const a = ensureAudio();
  if (!queue.value.length) return;
  if (!a.src) { loadCurrent(); return; }
  if (a.paused) a.play().catch(() => {});
  else a.pause();
}

/** 手动切歌（首尾环绕） */
function jump(step) {
  const n = queue.value.length;
  if (!n) return;
  if (step < 0 && currentTime.value > 3) { seek(0); return; }  // 播了 3 秒以上先回到开头
  currentIdx.value = (currentIdx.value + step + n) % n;
  loadCurrent();
}

/** 点队列里某首歌：当前歌则暂停/继续，否则跳到那首 */
function playAt(i) {
  if (i < 0 || i >= queue.value.length) return;
  if (i === currentIdx.value) { toggle(); return; }
  currentIdx.value = i;
  loadCurrent();
}

function seek(t) {
  const a = ensureAudio();
  if (isFinite(t) && t >= 0) {
    a.currentTime = t;
    currentTime.value = t;
  }
}

function setVolume(v) {
  volume.value = v;
  ensureAudio().volume = v;
  localStorage.setItem(VOL_KEY, String(v));
}

function cycleMode() {
  mode.value = { order: 'loop', loop: 'one', one: 'shuffle', shuffle: 'order' }[mode.value];
}

function removeAt(i) {
  if (i < 0 || i >= queue.value.length) return;
  const wasCurrent = i === currentIdx.value;
  queue.value.splice(i, 1);
  if (!queue.value.length) { clearQueue(); return; }
  if (i < currentIdx.value) currentIdx.value -= 1;
  else if (wasCurrent) {
    if (currentIdx.value >= queue.value.length) currentIdx.value = queue.value.length - 1;
    loadCurrent();
  }
}

function clearQueue() {
  loadSeq++;
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  queue.value = [];
  currentIdx.value = -1;
  playing.value = false;
  buffering.value = false;
  error.value = '';
  lyricLines.value = [];
  lyricIdx.value = -1;
  cover.value = '';
  currentTime.value = 0;
  duration.value = 0;
  bufferedEnd.value = 0;
  updateTitle();
}

export function useMusicPlayer() {
  return {
    // 状态
    queue, currentIdx, playing, buffering, error,
    currentTime, duration, bufferedEnd, volume, mode,
    lyricLines, lyricIdx, cover, currentSong,
    // 操作
    playList, playSong, addToQueue, toggle, jump, playAt, seek,
    setVolume, cycleMode, removeAt, clearQueue
  };
}
