/**
 * 内置视频源定义（种子数据）
 *
 * 这些源在数据库（server/data/app.db）首次初始化时灌入 sources 表；
 * 之后源的增删改请在页面「站点目录」操作，或直接操作数据库。
 *
 * 目前收录的是「苹果CMS(macCMS)」体系的公开资源站，它们提供统一的 JSON 搜索接口：
 *   搜索: {api}?ac=videolist&wd=关键词
 *   详情: {api}?ac=detail&ids=影片ID   （返回含 vod_play_url 播放地址）
 *
 * 字段说明：
 *   id       唯一短标识（用于 URL 参数）
 *   name     展示名称
 *   api      maccms JSON 接口地址
 *   web      资源站前台地址（可选，展示用）
 *   tags     分类标签（展示用）
 *   enabled  是否默认启用
 */
export const SEED_SOURCES = [
  {
    id: 'bf',
    name: '暴风资源',
    api: 'https://bfzyapi.com/api.php/provide/vod',
    web: 'https://bfzyapi.com',
    tags: ['动漫', '剧集', '电影'],
    enabled: true
  },
  {
    id: 'js',
    name: '极速资源',
    api: 'https://jszyapi.com/api.php/provide/vod',
    web: 'https://jszyapi.com',
    tags: ['动漫', '剧集', '电影', '综艺'],
    enabled: true
  },
  {
    id: 'lzi',
    name: '量子资源',
    api: 'https://cj.lziapi.com/api.php/provide/vod',
    web: 'https://cj.lziapi.com',
    tags: ['动漫', '剧集', '电影'],
    enabled: true
  },
  {
    id: 'zy360',
    name: '360资源',
    api: 'https://360zy.com/api.php/provide/vod',
    web: 'https://360zy.com',
    tags: ['动漫', '剧集', '电影', '综艺'],
    enabled: true
  },
  {
    id: 'ty',
    name: '天涯资源',
    api: 'https://tyyszy.com/api.php/provide/vod',
    web: 'https://tyyszy.com',
    tags: ['剧集', '电影'],
    enabled: false,
    note: '2026-09 检测接口异常，默认停用'
  },
  {
    id: 'zuida',
    name: '最大资源',
    api: 'https://api.zuidapi.com/api.php/provide/vod',
    web: '',
    tags: ['电影', '剧集'],
    enabled: true
  },
  {
    id: 'yh',
    name: '樱花资源',
    api: 'https://yhzy.cc/api.php/provide/vod',
    web: '',
    tags: ['动漫'],
    enabled: true
  },
  {
    id: 'haohua',
    name: '豪华资源',
    api: 'https://hhzyapi.com/api.php/provide/vod',
    web: '',
    tags: ['电影', '剧集'],
    enabled: true
  }
];

/** 推荐导航的「站点目录」：非 API 源，收录有前台的免费/正版视频网站，供导航页展示 */
export const NAV_SITES = [
  {
    name: '哔哩哔哩（B站）',
    url: 'https://www.bilibili.com',
    desc: '大量正版国创/番剧免费观看，《凡人修仙传》年番正版就在 B 站播出',
    category: '正版免费',
    official: true
  },
  {
    name: '腾讯视频',
    url: 'https://v.qq.com',
    desc: '正版影视，每日免费专区 + 部分剧集限免',
    category: '正版免费',
    official: true
  },
  {
    name: '爱奇艺',
    url: 'https://www.iqiyi.com',
    desc: '正版影视，免费专区内容丰富',
    category: '正版免费',
    official: true
  },
  {
    name: '优酷',
    url: 'https://www.youku.com',
    desc: '正版影视，含免费剧场',
    category: '正版免费',
    official: true
  },
  {
    name: '芒果TV',
    url: 'https://www.mgtv.com',
    desc: '正版影视综艺，部分内容免费',
    category: '正版免费',
    official: true
  },
  {
    name: '央视频',
    url: 'https://yangshipin.cn',
    desc: '央视官方，纪录片/电视剧/春晚等全程免费',
    category: '正版免费',
    official: true
  }
];

export const HOT_KEYWORDS = [
  '凡人修仙传', '斗破苍穹', '完美世界', '遮天', '仙逆',
  '庆余年', '狂飙', '三体', '哪吒', '流浪地球'
];
