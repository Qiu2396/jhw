import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

const app = createApp(App);
// 渲染错误默认只进 console，这里同步暴露到 window 便于诊断
app.config.errorHandler = (err, _inst, info) => {
  console.error('[vue]', err);
  if (typeof window !== 'undefined') {
    (window.__vueErrs = window.__vueErrs || []).push(
      String((err && err.stack) || err).slice(0, 500) + ' [' + info + ']'
    );
  }
};
app.mount('#app');
