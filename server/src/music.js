/**
 * 音乐模块：免费听歌（搜索歌名 → 免费播放）
 *
 * 数据源：GDStudio 音乐聚合 API（https://music.gdstudio.xyz）——
 * 公益服务，聚合各平台公开音源，无需 key。2026-09 实测仅 netease 音源可用。
 *
 * GET /api/music/search?name=歌名或歌手   搜索歌曲
 * GET /api/music/url?songId=xxx&br=320000 取播放直链
 * GET /api/music/lyric?songId=xxx         取歌词（LRC）
 * GET /api/music/pic?songId=xxx&size=300  取封面图
 */

import { isDisabled } from './channel-sources.js';

const API = 'https://music-api.gdstudio.xyz/api.php';
const SOURCE = 'netease';
const UA = 'JuSouMusic/0.1';
const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function gdFetch(params) {
  if (isDisabled('music', 'gdstudio')) throw new Error('音乐源已停用（站点目录可重新启用）');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(`${API}?${new URLSearchParams({ source: SOURCE, ...params })}`, {
      signal: ctl.signal,
      headers: { 'User-Agent': UA }
    });
    if (!res.ok) throw new Error(`音乐服务返回 ${res.status}`);
    const text = await res.text();
    // 正常直接 parse；容忍服务在 JSON 前夹杂字符的情况
    let json;
    try {
      json = JSON.parse(text.trim());
    } catch {
      const m = text.trim().match(/[[{][\s\S]*[\]}]/);
      if (!m) throw new Error('音乐服务响应异常');
      json = JSON.parse(m[0]);
    }
    if (json.detail) throw new Error(String(json.detail).slice(0, 80));
    return json;
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? '音乐服务超时' : (e.message || '音乐服务请求失败'));
  } finally {
    clearTimeout(timer);
  }
}

export async function searchMusic(name, count = 50) {
  const kw = String(name || '').trim();
  if (!kw) throw new Error('缺少关键词');
  const list = await gdFetch({
    types: 'search',
    name: kw,
    // 上游实测支持 count=50；pages 翻页与第一页大量重复且页内有重复歌，不采用
    count: String(Math.min(Math.max(count, 1), 50)),
    pages: '1'
  });
  if (!Array.isArray(list)) throw new Error('音乐服务响应异常');
  return list.map(s => ({
    songId: String(s.id),
    name: (s.name || '').trim(),
    artist: Array.isArray(s.artist) ? s.artist.join(' / ') : String(s.artist || ''),
    album: (s.album || '').trim()
  }));
}

export async function musicUrl(songId, br = 320000) {
  const r = await gdFetch({ types: 'url', id: String(songId), br: String(br) });
  if (!r.url) throw new Error('该歌曲暂无免费音源，试试其他版本');
  return { url: r.url, br: r.br || 0, size: r.size || 0 };
}

export async function musicLyric(songId) {
  const r = await gdFetch({ types: 'lyric', id: String(songId) });
  return { lyric: r.lyric || '', tlyric: r.tlyric || '' };
}

/** 专辑封面：songId 即网易云歌曲 id，直接问网易云官方接口拿真实专辑图
 *  （GDStudio 的 pic 走旧版 songId.jpg 直拼格式，2026-09 实测已 404，导致唱片只剩兜底图案） */
async function neteaseAlbumPic(songId, size) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(
      `https://music.163.com/api/song/detail?id=${encodeURIComponent(songId)}&ids=${encodeURIComponent(`[${songId}]`)}`,
      { signal: ctl.signal, headers: { 'User-Agent': UA_BROWSER, Referer: 'https://music.163.com/' } }
    );
    if (!res.ok) throw new Error(`网易云返回 ${res.status}`);
    const d = await res.json();
    const pic = d?.songs?.[0]?.album?.picUrl;
    if (!pic) throw new Error('无专辑图');
    return `${pic}?param=${size}y${size}`;
  } finally {
    clearTimeout(timer);
  }
}

export async function musicPic(songId, size = 300) {
  size = Math.min(Math.max(parseInt(size) || 300, 100), 1500);
  try { return { url: await neteaseAlbumPic(songId, size) }; }
  catch { /* 网易云接口不可用 → 退回聚合服务 */ }
  try {
    const r = await gdFetch({ types: 'pic', id: String(songId), size: String(size) });
    return { url: r.url || '' };
  } catch { return { url: '' }; }
}

/** 单源探测（站点目录「检测」用） */
export async function checkMusicSource() {
  const list = await searchMusic('成都', 1);
  return { ok: list.length > 0, info: list.length ? `命中 · ${list[0].name}` : '无结果' };
}
