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

export async function searchMusic(name, count = 30) {
  const kw = String(name || '').trim();
  if (!kw) throw new Error('缺少关键词');
  const list = await gdFetch({
    types: 'search',
    name: kw,
    count: String(Math.min(Math.max(count, 1), 30)),
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

export async function musicPic(songId, size = 300) {
  const r = await gdFetch({ types: 'pic', id: String(songId), size: String(size) });
  return { url: r.url || '' };
}

/** 单源探测（站点目录「检测」用） */
export async function checkMusicSource() {
  const list = await searchMusic('成都', 1);
  return { ok: list.length > 0, info: list.length ? `命中 · ${list[0].name}` : '无结果' };
}
