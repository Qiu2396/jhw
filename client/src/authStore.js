/**
 * 登录态（模块级单例）
 *
 * - token 存 localStorage（fv_token），启动时用 /api/auth/me 恢复会话
 * - user 为 null 表示未登录；isAdmin 标记超级管理员
 * - 登录弹窗状态也挂在这里（openAuth），任何页面/组件都能唤起
 */
import { ref } from 'vue';
import { apiLogin, apiRegister, apiLogout, apiMe, setToken, getToken } from './api.js';

const user = ref(null);          // null | { id, username, isAdmin, createdAt }
const ready = ref(false);        // 会话恢复完成（避免刷新时闪烁登录按钮）
const authError = ref('');

// 登录/注册弹窗
const showAuth = ref(false);
const authReason = ref('');      // 唤起弹窗时的提示语（如「登录后即可新增源」）

export function openAuth(reason = '') {
  authReason.value = reason;
  authError.value = '';
  showAuth.value = true;
}

export function closeAuth() {
  showAuth.value = false;
  authReason.value = '';
}

export async function initAuth() {
  if (!getToken()) { ready.value = true; return; }
  try {
    const d = await apiMe();
    user.value = d.user;
    if (!d.user) setToken('');       // 令牌已失效
  } catch { /* 网络问题：保留 token，下次再验 */ }
  ready.value = true;
}

export async function doLogin(username, password) {
  const d = await apiLogin(username, password);
  user.value = d.user;
  setToken(d.token);
  showAuth.value = false;
  authReason.value = '';
  return d.user;
}

export async function doRegister(username, password) {
  const d = await apiRegister(username, password);
  user.value = d.user;
  setToken(d.token);
  showAuth.value = false;
  authReason.value = '';
  return d.user;
}

export async function doLogout() {
  try { await apiLogout(); } catch { /* 本地照样退 */ }
  user.value = null;
  setToken('');
}

export function useAuth() {
  return { user, ready, authError, showAuth, authReason, openAuth, closeAuth, initAuth, doLogin, doRegister, doLogout };
}
