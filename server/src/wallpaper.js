/**
 * 壁纸模块：聚合第三方壁纸站，支持搜索、每日精选、原图多分辨率解析
 *
 * 与漫画/听书模块同一思路：第三方站的 HTML 后端代理解析（源规则内聚在
 * 本文件每个源的 parse 函数里），前端拿结构化数据直接渲染。图片本身无
 * 防盗链（实测带任意 Referer 均可加载），客户端直连源站，不经服务器转发；
 * 仅「下载」走 /api/wallpaper/img 代理以落盘为附件（host 白名单防 SSRF）。
 *
 * GET /api/wallpaper/search?kw=&page=   多源聚合搜索（返回缩略图/预览/详情页地址）
 * GET /api/wallpaper/daily              必应每日精选（无需关键词）
 * GET /api/wallpaper/detail?src=&url=   详情页解析：大图预览 + 多分辨率下载列表
 * GET /api/wallpaper/img?u=&dl=1        图片代理下载（host 白名单）
 *
 * 安全：url 参数的 host 必须与已收录源一致（防 SSRF）。
 */
import { isDisabled } from './channel-sources.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT_MS = 12000;
const DETAIL_TTL = 30 * 60 * 1000;    // 详情解析缓存（原图地址稳定）
const SEARCH_TTL = 5 * 60 * 1000;     // 搜索/分类页缓存（减少重复抓源站）
const detailCache = new Map();        // 详情页url → { at, data }
const searchCache = new Map();        // 搜索结果缓存 key → { at, data }

async function fetchText(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' }
    });
    if (!res.ok) throw new Error(`源站返回 ${res.status}`);
    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function cached(map, url, ttl, loader) {
  const hit = map.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const data = await loader();
  map.set(url, { at: Date.now(), data });
  if (map.size > 200) {                 // 简单容量控制
    const first = map.keys().next().value;
    map.delete(first);
  }
  return data;
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .trim();
}

/* ---- 中文关键词 → 英文映射：4K Wallpapers / WallpaperCave 只认英文，
      中文直接搜恒为 0 结果（「基本搜不到」的主因）；必应图片源不受此限 ---- */
const ZH_EN = {
  '风景': 'landscape', '山水': 'landscape', '自然': 'nature', '风光': 'scenery',
  '山': 'mountain', '雪山': 'snow mountain', '瀑布': 'waterfall', '湖': 'lake', '湖泊': 'lake',
  '河': 'river', '河流': 'river', '海': 'sea', '大海': 'sea', '海洋': 'ocean', '海滩': 'beach',
  '森林': 'forest', '树林': 'forest', '树': 'tree', '花': 'flowers', '花卉': 'flower',
  '樱花': 'cherry blossom', '玫瑰': 'rose', '薰衣草': 'lavender', '麦田': 'wheat field',
  '草原': 'grassland', '沙漠': 'desert', '峡谷': 'canyon', '火山': 'volcano', '冰川': 'glacier',
  '天空': 'sky', '云': 'clouds', '星空': 'night sky', '银河': 'milky way', '星云': 'nebula',
  '宇宙': 'space', '太空': 'space', '行星': 'planet', '地球': 'earth', '月亮': 'moon', '月球': 'moon',
  '太阳': 'sun', '日落': 'sunset', '夕阳': 'sunset', '日出': 'sunrise', '极光': 'aurora',
  '闪电': 'lightning', '下雨': 'rain', '雨': 'rain', '雾': 'fog', '彩虹': 'rainbow',
  '春天': 'spring', '夏天': 'summer', '秋天': 'autumn', '冬天': 'winter', '雪': 'snow',
  '城市': 'city', '夜景': 'city night', '街道': 'street', '建筑': 'architecture', '桥': 'bridge',
  '公路': 'road', '灯塔': 'lighthouse', '村庄': 'village', '城堡': 'castle', '庙': 'temple',
  '汽车': 'car', '跑车': 'sports car', '赛车': 'racing car', '摩托车': 'motorcycle', '自行车': 'bicycle',
  '火车': 'train', '高铁': 'train', '飞机': 'airplane', '直升机': 'helicopter', '船': 'ship',
  '帆船': 'sailboat', '宇宙飞船': 'spacecraft', '火箭': 'rocket',
  '动漫': 'anime', '动画': 'anime', '二次元': 'anime', '漫画': 'anime', '动漫美女': 'anime girl',
  '游戏': 'game', '电玩': 'game', '机甲': 'mecha', '武士': 'samurai', '忍者': 'ninja',
  '动物': 'animals', '猫': 'cat', '猫咪': 'cat', '狗': 'dog', '小狗': 'dog', '熊猫': 'panda',
  '老虎': 'tiger', '狮子': 'lion', '狼': 'wolf', '马': 'horse', '鹿': 'deer', '鸟': 'bird',
  '鹰': 'eagle', '蝴蝶': 'butterfly', '鲸': 'whale', '鲸鱼': 'whale', '海豚': 'dolphin', '鱼': 'fish',
  '龙': 'dragon', '凤凰': 'phoenix', '独角兽': 'unicorn', '蘑菇': 'mushroom',
  '抽象': 'abstract', '纹理': 'texture', '极简': 'minimalist', '简约': 'minimalist',
  '黑白': 'black and white', '复古': 'vintage', '赛博朋克': 'cyberpunk', '霓虹': 'neon',
  '水墨': 'ink painting', '油画': 'oil painting', '古风': 'ancient chinese',
  '美食': 'food', '食物': 'food', '咖啡': 'coffee', '甜点': 'dessert', '水果': 'fruit',
  '音乐': 'music', '吉他': 'guitar', '钢琴': 'piano', '电影': 'movie', '明星': 'celebrity',
  '美女': 'girl', '帅哥': 'man', '运动': 'sports', '篮球': 'basketball', '足球': 'football',
  '超级英雄': 'superheroes', '圣诞': 'christmas', '圣诞节': 'christmas', '新年': 'new year',
  '春节': 'chinese new year', '情人节': 'valentines day', '万圣节': 'halloween', '中秋': 'mid autumn festival',
  '高清': '', '壁纸': '', '4k': '', '图片': ''
};

function toEn(kw) {
  const w = String(kw || '').trim();
  return Object.prototype.hasOwnProperty.call(ZH_EN, w) ? ZH_EN[w] : w;
}

/* ---------------- 源：必应图片（必应图库聚合，原生支持中文关键词） ----------------
 * 解析 /images/search 结果卡片里的 m="…" 属性（HTML 转义的 JSON）：
 *   murl=原图直链（第三方host，防盗链各异） turl=必应缩略图CDN t=标题 purl=来源网页
 * 缩略图 host 是 ts*.mm.bing.net（部分地区连不上），改写成等价的 tse*.mm.bing.net；
 * 追加 w/h/c 参数可拿到任意尺寸的必应缩放版，预览与大图下载都不依赖源站防盗链。 */
const bingimg = {
  id: 'bingimg',
  name: '必应图片',
  base: 'https://cn.bing.com',

  async search(kw, page = 1) {
    if (isDisabled('wallpaper', this.id)) return [];
    const first = (page - 1) * 35 + 1;
    const url = `${this.base}/images/search?q=${encodeURIComponent(kw)}&first=${first}&count=35`;
    const html = await fetchText(url);
    const out = [];
    for (const m of html.matchAll(/ m="([^"]+)"/g)) {
      let meta;
      try { meta = JSON.parse(decodeEntities(m[1])); } catch { continue; }
      if (!meta.murl || !meta.turl) continue;
      // ts4.mm.bing.net 部分地区连不上 → 换成等价的 tse4（已是 tse*/th. 的不动）
      const thumb = /\/\/ts\d+\.mm\.bing\.net/.test(meta.turl) ? meta.turl.replace('//ts', '//tse') : meta.turl;
      const id = meta.md5 || meta.mid || meta.murl;
      if (out.some(x => x.id.endsWith(id))) continue;
      out.push({
        id: `${this.id}-${id}`,
        sourceId: this.id,
        sourceName: this.name,
        title: decodeEntities(meta.t || '必应图片'),
        thumb: `${thumb}&w=480&h=300&c=7`,
        preview: `${thumb}&w=1600&h=900&c=7`,
        detailUrl: meta.purl || meta.murl,
        badge: '',
        downloads: [
          { url: `${thumb}&w=1920&h=1080&c=7`, label: '必应大图', note: '1920 宽（超原图不放大）' },
          { url: meta.murl, label: '原图直链', note: '源站打开，防盗链站点请复制链接', direct: true }
        ]
      });
      if (out.length >= 35) break;
    }
    return out;
  }
};

/* ---------------- 源：4K Wallpapers（分类全、标签规整、多分辨率下载） ---------------- */

const w4k = {
  id: 'w4k',
  name: '4K Wallpapers',
  base: 'https://4kwallpapers.com',

  async search(kw, page = 1, cat = '') {
    if (isDisabled('wallpaper', this.id)) return [];
    kw = toEn(kw);
    // 分类直连（如 /nature/）比搜索更准；分类页与搜索页是同一套卡片结构
    const url = cat
      ? (page > 1 ? `${this.base}/${cat}/page/${page}/` : `${this.base}/${cat}/`)
      : (page > 1 ? `${this.base}/search/?q=${encodeURIComponent(kw)}&page=${page}` : `${this.base}/search/?q=${encodeURIComponent(kw)}`);
    const html = await fetchText(url);
    const out = [];
    // 卡片结构：<p class="wallpapers__item"> … <img itemprop="thumbnail" src="…/thumbs/ID.ext" …>
    //   <link itemprop="contentUrl" href="…/thumbs_2t/ID.ext"> … <a title="…" href="…/{cat}/{slug}-{ID}.html">
    const re = /<p[^>]+class="wallpapers__item"[\s\S]*?<\/p>/g;
    for (const block of html.match(re) || []) {
      const link = block.match(/<a[^>]+class="wallpapers__canvas_image"[^>]+href="([^"]+)"/) ||
                   block.match(/<a[^>]+href="(https:\/\/4kwallpapers\.com\/[a-z-]+\/[^"]+\.html)"/);
      const img = block.match(/<img[^>]+itemprop="thumbnail"[^>]+src="([^"]+)"/);
      if (!link || !img) continue;
      const detailUrl = link[1].startsWith('http') ? link[1] : `${this.base}${link[1]}`;
      const id = (detailUrl.match(/-(\d+)\.html/) || [])[1];
      if (!id) continue;
      const thumb = img[1].startsWith('http') ? img[1] : `${this.base}${img[1]}`;
      const preview = thumb.replace('/walls/thumbs/', '/walls/thumbs_3t/');
      const alt = decodeEntities((block.match(/alt="([^"]*)"/) || [])[1]);
      const title = alt.split(',')[0] || `壁纸 ${id}`;
      const res = (alt.match(/(\d+K)/i) || [])[1] || '';
      out.push({
        id: `${this.id}-${id}`,
        sourceId: this.id,
        sourceName: this.name,
        title,
        thumb,
        preview,
        detailUrl,
        badge: res
      });
    }
    return out;
  },

  /** 详情页：大图 + 全部分辨率下载（含 4K/原图/手机竖屏） */
  async detail(pageUrl) {
    return cached(detailCache, pageUrl, DETAIL_TTL, async () => {
      const html = await fetchText(pageUrl);
      const rawPreview = (html.match(/itemprop="contentUrl"[^>]*src="([^"]+)"/) ||
                          html.match(/itemprop="contentUrl"[^>]*srcset="([^"\s]+)"/) || [])[1] || '';
      // 详情页大图取 1280w 档（thumbs_3t）；页面默认输出 800w（thumbs_2t）
      const preview = rawPreview.replace('/walls/thumbs_2t/', '/walls/thumbs_3t/').replace('/walls/thumbs/', '/walls/thumbs_3t/');
      // 下载锚点：<a title="Download …" href="/images/wallpapers/slug-WxH-ID.ext" …>WxH <span…>(说明)…</span></a>
      const downloads = [];
      const seen = new Set();
      const re = /<a[^>]+href="(\/images\/wallpapers\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      for (const m of html.matchAll(re)) {
        const href = m[1];
        if (seen.has(href)) continue;
        seen.add(href);
        const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
        const wh = href.match(/-(\d{3,5}x\d{3,5})-/);
        const note = (text.match(/\(([^)]+)\)/) || [])[1] || '';
        downloads.push({
          url: `${this.base}${href}`,
          label: wh ? wh[1] : (text.match(/\d{3,5}x\d{3,5}/) || [text.slice(0, 40)])[0],
          note: note === (wh || [])[1] ? '' : note    // 主链接括号里是分辨率本身，与 label 重复时去掉
        });
      }
      // 按面积从大到小（原图最大排最前）
      downloads.sort((a, b) => {
        const pa = (a.label.match(/(\d+)x(\d+)/) || [0, 0, 0]).slice(1).map(Number);
        const pb = (b.label.match(/(\d+)x(\d+)/) || [0, 0, 0]).slice(1).map(Number);
        return pb[0] * pb[1] - pa[0] * pa[1];
      });
      const author = decodeEntities((html.match(/class="author-link">([^<]+)</) || [])[1]);
      const tags = [...html.matchAll(/<p class="tags">[\s\S]*?<\/p>/g)]
        .flatMap(p => [...p[0].matchAll(/title="[^"]*Wallpapers">([^<]+)</g)].map(t => decodeEntities(t[1])))
        .slice(0, 10);
      if (!preview && !downloads.length) throw new Error('详情解析失败，该源暂不可用');
      return { preview, downloads, author, tags, pageUrl };
    });
  }
};

/* ---------------- 源：WallpaperCave（社区图库量大，原图单分辨率） ---------------- */

const wpc = {
  id: 'wpc',
  name: 'WallpaperCave',
  base: 'https://wallpapercave.com',

  async search(kw, page = 1) {
    if (isDisabled('wallpaper', this.id)) return [];
    kw = toEn(kw);
    const url = page > 1
      ? `${this.base}/search?q=${encodeURIComponent(kw)}&page=${page}`
      : `${this.base}/search?q=${encodeURIComponent(kw)}`;
    const html = await fetchText(url);
    const out = [];
    // 单图卡片：<a href="/w/uwpID" title="标题"><img src="/fuwp-255/uwpID.ext" srcset="…510…2x" alt="标题"></a>
    const re = /<a href="(\/w\/(uwp\d+))" title="([^"]*)">\s*<img src="([^"\s]+)"/g;
    for (const m of html.matchAll(re)) {
      const title = decodeEntities(m[3]);
      out.push({
        id: `${this.id}-${m[2]}`,
        sourceId: this.id,
        sourceName: this.name,
        title,
        thumb: `${this.base}${m[4]}`,
        // 510 宽为 2x 缩略图；预览直接用原图（detail 里 og:image），网格用 255
        preview: '',
        detailUrl: `${this.base}${m[1]}`,
        badge: ''
      });
    }
    return out;
  },

  /** 详情页：og:image 即原图（单分辨率） */
  async detail(pageUrl) {
    return cached(detailCache, pageUrl, DETAIL_TTL, async () => {
      const html = await fetchText(pageUrl);
      const full = (html.match(/og:image" content="([^"]+)"/) || [])[1];
      if (!full) throw new Error('原图地址解析失败，该源暂不可用');
      const title = decodeEntities((html.match(/og:title" content="([^"]+)"/) || [])[1]);
      return {
        preview: full,
        downloads: [{ url: full, label: '原图', note: title }],
        author: '',
        tags: [],
        pageUrl
      };
    });
  }
};

const SOURCES = { w4k, wpc, bingimg };

function getSource(id) { return SOURCES[id]; }

/* ---------------- Picsum 摄影图集（无搜索语义，作为图集浏览；下载直链 302 到 fastly CDN） ---------------- */

function picsumSlice(page, perPage = 12) {
  // /v2/list 单页上限 100、总量约千张；按页取
  const url = `https://picsum.photos/v2/list?page=${page}&limit=${perPage}`;
  return fetch(url, { headers: { 'User-Agent': UA } })
    .then(r => { if (!r.ok) throw new Error(`Picsum 返回 ${r.status}`); return r.json(); })
    .then(list => (Array.isArray(list) ? list : []).map(p => ({
      id: `picsum-${p.id}`,
      sourceId: 'picsum',
      sourceName: 'Picsum 摄影',
      title: `${p.author} · ${p.width}x${p.height}`,
      thumb: `https://picsum.photos/id/${p.id}/400/240`,
      preview: `https://picsum.photos/id/${p.id}/1280/720`,
      detailUrl: p.url || `https://picsum.photos/id/${p.id}/info`,
      badge: '摄影',
      downloads: [{ url: `https://picsum.photos/id/${p.id}/1920/1080`, label: '1920x1080', note: p.author }]
    })))
    .catch(() => []);          // 图集失败不影响主流程
}

/* ---------------- 对外 API ---------------- */

/** 多源聚合搜索 / 分类浏览；单源失败不影响整体（failed 里带源名） */
export async function wallpaperSearch(kw, page = 1, cat = '') {
  const word = String(kw || '').trim();
  cat = String(cat || '').trim().replace(/[^a-z-]/g, '');
  if (!word && !cat) throw new Error('缺少关键词 kw 或分类 cat');
  if (word.length > 40) throw new Error('关键词过长');
  page = Math.min(Math.max(parseInt(page) || 1, 1), 30);
  const cacheKey = `${word}|${page}|${cat}`;
  return cached(searchCache, cacheKey, SEARCH_TTL, async () => {
    const list = Object.values(SOURCES).filter(s => !isDisabled('wallpaper', s.id));
    if (!list.length) throw new Error('暂无可用壁纸源');
    const settled = await Promise.allSettled(list.map(s => s.search(word, page, cat)));
    const wallpapers = [];
    const failed = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') wallpapers.push(...r.value);
      else failed.push(list[i].name);
    });
    return { kw: word, cat, page, wallpapers, failed };
  });
}

/** 图集：必应每日/往期（每页 8 张，idx 往回翻）+ Picsum 摄影图（每页 12 张） */
export async function wallpaperDaily(page = 1) {
  page = Math.min(Math.max(parseInt(page) || 1, 1), 4);   // 必应往期约保留 2~4 周
  const cacheKey = `daily|${page}`;
  return cached(searchCache, cacheKey, SEARCH_TTL, async () => {
    const idx = (page - 1) * 8;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const [bingRes, picsumRes] = await Promise.allSettled([
      fetch(`https://cn.bing.com/HPImageArchive.aspx?format=js&idx=${idx}&n=8`, {
        signal: ctl.signal, headers: { 'User-Agent': UA }
      }).then(r => { if (!r.ok) throw new Error(`必应返回 ${r.status}`); return r.json(); }),
      picsumSlice(page)
    ]);
    clearTimeout(timer);
    const wallpapers = [];
    if (bingRes.status === 'fulfilled') {
      for (const img of bingRes.value.images || []) {
        const full = `https://cn.bing.com${img.url}`;
        const uhd = full.replace(/_\d+x\d+(\.\w+)/, '_UHD$1');
        const title = decodeEntities((img.copyright || '').replace(/\s*\(©[^)]*\)\s*$/, '')) || '必应每日壁纸';
        wallpapers.push({
          id: `bing-${img.startdate}`,
          sourceId: 'bing',
          sourceName: '必应每日',
          title,
          thumb: full,
          preview: uhd,
          detailUrl: img.copyrightlink || 'https://cn.bing.com/',
          badge: '每日',
          downloads: [{ url: uhd, label: '3840x2160', note: '4K UHD' }, { url: full, label: '1920x1080', note: '全高清' }]
        });
      }
    }
    if (picsumRes.status === 'fulfilled') wallpapers.push(...picsumRes.value);
    return { wallpapers, page, hasMore: page < 4 };
  });
}

/** 详情解析（点击预览时调用，多分辨率下载列表） */
export async function wallpaperDetail(sourceId, pageUrl) {
  if (sourceId === 'bing' || sourceId === 'picsum' || sourceId === 'bingimg') {
    // 这三类源不需要二次解析：下载列表在列表接口里已给出，这里按 URL 现场构造
    if (sourceId === 'picsum') {
      const imgId = pageUrl.match(/picsum\.photos\/id\/(\d+)/)?.[1];
      const base = imgId ? `https://picsum.photos/id/${imgId}` : '';
      return {
        preview: base ? `${base}/1280/720` : '',
        downloads: base ? [
          { url: `${base}/1920/1080`, label: '1920x1080', note: '全高清' },
          { url: `${base}/2560/1440`, label: '2560x1440', note: '2K' }
        ] : [],
        author: '', tags: [], pageUrl
      };
    }
    // 必应：从图集缓存里找对应条目
    for (let p = 1; p <= 4; p++) {
      const d = await wallpaperDaily(p).catch(() => null);
      const hit = d?.wallpapers.find(w => w.detailUrl === pageUrl);
      if (hit) return { preview: hit.preview, downloads: hit.downloads, author: '', tags: [], pageUrl };
    }
    return { preview: '', downloads: [], author: '', tags: [], pageUrl };
  }
  const src = getSource(sourceId);
  if (!src) throw new Error('未知壁纸源');
  if (isDisabled('wallpaper', sourceId)) throw new Error('该源已停用（站点目录可重新启用）');
  if (!isAllowedWallpaperUrl(pageUrl)) throw new Error('url 不在收录源范围内');
  return src.detail(pageUrl);
}

/** 图片代理下载（dl=1 时带附件头；host 白名单防 SSRF） */
export function isAllowedWallpaperUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const allow = ['4kwallpapers.com', 'www.4kwallpapers.com', 'wallpapercave.com', 'cn.bing.com', 'www.bing.com', 'picsum.photos', 'fastly.picsum.photos', 'th.bing.com'];
    if (allow.includes(u.hostname)) return true;
    return u.hostname.endsWith('.mm.bing.net');   // 必应缩略图 CDN（tse1~4.mm.bing.net）
  } catch {
    return false;
  }
}

/** 单源探测（站点目录「检测」用） */
export async function checkWallpaperSource(id) {
  if (id === 'picsum') {
    const list = await picsumSlice(1, 5);
    return { ok: list.length > 0, info: list.length ? `命中 ${list.length} 张` : '无结果' };
  }
  const src = getSource(id);
  if (!src) return { ok: false, info: '未知源' };
  try {
    const list = await src.search('风景');
    return { ok: list.length > 0, info: list.length ? `命中 ${list.length} 张` : '无结果' };
  } catch (e) {
    return { ok: false, info: e?.name === 'AbortError' ? '超时' : (e.message || '请求失败') };
  }
}
