<script setup>
/**
 * 音乐频道：只负责「选歌」——推荐歌单 + 搜索 + 最近听过。
 * 播放本身在全局 musicStore + MiniPlayer（底部常驻条）里，
 * 所以切到小说页边看边听也不会断。
 */
import { ref, computed, onMounted } from 'vue';
import { searchMusic } from '../api.js';
import { useMusicPlayer } from '../musicStore.js';
import { peekList, loadKind, removeEntry, clearKind, takePendingResume } from '../historyStore.js';
import AppIcon from './AppIcon.vue';

// 解构出来用：普通对象里嵌套的 ref 在模板中不会自动解包
const { playList, playSong, addToQueue, currentSong, setMode, mode } = useMusicPlayer();

// ---- 最近听过（登录同步云端，游客存本机） ----
const musicHistory = peekList('music');

function playFromHistory(e) {
  const p = e.payload || {};
  playSong({ name: p.name || e.title, artist: p.artist || '', album: p.album || '', songId: p.songId || undefined, cover: e.cover || '' });
}

const kw = ref('');
const loading = ref(false);
const error = ref('');
const songs = ref([]);

/* ---- 今天随机听点什么：以日期为种子，同一天固定、隔天自动换 ---- */
const rerollPick = ref(null);
const rerolled = ref(0);
const shownPick = computed(() => rerolled.value ? rerollPick.value : PLAYLISTS[daySeed() % PLAYLISTS.length]);
function daySeed() {
  const d = new Date();
  let h = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  h = (h * 9301 + 49297) % 233280;
  return h;
}
function playDaily(reroll = false) {
  const pl = reroll ? PLAYLISTS[Math.floor(Math.random() * PLAYLISTS.length)] : shownPick.value;
  if (reroll) { rerollPick.value = pl; rerolled.value++; }
  setMode('shuffle');
  const start = Math.floor(Math.random() * pl.songs.length);
  playList(pl.songs, start);
}

// 推荐歌单：只需歌名 + 歌手，播放时在线解析音源（见 musicStore.resolveSong）
const PLAYLISTS = [
  {
    id: 'reading', icon: 'book-open', title: '看书伴读 · 轻音乐', desc: '琴声很轻，刚好盖过翻书声',
    songs: [
      { name: '夜的钢琴曲五', artist: '石进' },
      { name: 'River Flows in You', artist: 'Yiruma' },
      { name: '天空之城', artist: '久石让' },
      { name: 'D 大调卡农', artist: '帕赫贝尔' },
      { name: '雪之梦', artist: '班得瑞' },
      { name: '安妮的仙境', artist: '班得瑞' },
      { name: 'Summer', artist: '久石让' },
      { name: '月光边境', artist: '林海' }
    ]
  },
  {
    id: 'daze', icon: 'leaf', title: '发呆放空 · 纯音乐', desc: '什么都不做，也很好',
    songs: [
      { name: 'Kiss the Rain', artist: 'Yiruma' },
      { name: '风居住的街道', artist: '矶村由纪子' },
      { name: '故乡的原风景', artist: '宗次郎' },
      { name: 'Childhood Memory', artist: '班得瑞' },
      { name: '春野', artist: '班得瑞' },
      { name: '水边的阿狄丽娜', artist: '理查德·克莱德曼' },
      { name: '梦中的婚礼', artist: '理查德·克莱德曼' },
      { name: '晨光', artist: '班得瑞' }
    ]
  },
  {
    id: 'goodnight', icon: 'moon', title: '晚安 · 深夜治愈', desc: '今天辛苦了，听完就睡',
    songs: [
      { name: '成都', artist: '赵雷' },
      { name: '贝加尔湖畔', artist: '李健' },
      { name: '南山南', artist: '马頔' },
      { name: '米店', artist: '张玮玮' },
      { name: '斑马，斑马', artist: '宋冬野' },
      { name: '消愁', artist: '毛不易' },
      { name: '后来', artist: '刘若英' },
      { name: '那些花儿', artist: '朴树' },
      { name: '一直很安静', artist: '阿桑' },
      { name: '岁月神偷', artist: '金玟岐' }
    ]
  },
  {
    id: 'rainy', icon: 'coffee', title: '雨天 · 咖啡馆', desc: '窗外有雨，杯里有热气',
    songs: [
      { name: '遇见', artist: '孙燕姿' },
      { name: '小情歌', artist: '苏打绿' },
      { name: '旅行的意义', artist: '陈绮贞' },
      { name: '温柔', artist: '五月天' },
      { name: '知足', artist: '五月天' },
      { name: '一个像夏天一个像秋天', artist: '范玮琪' },
      { name: '你被写在我的歌里', artist: '苏打绿' },
      { name: '鱼', artist: '陈绮贞' }
    ]
  },
  {
    id: 'classic', icon: 'flame', title: '经典华语金曲', desc: '老歌一响，就回到那年夏天',
    songs: [
      { name: '海阔天空', artist: 'Beyond' },
      { name: '光辉岁月', artist: 'Beyond' },
      { name: '晴天', artist: '周杰伦' },
      { name: '七里香', artist: '周杰伦' },
      { name: '童话', artist: '光良' },
      { name: '红日', artist: '李克勤' },
      { name: '朋友', artist: '周华健' },
      { name: '大海', artist: '张雨生' },
      { name: '吻别', artist: '张学友' },
      { name: '光阴的故事', artist: '罗大佑' }
    ]
  },
  {
    id: 'ost', icon: 'clapperboard', title: '影视动漫经典', desc: '前奏一起，画面就回来了',
    songs: [
      { name: '前前前世', artist: 'RADWIMPS' },
      { name: '打上花火', artist: 'DAOKO' },
      { name: '青鸟', artist: '生物股长' },
      { name: 'Secret Base', artist: 'ZONE' },
      { name: 'Let It Go', artist: 'Idina Menzel' },
      { name: 'City of Stars', artist: 'Ryan Gosling' },
      { name: 'My Heart Will Go On', artist: 'Celine Dion' },
      { name: "He's a Pirate", artist: 'Klaus Badelt' },
      { name: '时间煮雨', artist: '郁可唯' },
      { name: '凉凉', artist: '张碧晨' }
    ]
  },
  {
    id: 'minyao', icon: 'leaf', title: '民谣与诗', desc: '木吉他一响，故事就有了画面',
    songs: [
      { name: '董小姐', artist: '宋冬野' },
      { name: '安河桥', artist: '宋冬野' },
      { name: '理想', artist: '赵雷' },
      { name: '少年锦时', artist: '赵雷' },
      { name: '理想三旬', artist: '陈鸿宇' },
      { name: '云烟成雨', artist: '房东的猫' },
      { name: '美好事物', artist: '房东的猫' },
      { name: '平凡之路', artist: '朴树' },
      { name: '生如夏花', artist: '朴树' }
    ]
  },
  {
    id: 'cantopop', icon: 'music', title: '港乐时光', desc: '粤语金曲，一开口就是年代感',
    songs: [
      { name: '红豆', artist: '王菲' },
      { name: '约定', artist: '王菲' },
      { name: '十年', artist: '陈奕迅' },
      { name: '富士山下', artist: '陈奕迅' },
      { name: '浮夸', artist: '陈奕迅' },
      { name: '一生所爱', artist: '卢冠廷' },
      { name: '沉默是金', artist: '张国荣' },
      { name: '风继续吹', artist: '张国荣' },
      { name: '讲不出再见', artist: '谭咏麟' },
      { name: '一起走过的日子', artist: '刘德华' }
    ]
  },
  {
    id: 'west', icon: 'star-full', title: '欧美经典', desc: '旋律一响就是回忆杀',
    songs: [
      { name: 'Yesterday Once More', artist: 'Carpenters' },
      { name: 'My Love', artist: 'Westlife' },
      { name: 'As Long As You Love Me', artist: 'Backstreet Boys' },
      { name: 'Pretty Boy', artist: 'M2M' },
      { name: 'Big Big World', artist: 'Emilia' },
      { name: 'Lemon Tree', artist: "Fool's Garden" },
      { name: 'Dying in the Sun', artist: 'The Cranberries' },
      { name: 'Far Away From Home', artist: 'Groove Coverage' }
    ]
  },
  {
    id: 'jay', icon: 'music', title: 'Jay 时光机', desc: '从《简单爱》到《告白气球》',
    songs: [
      { name: '稻香', artist: '周杰伦' },
      { name: '青花瓷', artist: '周杰伦' },
      { name: '简单爱', artist: '周杰伦' },
      { name: '安静', artist: '周杰伦' },
      { name: '彩虹', artist: '周杰伦' },
      { name: '告白气球', artist: '周杰伦' },
      { name: '搁浅', artist: '周杰伦' },
      { name: '夜曲', artist: '周杰伦' }
    ]
  },
  {
    id: 'mayday', icon: 'flame', title: '五月天青春', desc: '青春万岁，倔强万岁',
    songs: [
      { name: '倔强', artist: '五月天' },
      { name: '突然好想你', artist: '五月天' },
      { name: '恋爱ing', artist: '五月天' },
      { name: '干杯', artist: '五月天' },
      { name: '你不是真正的快乐', artist: '五月天' },
      { name: '后来的我们', artist: '五月天' },
      { name: '星空', artist: '五月天' },
      { name: '转眼', artist: '五月天' }
    ]
  },
  {
    id: 'citynight', icon: 'moon', title: '城市夜行', desc: '晚风、路灯和耳机里的歌',
    songs: [
      { name: '演员', artist: '薛之谦' },
      { name: '丑八怪', artist: '薛之谦' },
      { name: '像我这样的人', artist: '毛不易' },
      { name: '默', artist: '那英' },
      { name: '匆匆那年', artist: '王菲' },
      { name: '光年之外', artist: '邓紫棋' },
      { name: '体面', artist: '于文文' },
      { name: '麻雀', artist: '薛之谦' }
    ]
  },
  {
    id: 'guofeng', icon: 'clapperboard', title: '国风古韵', desc: '戏腔一起，山河入画',
    songs: [
      { name: '大鱼', artist: '周深' },
      { name: '赤伶', artist: 'HITA' },
      { name: '牵丝戏', artist: '银临' },
      { name: '锦鲤抄', artist: '银临' },
      { name: '红昭愿', artist: '音阙诗听' },
      { name: '山外小楼夜听雨', artist: '任然' },
      { name: '燕无歇', artist: '蒋雪儿' },
      { name: '芒种', artist: '音阙诗听' }
    ]
  },
  {
    id: 'hot', icon: 'flame', title: '热歌现场', desc: '最近大街小巷都在放的',
    songs: [
      { name: '起风了', artist: '买辣椒也用券' },
      { name: '世间美好与你环环相扣', artist: '柏松' },
      { name: '你的答案', artist: '阿冗' },
      { name: '少年', artist: '梦然' },
      { name: '白月光与朱砂痣', artist: '大籽' },
      { name: '飞鸟和蝉', artist: '任然' },
      { name: '可可托海的牧羊人', artist: '王琪' },
      { name: '浪子闲话', artist: '花僮' }
    ]
  }
];

function playPlaylist(pl) {
  playList(pl.songs, 0);
}

async function doSearch() {
  const w = kw.value.trim();
  if (!w || loading.value) return;
  loading.value = true;
  error.value = '';
  songs.value = [];
  try {
    const d = await searchMusic(w);
    songs.value = d.songs || [];
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function clearAll() {
  if (confirm('确定清空全部听歌记录？')) clearKind('music');
}

onMounted(async () => {
  await loadKind('music');
  // 从首页「继续听」跳转过来：直接播放
  const pendingEntry = takePendingResume('music');
  if (pendingEntry) playFromHistory(pendingEntry);
});
</script>

<template>
  <div class="music container">
    <h2 class="page-h"><AppIcon name="music" :size="22" class="h-icon" /> 听会儿歌吧</h2>
    <p class="page-desc">
      累了就戴上耳机。搜歌名或歌手（如：成都 / 周杰伦），免费音源即刻播放。
      <span class="tip">切到「小说」等页面音乐也不会断，边看边听 🎧</span>
    </p>

    <!-- 今天随机听点什么 -->
    <div class="daily">
      <div class="daily-icon">🎲</div>
      <div class="daily-body">
        <div class="daily-title">今天随机听点什么？</div>
        <div class="daily-sub">今日每日歌单：<b>{{ shownPick.title }}</b> · {{ shownPick.songs.length }} 首随机播放<span v-if="!rerolled" class="dim">（明天自动换一批）</span></div>
      </div>
      <div class="daily-ops">
        <button class="btn small primary" @click="playDaily(false)">开始播放</button>
        <button class="btn small" @click="playDaily(true)">换一批</button>
      </div>
    </div>

    <!-- 推荐歌单 -->
    <h3 class="blk-title">为你准备的歌单</h3>
    <div class="pl-grid">
      <div v-for="pl in PLAYLISTS" :key="pl.id" class="pl-card" @click="playPlaylist(pl)">
        <div class="pl-icon"><AppIcon :name="pl.icon" :size="26" /></div>
        <div class="pl-info">
          <div class="pl-name">{{ pl.title }}</div>
          <div class="pl-desc">{{ pl.desc }} · {{ pl.songs.length }} 首</div>
        </div>
        <button class="btn small primary" title="顺序播放整个歌单" @click.stop="playPlaylist(pl)">
          <AppIcon name="play" :size="12" /> 播放
        </button>
      </div>
    </div>

    <!-- 搜索 -->
    <h3 class="blk-title">想听什么，搜一搜</h3>
    <form class="m-search" @submit.prevent="doSearch">
      <input v-model="kw" placeholder="搜索歌名或歌手，如：成都" maxlength="40" />
      <button class="btn primary" type="submit" :disabled="loading">
        <span v-if="loading" class="spin"></span> 搜索
      </button>
    </form>

    <p v-if="error" class="m-error">⚠ {{ error }}</p>

    <!-- 最近听过 -->
    <section v-if="musicHistory.length" class="hist-sec">
      <div class="hist-head">
        <h3 class="blk-title hist-title"><AppIcon name="history" :size="16" /> 最近听过</h3>
        <button class="btn small" @click="clearAll">清空记录</button>
      </div>
      <div class="hist-list">
        <div v-for="e in musicHistory" :key="e.key" class="hist-row" @click="playFromHistory(e)">
          <img v-if="e.cover" :src="e.cover" loading="lazy" class="hist-cover" @error="e2 => e2.target.style.visibility = 'hidden'" />
          <div v-else class="hist-cover fb"><AppIcon name="music" :size="16" /></div>
          <div class="hist-info">
            <div class="hist-name">{{ e.title }}</div>
            <div class="hist-artist dim">{{ e.subtitle || '未知歌手' }}</div>
          </div>
          <span class="hist-go"><AppIcon name="play" :size="12" /></span>
          <button class="hist-del" title="删除" @click.stop="removeEntry('music', e.key)"><AppIcon name="x" :size="12" /></button>
        </div>
      </div>
    </section>

    <div v-if="songs.length" class="m-list">
      <div class="m-list-head">
        <span>共 {{ songs.length }} 个结果</span>
        <button class="btn small" @click="playList(songs, 0)"><AppIcon name="play" :size="12" /> 全部播放</button>
      </div>
      <div
        v-for="(s, i) in songs"
        :key="s.songId"
        class="m-row"
        :class="{ playing: currentSong && currentSong.songId === s.songId }"
        @click="playList(songs, i)"
      >
        <span class="m-play">
          <span v-if="currentSong && currentSong.songId === s.songId" class="eq"><i></i><i></i><i></i></span>
          <AppIcon v-else name="play" :size="11" />
        </span>
        <span class="m-name">{{ s.name }}</span>
        <span class="m-artist">{{ s.artist }}</span>
        <span class="m-album">{{ s.album }}</span>
        <button class="m-add" title="加入播放列表" @click.stop="addToQueue(s)"><AppIcon name="plus" :size="14" /></button>
      </div>
    </div>
    <p v-else-if="!loading && !error" class="dim m-empty">别急，输入一首歌的名字，剩下的交给耳朵 🎵</p>
  </div>
</template>

<style scoped>
.music { padding-top: 34px; animation: rise 0.35s ease; padding-bottom: 30px; }
h2 { margin: 0 0 6px; }
.page-h { display: flex; align-items: center; gap: 9px; }
.h-icon { color: var(--gold); }
.page-desc { color: var(--text-dim); margin: 0 0 26px; font-size: 14px; }
.page-desc .tip { color: var(--gold); }

.blk-title { font-size: 16px; margin: 22px 0 12px; }

/* ---- 今天随机听点什么 ---- */
.daily {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  background: linear-gradient(135deg, var(--gold-soft), transparent 70%), var(--surface);
  border: 1px solid rgba(242, 185, 75, 0.35);
  border-radius: var(--radius);
  padding: 16px 18px;
  margin-bottom: 0;
}
.daily-icon { font-size: 34px; line-height: 1; }
.daily-body { flex: 1; min-width: 180px; }
.daily-title { font-size: 16px; font-weight: 700; }
.daily-sub { font-size: 12.5px; color: var(--text-dim); margin-top: 4px; }
.daily-ops { display: flex; gap: 8px; flex-shrink: 0; }

/* ---- 推荐歌单卡片 ---- */
.pl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}
.pl-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: all 0.18s;
  min-width: 0;   /* grid 子项允许收缩，否则窄屏整卡溢出 */
}
.pl-card:hover {
  border-color: rgba(242, 185, 75, 0.45);
  transform: translateY(-2px);
  box-shadow: var(--shadow-1);
}
.pl-icon {
  width: 52px; height: 52px;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--gold);
  border-radius: 14px;
  background: linear-gradient(135deg, var(--gold-soft), transparent);
  border: 1px solid var(--border);
}
.pl-info { flex: 1; min-width: 0; margin-right: 6px; }
.pl-name { font-size: 14px; font-weight: 700; line-height: 1.4; }
.pl-desc {
  font-size: 12px; color: var(--text-faint); margin-top: 3px; line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pl-card .btn { flex-shrink: 0; }

/* ---- 搜索 ---- */
.m-search { display: flex; gap: 10px; margin-bottom: 16px; align-items: center; }
.m-search input {
  flex: 1;
  min-width: 0; max-width: 460px;
  height: 38px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0 14px;
  color: var(--text);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.m-search input:focus { border-color: rgba(242, 185, 75, 0.5); box-shadow: 0 0 0 3px rgba(242, 185, 75, 0.1); }
.m-search .btn { height: 38px; }
.m-error { color: var(--red); font-size: 14px; margin: 0 0 14px; }

.m-list { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--surface); }
.m-list-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 16px;
  font-size: 12px; color: var(--text-faint);
  border-bottom: 1px solid var(--border);
}
.m-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 11px 16px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.12s;
}
.m-row:last-child { border-bottom: none; }
.m-row:hover { background: var(--hover); }
.m-row.playing { background: var(--gold-soft); }
.m-row.playing .m-name { color: var(--gold); }
.m-play {
  width: 28px; height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-2);
  color: var(--gold);
  flex-shrink: 0;
}
.m-row.playing .m-play { padding-left: 0; }
.m-row.playing .m-play .eq { height: 12px; }
.eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 11px; }
.eq i { width: 2.5px; border-radius: 1px; background: var(--gold); animation: eq-b 0.9s ease-in-out infinite; }
.eq i:nth-child(1) { height: 62%; }
.eq i:nth-child(2) { height: 100%; animation-delay: 0.25s; }
.eq i:nth-child(3) { height: 45%; animation-delay: 0.5s; }
@keyframes eq-b { 0%, 100% { transform: scaleY(0.45); } 50% { transform: scaleY(1); } }
.m-name { width: 30%; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m-artist { width: 22%; font-size: 13px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m-album { flex: 1; font-size: 13px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m-add {
  width: 26px; height: 26px;
  border-radius: 50%;
  color: var(--text-faint);
  font-size: 14px;
  flex-shrink: 0;
  opacity: 0;
  transition: all 0.15s;
}
.m-row:hover .m-add { opacity: 1; }
.m-add:hover { color: var(--gold); background: var(--gold-soft); }
.m-empty { text-align: center; padding: 50px 0; }

/* ---- 最近听过 ---- */
.hist-sec { margin-bottom: 22px; }
.hist-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.hist-title { margin: 0; }
.hist-list {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.hist-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.12s;
}
.hist-row:last-child { border-bottom: none; }
.hist-row:hover { background: var(--hover); }
.hist-cover {
  width: 38px; height: 38px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  background: linear-gradient(135deg, var(--cover-1), var(--cover-2));
}
.hist-cover.fb { display: flex; align-items: center; justify-content: center; color: var(--gold); }
.hist-info { flex: 1; min-width: 0; }
.hist-name { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hist-artist { font-size: 12px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hist-go {
  width: 26px; height: 26px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--gold-soft);
  color: var(--gold);
  flex-shrink: 0;
}
.hist-del {
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 6px;
  color: var(--text-faint);
  flex-shrink: 0;
}
.hist-del:hover { color: var(--red); background: rgba(255, 107, 107, 0.08); }

@media (max-width: 720px) {
  .m-album { display: none; }
  .m-name { width: 48%; }
  .m-artist { width: 30%; }
  .pl-grid { grid-template-columns: 1fr; }
  .music { padding-top: 22px; }
  .m-search input { font-size: 16px; }   /* ≥16px 防 iOS 聚焦自动放大 */
}
</style>
