<script setup>
/**
 * 登录 / 注册弹窗（可选功能：游客不登录也能用全部功能，
 * 登录的好处是听歌/听书/阅读记录云端同步，换设备也能继续）。
 */
import { ref, watch } from 'vue';
import { useAuth } from '../authStore.js';
import AppIcon from './AppIcon.vue';

const { showAuth, authReason, closeAuth, doLogin, doRegister } = useAuth();

const tab = ref('login');          // login | register
const username = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

watch(showAuth, (v) => {
  if (v) { error.value = ''; password.value = ''; busy.value = false; }
});

async function submit() {
  if (busy.value) return;
  error.value = '';
  busy.value = true;
  try {
    if (tab.value === 'login') await doLogin(username.value.trim(), password.value);
    else await doRegister(username.value.trim(), password.value);
  } catch (e) {
    error.value = e.message || '操作失败';
  } finally {
    busy.value = false;
  }
}

function switchTab(t) {
  tab.value = t;
  error.value = '';
}
</script>

<template>
  <Transition name="fade">
    <div v-if="showAuth" class="mask" @click.self="closeAuth">
      <div class="dialog">
        <button class="x" title="关闭" @click="closeAuth"><AppIcon name="x" :size="15" /></button>
        <h3>{{ tab === 'login' ? '登录' : '注册新账号' }}</h3>
        <p class="guest-tip dim">不登录也完全可以使用；登录后听歌、听书、阅读记录云端同步，换设备也能一键继续。</p>
        <p v-if="authReason" class="reason">{{ authReason }}</p>

        <div class="tabs">
          <button :class="{ on: tab === 'login' }" @click="switchTab('login')">登录</button>
          <button :class="{ on: tab === 'register' }" @click="switchTab('register')">注册</button>
        </div>

        <form class="form" @submit.prevent="submit">
          <label>用户名
            <input
              v-model="username"
              placeholder="2~20 位，中文/字母/数字/下划线"
              maxlength="20"
              autocomplete="username"
            />
          </label>
          <label>密码
            <input
              v-model="password"
              type="password"
              placeholder="至少 6 位"
              maxlength="64"
              :autocomplete="tab === 'login' ? 'current-password' : 'new-password'"
            />
          </label>
          <p v-if="error" class="err">⚠ {{ error }}</p>
          <button class="btn primary" type="submit" :disabled="busy || !username.trim() || !password">
            <span v-if="busy" class="spin"></span> {{ tab === 'login' ? '登录' : '注册并登录' }}
          </button>
          <p v-if="tab === 'register'" class="dim first-hint">提示：第一个注册的账号自动成为超级管理员，可管理资源源。</p>
        </form>

        <button class="btn ghost" @click="closeAuth">先逛逛，用游客身份</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 110;
  background: var(--mask);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.dialog {
  position: relative;
  width: 100%;
  max-width: 400px;
  max-height: 88vh;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: var(--shadow-2);
  animation: pop-in 0.2s ease both;
}
.x {
  position: absolute;
  top: 14px; right: 14px;
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 8px;
  color: var(--text-faint);
}
.x:hover { color: var(--text); background: var(--hover); }
h3 { margin: 0 0 6px; }
.guest-tip { font-size: 12.5px; margin: 0 0 12px; line-height: 1.6; }
.reason {
  font-size: 13px;
  color: var(--gold);
  background: var(--gold-soft);
  border: 1px solid rgba(242, 185, 75, 0.3);
  border-radius: 8px;
  padding: 8px 12px;
  margin: 0 0 12px;
}
.tabs {
  display: flex;
  gap: 6px;
  background: var(--bg-soft);
  border-radius: 10px;
  padding: 4px;
  margin-bottom: 16px;
}
.tabs button {
  flex: 1;
  height: 32px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-dim);
}
.tabs button.on { background: var(--surface); color: var(--gold); font-weight: 600; box-shadow: var(--shadow-1); }
.form { display: flex; flex-direction: column; gap: 12px; }
.form label { display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: var(--text-dim); }
.form input {
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 10px 12px;
  color: var(--text);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.form input:focus {
  border-color: rgba(242, 185, 75, 0.5);
  box-shadow: 0 0 0 3px rgba(242, 185, 75, 0.08);
}
.err { color: var(--red); font-size: 13px; margin: 0; }
.form .btn { margin-top: 4px; height: 40px; }
.first-hint { font-size: 12px; margin: 0; text-align: center; }
.ghost { margin-top: 12px; width: 100%; border: none; color: var(--text-faint); }
.ghost:hover { color: var(--gold); }

.fade-enter-active, .fade-leave-active { transition: opacity 0.18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@media (max-width: 480px) {
  .mask { padding: 12px; align-items: flex-end; }
  .dialog { padding: 20px 16px; border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
}
</style>
