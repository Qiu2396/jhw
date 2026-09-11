/**
 * 内置频道源注册与启停
 *
 * 音乐/小说/听书/漫画的源是各模块内置的（每站一套解析规则，无法像视频 macCMS
 * 那样通用新增），这里把它们统一登记、暴露给站点目录展示，并支持超级管理员
 * 停用/启用（存 settings 表，键 chsrc_disabled，值为 ["kind:id", ...]）。
 */
import { getSetting, setSetting } from './db.js';

const KEY = 'chsrc_disabled';

/** 各频道的内置源清单（kind 与 /api 频道前缀、历史记录 kind 一致） */
export const CHANNEL_SOURCES = [
  { kind: 'music', kindName: '音乐', id: 'gdstudio', name: 'GDStudio 音乐聚合', desc: '聚合各平台公开音源（2026-09 实测 netease 音源可用）' },
  { kind: 'novel', kindName: '小说', id: 'niaoshu', name: '鸟书网', desc: '书库 15w+，搜索有限流' },
  { kind: 'novel', kindName: '小说', id: 'youjiu', name: '悠久小说网', desc: '下载速度快' },
  { kind: 'novel', kindName: '小说', id: 'yueduku', name: '阅读库', desc: '杰奇模板站' },
  { kind: 'novel', kindName: '小说', id: 'dingdian', name: '顶点小说', desc: '杰奇模板站' },
  { kind: 'audiobook', kindName: '听书', id: 'yuetingba', name: '悦听吧', desc: '真人演播有声小说（加密音频接口已逆向）' },
  { kind: 'comic', kindName: '漫画', id: 'wmanhua', name: 'W漫画', desc: '主流国漫书库，图片无防盗链' },
  { kind: 'wallpaper', kindName: '壁纸', id: 'w4k', name: '4K Wallpapers', desc: '分类全、标签规整，支持 4K/2K/手机多分辨率下载' },
  { kind: 'wallpaper', kindName: '壁纸', id: 'wpc', name: 'WallpaperCave', desc: '社区图库量大，原图单分辨率' },
  { kind: 'wallpaper', kindName: '壁纸', id: 'bing', name: '必应每日精选', desc: '每日首页壁纸，含 4K UHD，支持往期翻页' },
  { kind: 'wallpaper', kindName: '壁纸', id: 'picsum', name: 'Picsum 摄影', desc: '精选摄影图集，无搜索、按图集浏览' }
];

function keyOf(kind, id) {
  return `${kind}:${id}`;
}

export function disabledSet() {
  try {
    const arr = JSON.parse(getSetting(KEY) || '[]');
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function isDisabled(kind, id) {
  return disabledSet().has(keyOf(kind, id));
}

export function setDisabled(kind, id, disabled) {
  const s = disabledSet();
  const k = keyOf(kind, id);
  if (disabled) s.add(k);
  else s.delete(k);
  setSetting(KEY, JSON.stringify([...s]));
}

/** 过滤掉已停用的源（各模块搜索前调用） */
export function filterEnabled(kind, list) {
  const d = disabledSet();
  return list.filter(s => !d.has(keyOf(kind, s.id)));
}

/** 全量清单 + 启停状态（站点目录展示用） */
export function listChannelSources() {
  const d = disabledSet();
  return CHANNEL_SOURCES.map(s => ({ ...s, key: keyOf(s.kind, s.id), disabled: d.has(keyOf(s.kind, s.id)) }));
}
