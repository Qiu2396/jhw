/**
 * 本地听书：扫描本机文件夹里的音频文件，组装成「书」交给听书页入全局播放队列。
 * 播放用 blob: 对象 URL，纯浏览器本地完成，文件不经过后端、不上传任何内容。
 *
 * 三级导入方式（自动选可用的那种）：
 * - 电脑 Chrome/Edge：File System Access API，整个文件夹授权一次，目录句柄存
 *   IndexedDB，下次打开书架还在（浏览器安全要求，新会话需点一次「重新授权」）。
 * - 其他桌面/安卓浏览器：退回 <input webkitdirectory>，拿不到句柄，刷新后需重选。
 * - iOS Safari：两者都不支持，退回多选音频文件，全部归成一本书。
 */

const AUDIO_EXTS = new Set([
  'mp3', 'm4a', 'm4b', 'aac', 'wav', 'flac',
  'ogg', 'oga', 'opus', 'weba', 'webm', 'mp4', 'm4v'
]);
const MAX_FILES = 8000;      // 扫描上限：防止误选整盘时卡死
const MAX_DEPTH = 6;

export function isAudioFile(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0) return false;
  return AUDIO_EXTS.has(name.slice(i + 1).toLowerCase());
}

export function supportsDirPicker() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function supportsDirInput() {
  return typeof document !== 'undefined' &&
    'webkitdirectory' in document.createElement('input');
}

/** 章节排序：数字段按数值比（001 < 2 < 第10集），中文按拼音，稳定兜底按完整路径 */
const collator = new Intl.Collator(['zh-Hans-CN', 'en'], { numeric: true, sensitivity: 'base' });

// 中文章节数字（第三章/第二十五集）转阿拉伯数字再比，避免拼音序把「三」排到「二十」后面
const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_RUN = /[零〇一二两三四五六七八九十百千]+/g;
function cnRunsToDigits(s) {
  return s.replace(CN_RUN, m => {
    let total = 0, num = 0;
    for (const ch of m) {
      if (ch in CN_DIGIT) { num = CN_DIGIT[ch]; continue; }
      total += (num || 1) * { 十: 10, 百: 100, 千: 1000 }[ch];
      num = 0;
    }
    return String(total + num);
  });
}

const byName = (a, b) =>
  collator.compare(cnRunsToDigits(a.name), cnRunsToDigits(b.name)) ||
  collator.compare(a.path, b.path);

function stripExt(name) {
  return name.replace(/\.[^.]+$/, '');
}

/**
 * 把平铺的音频条目按所在子文件夹分组成书。
 * 条目：{path(相对根的路径), name(文件名), getFile()}; 根目录直下的文件归成一本书，以根文件夹命名。
 */
function groupBooks(files, rootName) {
  const groups = new Map();            // 相对目录路径 -> 章节[]
  for (const f of files) {
    const i = f.path.lastIndexOf('/');
    const dir = i >= 0 ? f.path.slice(0, i) : '';
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(f);
  }
  return [...groups.entries()]
    .map(([dir, chapters]) => {
      chapters.sort(byName);
      const segs = dir.split('/');
      return {
        key: `local:${dir || rootName}`,
        name: dir ? segs[segs.length - 1] : rootName,
        sub: dir,                        // 相对路径：同名文件夹也能区分
        chapters: chapters.map(c => ({ ...c, title: stripExt(c.name) }))
      };
    })
    .sort((a, b) =>
      collator.compare(cnRunsToDigits(a.sub), cnRunsToDigits(b.sub)) ||
      collator.compare(a.name, b.name));
}

/** File System Access API：递归扫目录，onProgress(已发现文件数) 用于界面反馈 */
export async function scanDirectory(rootHandle, onProgress = () => {}) {
  const files = [];
  let truncated = false;
  async function walk(dir, prefix, depth) {
    if (depth > MAX_DEPTH) return;
    for await (const entry of dir.values()) {
      if (files.length >= MAX_FILES) { truncated = true; return; }
      if (entry.name.startsWith('.')) continue;
      if (entry.kind === 'directory') {
        await walk(entry, `${prefix}${entry.name}/`, depth + 1);
      } else if (entry.kind === 'file' && isAudioFile(entry.name)) {
        const path = `${prefix}${entry.name}`;
        files.push({ path, name: entry.name, getFile: () => entry.getFile() });
        if (files.length % 50 === 0) onProgress(files.length);
      }
    }
  }
  await walk(rootHandle, '', 0);
  const books = groupBooks(files, rootHandle.name);
  if (truncated) books.truncated = true;
  return books;
}

/** <input> 文件列表兜底：有 webkitRelativePath 就按目录分组，没有（iOS 多选）归成一本书 */
export function scanFileList(fileList) {
  const files = [];
  let hasRelPath = false;
  for (const f of fileList) {
    if (f.name.startsWith('.') || !isAudioFile(f.name)) continue;
    const rel = f.webkitRelativePath || '';
    if (rel) hasRelPath = true;
    files.push({ path: rel || f.name, name: f.name, getFile: async () => f });
  }
  if (!files.length) return [];
  const rootName = hasRelPath && files[0].path.includes('/')
    ? files[0].path.split('/')[0]
    : '本地导入';
  return groupBooks(files, rootName);
}

// ---- blob: 对象 URL 缓存（File 句柄直读磁盘流式播放，不会整本进内存）----
const urlCache = new Map();

export async function chapterObjectUrl(ch) {
  let u = urlCache.get(ch.path);
  if (!u) {
    u = URL.createObjectURL(await ch.getFile());
    urlCache.set(ch.path, u);
  }
  return u;
}

// ---- 目录句柄持久化（IndexedDB，仅支持 File System Access 的浏览器会用到）----
const DB_NAME = 'fv-local-books';

function idb() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const rq = db.transaction('kv').objectStore('kv').get(key);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}
async function idbSet(key, val) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const rq = db.transaction('kv', 'readwrite').objectStore('kv').put(val, key);
    rq.onsuccess = () => resolve();
    rq.onerror = () => reject(rq.error);
  });
}
async function idbDel(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const rq = db.transaction('kv', 'readwrite').objectStore('kv').delete(key);
    rq.onsuccess = () => resolve();
    rq.onerror = () => reject(rq.error);
  });
}

export async function loadSavedRoot() {
  try { return await idbGet('root'); } catch { return undefined; }
}
export async function saveRoot(handle) {
  try { await idbSet('root', handle); } catch { /* 隐私模式等：书架退化为仅本次会话 */ }
}
export async function forgetRoot() {
  try { await idbDel('root'); } catch { /* ignore */ }
}

/** 检查目录读取权限；prompt=true 时向用户申请（必须由点击等用户手势触发） */
export async function ensurePermission(handle, { prompt = false } = {}) {
  if (!handle?.queryPermission) return false;
  const opts = { mode: 'read' };
  if (await handle.queryPermission(opts) === 'granted') return true;
  if (!prompt) return false;
  try { return await handle.requestPermission(opts) === 'granted'; }
  catch { return false; }
}
