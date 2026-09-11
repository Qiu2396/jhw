<script setup>
/**
 * 3D 手机工坊：three.js 程序化建模一台 iPhone（金属中框 + 玻璃背板 + 屏幕 +
 * 相机模组 + 侧键），可换手机壳（颜色 × 透明/磨砂/实色）、锁屏壁纸（Canvas
 * 纹理绘制）、场景背景，支持拖拽旋转缩放、自动旋转与截图保存。
 * 纯前端本地运行，不经过任何服务器。
 */
import { ref, watch, onMounted, onUnmounted } from 'vue';
import AppIcon from './AppIcon.vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/* ---------------- 可选项 ---------------- */
const CASE_COLORS = [
  { id: 'clear',  name: '透明',  hex: '#f4f6f8' },
  { id: 'black',  name: '曜石',  hex: '#1d1f24' },
  { id: 'white',  name: '云白',  hex: '#eef0f2' },
  { id: 'pink',   name: '奶油粉', hex: '#f2c9d4' },
  { id: 'blue',   name: '雾蓝',  hex: '#a8c3e8' },
  { id: 'mint',   name: '薄荷',  hex: '#bfe3d0' },
  { id: 'purple', name: '香芋紫', hex: '#c9b6e4' },
  { id: 'gold',   name: '流金',  hex: '#e8cfa0' }
];
const CASE_STYLES = [
  { id: 'clear', name: '透明壳' },
  { id: 'frost', name: '磨砂壳' },
  { id: 'solid', name: '硅胶壳' }
];
const BODY_COLORS = [
  { id: 'titan', name: '原色钛', hex: '#9a9ea6', back: '#3f4147' },
  { id: 'black', name: '深空黑', hex: '#4a4c52', back: '#17181c' },
  { id: 'gold',  name: '金色',   hex: '#d8bd94', back: '#2e2a22' },
  { id: 'blue',  name: '蓝色',   hex: '#6f86a8', back: '#1d2530' }
];
const WALLPAPERS = [
  { id: 'dusk',   name: '暮色', stops: ['#2b1a4d', '#8a3b6b', '#e8896a'] },
  { id: 'ocean',  name: '深海', stops: ['#04182e', '#0a4a6e', '#3fa0a8'] },
  { id: 'forest', name: '森林', stops: ['#0c2b1c', '#1f5c38', '#7fb069'] },
  { id: 'sakura', name: '樱粉', stops: ['#3d2135', '#a4487a', '#f5b8c8'] },
  { id: 'mono',   name: '石墨', stops: ['#101114', '#2a2c33', '#555a64'] },
  { id: 'aurora', name: '极光', stops: ['#04121f', '#14524f', '#7ad3a0', '#c9e864'] }
];
const BGS = [
  { id: 'studio', name: '影棚', stops: ['#3a3d44', '#191b1f'] },
  { id: 'dusk',   name: '暮色', stops: ['#f0b37e', '#8a3b6b', '#251a3d'] },
  { id: 'night',  name: '夜色', stops: ['#141c3a', '#0a0d1f'] },
  { id: 'mint',   name: '薄荷', stops: ['#dff2e9', '#9ec9b4'] },
  { id: 'sakura', name: '樱粉', stops: ['#fbe3ea', '#e8a8bd'] },
  { id: 'slate',  name: '青灰', stops: ['#4d5866', '#232a33'] }
];

const caseColorId = ref('clear');
const caseStyleId = ref('clear');
const bodyColorId = ref('titan');
const wallpaperId = ref('dusk');
const bgId = ref('studio');
const autoRotate = ref(true);
const shotting = ref(false);
const webglError = ref('');

/* ---------------- three.js 场景 ---------------- */
const stageEl = ref(null);
let renderer, scene, camera, controls, raf = 0;
let phoneGroup, caseMesh, frameMesh, backMesh, screenMesh, shadowMesh;
let screenCanvas, screenTex;
let ro = null;

function gradCanvas(w, h, stops, angle = 90) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const rad = (angle * Math.PI) / 180;
  const g = ctx.createLinearGradient(
    w / 2 - Math.cos(rad) * w / 2, h / 2 - Math.sin(rad) * h / 2,
    w / 2 + Math.cos(rad) * w / 2, h / 2 + Math.sin(rad) * h / 2
  );
  stops.forEach((col, i) => g.addColorStop(i / (stops.length - 1), col));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return c;
}

/** 锁屏壁纸：渐变 + 柔光圆 + 时间日期 */
function drawWallpaper(stops) {
  const c = screenCanvas;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(gradCanvas(c.width, c.height, stops, 115), 0, 0);
  // 柔光装饰圆
  for (const [x, y, r, a] of [[c.width * 0.8, c.height * 0.2, c.width * 0.5, 0.12], [c.width * 0.15, c.height * 0.55, c.width * 0.45, 0.1]]) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  const now = new Date();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.textAlign = 'center';
  ctx.font = '600 44px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.fillText(`${now.getMonth() + 1}月${now.getDate()}日 周${'日一二三四五六'[now.getDay()]}`, c.width / 2, 150);
  ctx.font = '700 130px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.fillText(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, c.width / 2, 268);
  // 底部解锁条
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.beginPath();
  ctx.roundRect(c.width / 2 - 90, c.height - 58, 180, 7, 4);
  ctx.fill();
  screenTex.needsUpdate = true;
}

function applyCase() {
  if (!caseMesh) return;
  const hex = CASE_COLORS.find(c => c.id === caseColorId.value)?.hex || '#ffffff';
  const m = caseMesh.material;
  m.color.set(hex);
  if (caseStyleId.value === 'clear') {
    m.transparent = true; m.opacity = 0.26; m.roughness = 0.18; m.metalness = 0.0;
  } else if (caseStyleId.value === 'frost') {
    m.transparent = true; m.opacity = 0.72; m.roughness = 0.55; m.metalness = 0.0;
  } else {
    m.transparent = false; m.opacity = 1; m.roughness = 0.85; m.metalness = 0.0;
  }
  m.needsUpdate = true;
}

function applyBody() {
  if (!frameMesh || !backMesh) return;
  const b = BODY_COLORS.find(c => c.id === bodyColorId.value) || BODY_COLORS[0];
  frameMesh.material.color.set(b.hex);
  backMesh.material.color.set(b.back);
}

function applyBg() {
  if (!scene) return;
  const stops = (BGS.find(b => b.id === bgId.value) || BGS[0]).stops;
  const tex = new THREE.CanvasTexture(gradCanvas(512, 512, stops, 100));
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background?.dispose?.();
  scene.background = tex;
}

function initScene() {
  const w = stageEl.value.clientWidth, h = stageEl.value.clientHeight;
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  stageEl.value.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  applyBg();

  camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 200);
  camera.position.set(3, 3, 34);

  // 环境反射（PBR 质感的关键）
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.05).texture;
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(8, 12, 10);
  const rim = new THREE.DirectionalLight(0xbfd4ff, 0.9);
  rim.position.set(-10, 6, -8);
  scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.35));

  buildPhone();

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 14;
  controls.maxDistance = 42;
  controls.autoRotate = autoRotate.value;
  controls.autoRotateSpeed = 1.4;

  ro = new ResizeObserver(() => {
    const nw = stageEl.value.clientWidth, nh = stageEl.value.clientHeight;
    if (!nw || !nh) return;
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
    renderer.setSize(nw, nh);
  });
  ro.observe(stageEl.value);

  const loop = () => {
    raf = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  };
  loop();
}

function buildPhone() {
  phoneGroup = new THREE.Group();

  // 金属中框
  frameMesh = new THREE.Mesh(
    new RoundedBoxGeometry(7.4, 15.2, 0.8, 5, 0.16),
    new THREE.MeshPhysicalMaterial({ color: '#9a9ea6', metalness: 0.95, roughness: 0.32, clearcoat: 0.6 })
  );
  // 玻璃背板
  backMesh = new THREE.Mesh(
    new RoundedBoxGeometry(7.12, 14.92, 0.84, 5, 0.28),
    new THREE.MeshPhysicalMaterial({ color: '#3f4147', metalness: 0.25, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.18 })
  );
  // 屏幕（Canvas 锁屏壁纸）
  screenCanvas = document.createElement('canvas');
  screenCanvas.width = 512; screenCanvas.height = 1080;
  screenTex = new THREE.CanvasTexture(screenCanvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.anisotropy = 4;
  screenMesh = new THREE.Mesh(
    new RoundedBoxGeometry(7.02, 14.84, 0.86, 5, 0.26),
    new THREE.MeshBasicMaterial({ map: screenTex })
  );
  phoneGroup.add(frameMesh, backMesh, screenMesh);

  // 相机模组：凸台 + 三摄 + 闪光灯
  const plateau = new THREE.Mesh(
    new RoundedBoxGeometry(3.15, 3.15, 0.14, 4, 0.1),
    new THREE.MeshPhysicalMaterial({ color: '#33363c', metalness: 0.6, roughness: 0.35, clearcoat: 0.8 })
  );
  plateau.position.set(-1.9, 5.75, -0.5);
  phoneGroup.add(plateau);
  const ringGeo = new THREE.CylinderGeometry(0.58, 0.58, 0.1, 32);
  const glassGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.12, 32);
  const ringMat = new THREE.MeshPhysicalMaterial({ color: '#c9ccd2', metalness: 1, roughness: 0.25 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: '#0a0f1e', metalness: 0.4, roughness: 0.1, clearcoat: 1 });
  const lensPos = [[-2.55, 6.4], [-1.25, 5.1], [-2.55, 5.1]];
  for (const [x, y] of lensPos) {
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, y, -0.58);
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.rotation.x = Math.PI / 2;
    glass.position.set(x, y, -0.6);
    phoneGroup.add(ring, glass);
  }
  const flash = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.08, 24),
    new THREE.MeshStandardMaterial({ color: '#f5efdc', emissive: '#8a8474', roughness: 0.3 })
  );
  flash.rotation.x = Math.PI / 2;
  flash.position.set(-1.25, 6.4, -0.58);
  phoneGroup.add(flash);

  // 侧键
  const btnMat = new THREE.MeshPhysicalMaterial({ color: '#8b8f97', metalness: 0.9, roughness: 0.4 });
  for (const [x, y, len] of [[3.72, 4.6, 1.5], [-3.72, 5.4, 0.9], [-3.72, 4.1, 1.3]]) {
    const btn = new THREE.Mesh(new RoundedBoxGeometry(0.12, len, 0.26, 2, 0.05), btnMat.clone());
    btn.position.set(x, y, 0);
    phoneGroup.add(btn);
  }

  // 手机壳
  caseMesh = new THREE.Mesh(
    new RoundedBoxGeometry(7.85, 15.65, 1.0, 5, 0.24),
    new THREE.MeshPhysicalMaterial({ color: '#f4f6f8', transparent: true, opacity: 0.26, roughness: 0.18, clearcoat: 0.5, depthWrite: false })
  );
  phoneGroup.add(caseMesh);

  phoneGroup.rotation.y = -0.35;
  scene.add(phoneGroup);

  // 地面柔影
  const sc = document.createElement('canvas');
  sc.width = sc.height = 256;
  const sctx = sc.getContext('2d');
  const g = sctx.createRadialGradient(128, 128, 10, 128, 128, 120);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = g;
  sctx.fillRect(0, 0, 256, 256);
  const shadowTex = new THREE.CanvasTexture(sc);
  shadowMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 16),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.6, depthWrite: false })
  );
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = -9.6;
  scene.add(shadowMesh);
}

/* ---------------- 联动 ---------------- */
watch(caseColorId, applyCase);
watch(caseStyleId, applyCase);
watch(bodyColorId, applyBody);
watch(wallpaperId, id => {
  const wp = WALLPAPERS.find(w => w.id === id) || WALLPAPERS[0];
  drawWallpaper(wp.stops);
});
watch(bgId, applyBg);
watch(autoRotate, v => { if (controls) controls.autoRotate = v; });

function takeShot() {
  if (!renderer) return;
  shotting.value = true;
  renderer.render(scene, camera);
  const a = document.createElement('a');
  a.href = renderer.domElement.toDataURL('image/png');
  a.download = 'my-iphone.png';
  a.click();
  setTimeout(() => { shotting.value = false; }, 500);
}

onMounted(() => {
  try {
    initScene();
    applyCase();
    applyBody();
    drawWallpaper((WALLPAPERS.find(w => w.id === wallpaperId.value) || WALLPAPERS[0]).stops);
  } catch (e) {
    webglError.value = e?.message?.includes('WebGL') ? '当前环境不支持 WebGL，无法渲染 3D 模型' : (e.message || '初始化失败');
  }
});
onUnmounted(() => {
  cancelAnimationFrame(raf);
  ro?.disconnect();
  controls?.dispose();
  scene?.traverse(o => {
    o.geometry?.dispose?.();
    if (Array.isArray(o.material)) o.material.forEach(m => { m.map?.dispose?.(); m.dispose?.(); });
    else { o.material?.map?.dispose?.(); o.material?.dispose?.(); }
  });
  renderer?.dispose();
  if (renderer?.domElement?.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
});
</script>

<template>
  <div class="ps">
    <div class="ps-stage-wrap">
      <div ref="stageEl" class="ps-stage"></div>
      <p v-if="webglError" class="ps-err">⚠ {{ webglError }}</p>
      <p class="ps-tip dim">拖拽旋转 · 滚轮缩放</p>
    </div>

    <div class="ps-panel">
      <div class="ps-group">
        <p class="ps-label">手机壳</p>
        <div class="ps-swatches">
          <button
            v-for="c in CASE_COLORS" :key="c.id"
            class="ps-swatch" :class="{ on: caseColorId === c.id }"
            :style="{ background: c.hex }" :title="c.name"
            @click="caseColorId = c.id"
          ></button>
        </div>
        <div class="ps-chips">
          <button v-for="s in CASE_STYLES" :key="s.id" class="ps-chip" :class="{ on: caseStyleId === s.id }" @click="caseStyleId = s.id">{{ s.name }}</button>
        </div>
      </div>

      <div class="ps-group">
        <p class="ps-label">机身</p>
        <div class="ps-chips">
          <button v-for="b in BODY_COLORS" :key="b.id" class="ps-chip" :class="{ on: bodyColorId === b.id }" @click="bodyColorId = b.id">
            <i class="ps-dot" :style="{ background: b.hex }"></i>{{ b.name }}
          </button>
        </div>
      </div>

      <div class="ps-group">
        <p class="ps-label">锁屏壁纸</p>
        <div class="ps-grads">
          <button
            v-for="wp in WALLPAPERS" :key="wp.id"
            class="ps-grad" :class="{ on: wallpaperId === wp.id }"
            :style="{ background: `linear-gradient(135deg, ${wp.stops.join(',')})` }"
            :title="wp.name"
            @click="wallpaperId = wp.id"
          ></button>
        </div>
      </div>

      <div class="ps-group">
        <p class="ps-label">场景背景</p>
        <div class="ps-grads">
          <button
            v-for="b in BGS" :key="b.id"
            class="ps-grad" :class="{ on: bgId === b.id }"
            :style="{ background: `linear-gradient(135deg, ${b.stops.join(',')})` }"
            :title="b.name"
            @click="bgId = b.id"
          ></button>
        </div>
      </div>

      <div class="ps-group ps-actions">
        <button class="ps-chip" :class="{ on: autoRotate }" @click="autoRotate = !autoRotate">
          <AppIcon name="repeat" :size="12" /> 自动旋转 {{ autoRotate ? '开' : '关' }}
        </button>
        <button class="btn primary" :disabled="shotting" @click="takeShot">
          <AppIcon name="download" :size="14" /> {{ shotting ? '已保存' : '截图保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ps { display: flex; gap: 16px; align-items: stretch; max-width: 1060px; margin: 0 auto; }
.ps-stage-wrap { position: relative; flex: 1; min-width: 0; }
.ps-stage {
  height: 540px;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--border);
  background: #191b1f;
  cursor: grab;
}
.ps-stage:active { cursor: grabbing; }
.ps-tip { position: absolute; left: 12px; bottom: 10px; margin: 0; font-size: 12px; opacity: 0.6; pointer-events: none; }
.ps-err { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--red); font-size: 14px; }

.ps-panel {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
}
.ps-group { display: flex; flex-direction: column; gap: 9px; }
.ps-label { margin: 0; font-size: 12.5px; color: var(--text-dim); font-weight: 600; }
.ps-swatches { display: flex; gap: 8px; flex-wrap: wrap; }
.ps-swatch {
  width: 30px; height: 30px;
  border-radius: 50%;
  border: 2px solid var(--border);
  cursor: pointer;
  transition: all 0.15s;
}
.ps-swatch.on { border-color: var(--gold); box-shadow: 0 0 0 3px rgba(242, 185, 75, 0.25); transform: scale(1.08); }
.ps-chips { display: flex; gap: 7px; flex-wrap: wrap; }
.ps-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 12.5px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-dim);
  transition: all 0.15s;
}
.ps-chip:hover { color: var(--text); }
.ps-chip.on { color: var(--gold); border-color: rgba(242, 185, 75, 0.5); background: var(--gold-soft); }
.ps-dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; border: 1px solid rgba(255,255,255,0.25); }
.ps-grads { display: flex; gap: 8px; flex-wrap: wrap; }
.ps-grad {
  width: 44px; height: 30px;
  border-radius: 8px;
  border: 2px solid var(--border);
  cursor: pointer;
  transition: all 0.15s;
}
.ps-grad.on { border-color: var(--gold); box-shadow: 0 0 0 3px rgba(242, 185, 75, 0.25); }
.ps-actions { flex-direction: row; align-items: center; flex-wrap: wrap; gap: 8px; }

@media (max-width: 860px) {
  .ps { flex-direction: column; }
  .ps-stage { height: 340px; }
  .ps-panel { width: 100%; }
}
</style>
