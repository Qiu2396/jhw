<script setup>
/**
 * 常用网站：分类导航 + 自定义
 *
 * - 预置 AI 工具 / 前端开发 / 设计资源 / 学习教程 / 实用工具 五个分类的精选站点
 * - 用户可添加 / 编辑 / 删除网站，可新建自定义分类，全部修改保存在本机浏览器
 * - 重置可恢复预置数据
 */
import { ref, computed, reactive } from 'vue';
import AppIcon from './AppIcon.vue';

const STORE_KEY = 'fv_quick_sites_v1';

/* ---- 预置数据（首次访问写入本地，之后完全以本地为准） ---- */
const SEED = {
  categories: [
    { id: 'ai', name: 'AI 工具', builtIn: true },
    { id: 'fe', name: '前端开发', builtIn: true },
    { id: 'design', name: '设计资源', builtIn: true },
    { id: 'learn', name: '学习教程', builtIn: true },
    { id: 'utils', name: '实用工具', builtIn: true }
  ],
  sites: [
    // AI 工具
    { id: 's_chatgpt', cat: 'ai', name: 'ChatGPT', url: 'https://chatgpt.com', desc: 'OpenAI 旗下 AI 对话' },
    { id: 's_deepseek', cat: 'ai', name: 'DeepSeek', url: 'https://chat.deepseek.com', desc: '深度求索 AI 助手' },
    { id: 's_kimi', cat: 'ai', name: 'Kimi', url: 'https://kimi.moonshot.cn', desc: '月之暗面长文本助手' },
    { id: 's_doubao', cat: 'ai', name: '豆包', url: 'https://www.doubao.com', desc: '字节跳动 AI 助手' },
    { id: 's_qianwen', cat: 'ai', name: '通义千问', url: 'https://tongyi.aliyun.com/qianwen', desc: '阿里 AI 助手' },
    { id: 's_chatglm', cat: 'ai', name: '智谱清言', url: 'https://chatglm.cn', desc: '智谱 AI 对话' },
    { id: 's_gemini', cat: 'ai', name: 'Gemini', url: 'https://gemini.google.com', desc: 'Google AI 助手' },
    { id: 's_claude', cat: 'ai', name: 'Claude', url: 'https://claude.ai', desc: 'Anthropic AI 助手' },
    { id: 's_metaso', cat: 'ai', name: '秘塔 AI 搜索', url: 'https://metaso.cn', desc: '没有广告、直达结果的 AI 搜索' },
    { id: 's_hf', cat: 'ai', name: 'Hugging Face', url: 'https://huggingface.co', desc: '全球 AI 模型社区' },
    // 前端开发
    { id: 's_mdn', cat: 'fe', name: 'MDN Web Docs', url: 'https://developer.mozilla.org/zh-CN/', desc: 'Web 技术权威文档' },
    { id: 's_vue', cat: 'fe', name: 'Vue.js', url: 'https://cn.vuejs.org', desc: '渐进式 JavaScript 框架' },
    { id: 's_react', cat: 'fe', name: 'React', url: 'https://react.dev', desc: 'Meta 出品 UI 框架' },
    { id: 's_vite', cat: 'fe', name: 'Vite', url: 'https://cn.vitejs.dev', desc: '下一代前端构建工具' },
    { id: 's_ts', cat: 'fe', name: 'TypeScript', url: 'https://www.typescriptlang.org', desc: 'JS 超集类型系统' },
    { id: 's_github', cat: 'fe', name: 'GitHub', url: 'https://github.com', desc: '全球最大代码托管平台' },
    { id: 's_npm', cat: 'fe', name: 'npm', url: 'https://www.npmjs.com', desc: 'JavaScript 包仓库' },
    { id: 's_canuse', cat: 'fe', name: 'Can I Use', url: 'https://caniuse.com', desc: '浏览器兼容性查询' },
    { id: 's_juejin', cat: 'fe', name: '稀土掘金', url: 'https://juejin.cn', desc: '开发者技术社区' },
    { id: 's_so', cat: 'fe', name: 'Stack Overflow', url: 'https://stackoverflow.com', desc: '程序员问答社区' },
    // 设计资源
    { id: 's_figma', cat: 'design', name: 'Figma', url: 'https://www.figma.com', desc: '在线协同 UI 设计' },
    { id: 's_dribbble', cat: 'design', name: 'Dribbble', url: 'https://dribbble.com', desc: '全球设计师作品社区' },
    { id: 's_behance', cat: 'design', name: 'Behance', url: 'https://www.behance.net', desc: 'Adobe 创意作品社区' },
    { id: 's_zcool', cat: 'design', name: '站酷', url: 'https://www.zcool.com.cn', desc: '国内设计师社区' },
    { id: 's_iconfont', cat: 'design', name: 'Iconfont', url: 'https://www.iconfont.cn', desc: '阿里矢量图标库' },
    { id: 's_unsplash', cat: 'design', name: 'Unsplash', url: 'https://unsplash.com', desc: '免费高质量图库' },
    { id: 's_coolors', cat: 'design', name: 'Coolors', url: 'https://coolors.co', desc: '快速配色生成器' },
    { id: 's_icons8', cat: 'design', name: 'Icons8', url: 'https://icons8.com', desc: '图标与插图素材' },
    // 学习教程
    { id: 's_runoob', cat: 'learn', name: '菜鸟教程', url: 'https://www.runoob.com', desc: '编程入门图文教程' },
    { id: 's_w3s', cat: 'learn', name: 'W3School', url: 'https://www.w3school.com.cn', desc: '在线 Web 教程' },
    { id: 's_bili', cat: 'learn', name: '哔哩哔哩', url: 'https://www.bilibili.com', desc: '视频教程学习圣地' },
    { id: 's_zhihu', cat: 'learn', name: '知乎', url: 'https://www.zhihu.com', desc: '中文问答社区' },
    { id: 's_leetcode', cat: 'learn', name: '力扣 LeetCode', url: 'https://leetcode.cn', desc: '算法刷题平台' },
    { id: 's_imooc', cat: 'learn', name: '慕课网', url: 'https://www.imooc.com', desc: 'IT 技能在线课程' },
    { id: 's_mooc', cat: 'learn', name: '中国大学 MOOC', url: 'https://www.icourse163.org', desc: '名校公开课程' },
    // 实用工具
    { id: 's_tinypng', cat: 'utils', name: 'TinyPNG', url: 'https://tinypng.com', desc: '在线图片无损压缩' },
    { id: 's_kuaidi', cat: 'utils', name: '快递 100', url: 'https://www.kuaidi100.com', desc: '快递单号查询' },
    { id: 's_cli', cat: 'utils', name: '草料二维码', url: 'https://cli.im', desc: '二维码生成与美化' },
    { id: 's_processon', cat: 'utils', name: 'ProcessOn', url: 'https://www.processon.com', desc: '在线流程图思维导图' },
    { id: 's_ilovepdf', cat: 'utils', name: 'iLovePDF', url: 'https://www.ilovepdf.com/zh-cn', desc: '在线 PDF 工具箱' }
  ]
};

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* 损坏则重置 */ }
  return JSON.parse(JSON.stringify(SEED));
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* 忽略 */ }
}

const store = reactive(load());

/* ---- 分类过滤 ---- */
const activeCat = ref('all');
const catChips = computed(() => [
  { id: 'all', name: '全部' },
  ...store.categories
]);
const shownSites = computed(() => {
  const kw = search.value.trim().toLowerCase();
  return store.sites.filter(s => {
    if (activeCat.value !== 'all' && s.cat !== activeCat.value) return false;
    if (kw && !(s.name.toLowerCase().includes(kw) || (s.desc || '').toLowerCase().includes(kw) || s.url.toLowerCase().includes(kw))) return false;
    return true;
  });
});
const shownByCat = computed(() => {
  const groups = [];
  for (const c of store.categories) {
    const list = shownSites.value.filter(s => s.cat === c.id);
    if (list.length) groups.push({ cat: c, list });
  }
  return groups;
});

const search = ref('');

/* ---- 站点增删改 ---- */
const showSiteDialog = ref(false);
const siteForm = reactive({ id: '', name: '', url: '', desc: '', cat: 'ai', newCat: '' });
const siteErr = ref('');
const editing = ref(false);

function normUrl(u) {
  u = u.trim();
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : 'https://' + u;
}
function openAddSite(cat = 'ai') {
  editing.value = false;
  Object.assign(siteForm, { id: '', name: '', url: '', desc: '', cat, newCat: '' });
  siteErr.value = '';
  showSiteDialog.value = true;
}
function openEditSite(s) {
  editing.value = true;
  Object.assign(siteForm, { id: s.id, name: s.name, url: s.url, desc: s.desc || '', cat: s.cat, newCat: '' });
  siteErr.value = '';
  showSiteDialog.value = true;
}
function saveSite() {
  const url = normUrl(siteForm.url);
  try { new URL(url); } catch { siteErr.value = '网址不合法，请检查'; return; }
  if (!siteForm.name.trim()) { siteErr.value = '请填写名称'; return; }
  // 新分类名优先
  let cat = siteForm.cat;
  if (siteForm.newCat.trim()) {
    const name = siteForm.newCat.trim().slice(0, 12);
    let c = store.categories.find(c => c.name === name);
    if (!c) {
      c = { id: 'uc_' + Date.now().toString(36), name, builtIn: false };
      store.categories.push(c);
    }
    cat = c.id;
  }
  if (editing.value) {
    const s = store.sites.find(x => x.id === siteForm.id);
    if (s) Object.assign(s, { name: siteForm.name.trim(), url, desc: siteForm.desc.trim(), cat });
  } else {
    store.sites.unshift({
      id: 'u_' + Date.now().toString(36),
      cat,
      name: siteForm.name.trim(),
      url,
      desc: siteForm.desc.trim()
    });
    activeCat.value = cat;
  }
  save();
  showSiteDialog.value = false;
}
function delSite(s) {
  if (!confirm(`删除「${s.name}」？`)) return;
  store.sites = store.sites.filter(x => x.id !== s.id);
  save();
}

/* ---- 分类管理 ---- */
const showCatDialog = ref(false);
const newCatName = ref('');
function addCategory() {
  const name = newCatName.value.trim().slice(0, 12);
  if (!name) return;
  if (store.categories.some(c => c.name === name)) { alert('分类已存在'); return; }
  store.categories.push({ id: 'uc_' + Date.now().toString(36), name, builtIn: false });
  newCatName.value = '';
  save();
}
function delCategory(c) {
  const count = store.sites.filter(s => s.cat === c.id).length;
  if (count && !confirm(`「${c.name}」下还有 ${count} 个网站，删除分类会一并删除它们，确定？`)) return;
  store.categories = store.categories.filter(x => x.id !== c.id);
  store.sites = store.sites.filter(s => s.cat !== c.id);
  if (activeCat.value === c.id) activeCat.value = 'all';
  save();
}

function resetAll() {
  if (!confirm('恢复预置数据？你的自定义网站和分类会被清除。')) return;
  Object.assign(store, JSON.parse(JSON.stringify(SEED)));
  activeCat.value = 'all';
  save();
}

/* ---- 图标：优先站点 favicon，失败退化为首字母色块 ---- */
function favUrl(s) {
  try { return new URL(s.url).origin + '/favicon.ico'; } catch { return ''; }
}
function catOf(id) {
  return store.categories.find(c => c.id === id);
}
</script>

<template>
  <div class="qs container">
    <h2 class="page-h"><AppIcon name="star-full" :size="20" class="h-icon" /> 常用网站</h2>
    <p class="page-desc">精选 AI / 前端 / 设计等高频站点，全部可自定义；数据保存在本机浏览器。</p>

    <!-- 工具条 -->
    <div class="qs-bar">
      <input v-model="search" class="qs-search" placeholder="搜索站点名称 / 网址…" />
      <button class="btn small primary" @click="openAddSite(activeCat === 'all' ? 'ai' : activeCat)"><AppIcon name="plus" :size="12" /> 添加网站</button>
      <button class="btn small" @click="showCatDialog = true"><AppIcon name="plus" :size="12" /> 新分类</button>
      <button class="btn small" @click="resetAll" title="恢复预置数据">重置</button>
    </div>

    <!-- 分类筛选 -->
    <div class="qs-chips">
      <button
        v-for="c in catChips" :key="c.id"
        class="chip" :class="{ active: activeCat === c.id }"
        @click="activeCat = c.id"
      >{{ c.name }}</button>
    </div>

    <!-- 分组展示 -->
    <section v-for="g in shownByCat" :key="g.cat.id" class="qs-group">
      <div class="qs-group-head">
        <h3>{{ g.cat.name }} <span class="dim qs-count">{{ g.list.length }}</span></h3>
        <span class="qs-group-ops">
          <button class="btn small" @click="openAddSite(g.cat.id)"><AppIcon name="plus" :size="11" /> 添加</button>
          <button v-if="!g.cat.builtIn" class="btn small danger" @click="delCategory(g.cat)">删分类</button>
        </span>
      </div>
      <div class="qs-grid">
        <div v-for="s in g.list" :key="s.id" class="site-card">
          <a :href="s.url" target="_blank" rel="noopener noreferrer" class="site-link">
            <img
              v-if="favUrl(s)" class="site-ico" :src="favUrl(s)" loading="lazy"
              @error="e => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex'; }"
            />
            <span class="site-letter" style="display:none">{{ (s.name || '?').slice(0, 1).toUpperCase() }}</span>
            <span class="site-name">{{ s.name }}</span>
            <span class="site-desc dim">{{ s.desc }}</span>
          </a>
          <button class="site-edit" title="编辑" @click="openEditSite(s)"><AppIcon name="wrench" :size="12" /></button>
          <button class="site-del" title="删除" @click="delSite(s)"><AppIcon name="x" :size="12" /></button>
        </div>
      </div>
    </section>

    <div v-if="!shownByCat.length" class="qs-empty dim">
      {{ search ? '没有匹配的网站，换个关键词试试' : '这个分类还是空的，点「添加网站」放一个进去' }}
    </div>

    <!-- 网站 编辑/添加 弹窗（Teleport 到 body：fixed 定位不受任何祖先 transform 影响） -->
    <Teleport to="body">
      <div v-if="showSiteDialog" class="mask" @click.self="showSiteDialog = false">
        <div class="dialog">
          <h3>{{ editing ? '编辑网站' : '添加网站' }}</h3>
          <div class="form">
            <label>名称 *<input v-model="siteForm.name" maxlength="20" placeholder="如：Vue.js" /></label>
            <label>网址 *<input v-model="siteForm.url" maxlength="200" placeholder="vuejs.org（可省略 https://）" @keyup.enter="saveSite" /></label>
            <label>分类
              <select v-model="siteForm.cat">
                <option v-for="c in store.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </label>
            <label>或新建分类<input v-model="siteForm.newCat" maxlength="12" placeholder="留空则使用上面选择的分类" /></label>
            <label>描述<input v-model="siteForm.desc" maxlength="30" placeholder="一句话说明（可选）" /></label>
          </div>
          <p v-if="siteErr" class="qs-err">⚠ {{ siteErr }}</p>
          <div class="dialog-foot">
            <button class="btn" @click="showSiteDialog = false">取消</button>
            <button class="btn primary" @click="saveSite">保存</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 新分类 弹窗 -->
    <Teleport to="body">
      <div v-if="showCatDialog" class="mask" @click.self="showCatDialog = false">
        <div class="dialog">
          <h3>新建分类</h3>
          <div class="form">
            <label>分类名称 *<input v-model="newCatName" maxlength="12" placeholder="如：后端开发 / 影音娱乐" @keyup.enter="addCategory(); showCatDialog = false" /></label>
          </div>
          <div class="dialog-foot">
            <button class="btn" @click="showCatDialog = false">取消</button>
            <button class="btn primary" @click="addCategory(); showCatDialog = false">创建</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.qs { padding-top: 34px; animation: rise 0.35s ease; }
.page-h { display: flex; align-items: center; gap: 9px; margin: 0 0 6px; }
.h-icon { color: var(--gold); }
.page-desc { color: var(--text-dim); margin: 0 0 20px; font-size: 14px; }

.qs-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.qs-search {
  flex: 1; min-width: 180px; max-width: 380px;
  height: 34px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 0 12px;
  color: var(--text); font-size: 14px; outline: none;
}
.qs-search:focus { border-color: rgba(242, 185, 75, 0.5); }

.qs-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.chip {
  padding: 5px 14px;
  border-radius: 999px;
  font-size: 13px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-dim);
  transition: all 0.15s;
}
.chip:hover { color: var(--text); border-color: var(--border-strong); }
.chip.active { color: var(--gold); border-color: rgba(242, 185, 75, 0.5); background: var(--gold-soft); font-weight: 600; }

.qs-group { margin-bottom: 24px; }
.qs-group-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px;
}
.qs-group-head h3 { margin: 0; font-size: 16px; }
.qs-count { font-size: 12px; font-weight: 400; }
.qs-group-ops { display: flex; gap: 6px; }

.qs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 10px;
}
.site-card {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  transition: all 0.18s;
}
.site-card:hover { border-color: rgba(242, 185, 75, 0.45); transform: translateY(-2px); }
.site-link {
  display: flex; flex-direction: column; gap: 2px;
  padding: 12px 12px 10px;
  color: inherit;
  min-height: 74px;
}
.site-link:hover { text-decoration: none; }
.site-ico {
  width: 22px; height: 22px;
  border-radius: 5px;
  margin-bottom: 4px;
  background: var(--surface-2);
  object-fit: contain;
}
.site-letter {
  width: 22px; height: 22px;
  border-radius: 5px;
  margin-bottom: 4px;
  display: none;
  align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--gold-soft), transparent);
  color: var(--gold);
  font-size: 12px; font-weight: 700;
}
.site-name { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.site-desc {
  font-size: 11.5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.site-edit, .site-del {
  position: absolute; top: 6px; right: 6px;
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 6px;
  color: var(--text-faint);
  opacity: 0;
  transition: opacity 0.15s;
}
.site-del { right: 28px; }
.site-card:hover .site-edit, .site-card:hover .site-del { opacity: 1; }
.site-edit:hover { color: var(--gold); background: var(--hover); }
.site-del:hover { color: var(--red); background: rgba(255, 107, 107, 0.1); }

.qs-empty { text-align: center; padding: 60px 0; }

/* 弹窗 */
.mask {
  position: fixed; inset: 0; z-index: 100;
  background: var(--mask);
  backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}
.dialog {
  width: 100%; max-width: 420px;
  max-height: 88vh; overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  padding: 22px 24px;
  box-shadow: var(--shadow-2);
}
.dialog h3 { margin: 0 0 14px; }
.form { display: flex; flex-direction: column; gap: 12px; }
.form label { display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: var(--text-dim); }
.form input, .form select {
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 9px 12px;
  color: var(--text); font-size: 14px; outline: none;
}
.form input:focus, .form select:focus { border-color: rgba(242, 185, 75, 0.5); }
.qs-err { color: var(--red); font-size: 13px; margin: 10px 0 0; }
.dialog-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }

@media (max-width: 720px) {
  .qs { padding-top: 22px; }
  .qs-grid { grid-template-columns: repeat(auto-fill, minmax(136px, 1fr)); }
  .qs-search { font-size: 16px; }   /* ≥16px 防 iOS 聚焦自动放大 */
}
</style>
