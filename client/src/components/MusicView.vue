<script setup>
/**
 * 音乐频道：只负责「选歌」——推荐歌单 + 搜索。
 * 播放本身在全局 musicStore + MiniPlayer（底部常驻条）里，
 * 所以切到小说页边看边听也不会断。
 */
import { ref } from 'vue';
import { searchMusic } from '../api.js';
import { useMusicPlayer } from '../musicStore.js';
import AppIcon from './AppIcon.vue';

// 解构出来用：普通对象里嵌套的 ref 在模板中不会自动解包
const { playList, addToQueue, currentSong } = useMusicPlayer();

const kw = ref('');
const loading = ref(false);
const error = ref('');
const songs = ref([]);

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
</script>

<template>
  <div class="music container">
    <h2 class="page-h"><AppIcon name="music" :size="22" class="h-icon" /> 听会儿歌吧</h2>
    <p class="page-desc">
      累了就戴上耳机。搜歌名或歌手（如：成都 / 周杰伦），免费音源即刻播放。
      <span class="tip">切到「小说」等页面音乐也不会断，边看边听 🎧</span>
    </p>

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
.music { padding-top: 34px; animation: rise 0.35s ease both; padding-bottom: 30px; }
h2 { margin: 0 0 6px; }
.page-h { display: flex; align-items: center; gap: 9px; }
.h-icon { color: var(--gold); }
.page-desc { color: var(--text-dim); margin: 0 0 26px; font-size: 14px; }
.page-desc .tip { color: var(--gold); }

.blk-title { font-size: 16px; margin: 26px 0 12px; }

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
.m-search { display: flex; gap: 10px; margin-bottom: 18px; align-items: center; }
.m-search input {
  flex: 1;
  max-width: 460px;
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

@media (max-width: 720px) {
  .m-album { display: none; }
  .m-name { width: 48%; }
  .m-artist { width: 30%; }
  .pl-grid { grid-template-columns: 1fr; }
}
</style>
