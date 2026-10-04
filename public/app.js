import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Application State
const state = {
  poses: [],
  currentPose: null,
  skin: {
    username: 'Steve',
    url: '/models/steve.png',
    proxyUrl: '/models/steve.png',
    model: 'classic' // 'classic' | 'slim'
  },
  settings: {
    background: 'transparent',
    resolution: 1080,
    lightIntensity: 1.2,
    rimLight: true
  }
};

// Cached 3D assets
const cachedModels = {
  classic: null,
  slim: null
};

// Three.js instances
let renderer, scene, camera, controls;
let currentCharacterModel = null;
let keyLight, fillLight, ambientLight, rimLight;
let currentTexture = null;

// Initialize App
async function init() {
  if (window.lucide) window.lucide.createIcons();

  // Load saved skin from localStorage
  const savedSkin = localStorage.getItem('mcrender_skin');
  if (savedSkin) {
    try {
      const parsed = JSON.parse(savedSkin);
      if (parsed && parsed.username) {
        state.skin = parsed;
        const nickInput = document.getElementById('nickInput');
        if (nickInput) nickInput.value = state.skin.username;
        const skinAvatar = document.getElementById('skinAvatarImg');
        if (skinAvatar) skinAvatar.src = `https://minotar.net/avatar/${encodeURIComponent(state.skin.username)}/64`;
        updateModelButtons(state.skin.model);
      }
    } catch (e) {
      console.warn('Could not parse saved skin:', e);
    }
  }

  setupEventListeners();

  // 1. Fetch poses catalogue immediately so user sees cards instantly
  fetchPoses();

  // 2. Initialize Three.js WebGL and load models in background
  try {
    initThreeJS();
    await load3DModels();
  } catch (e) {
    console.error('Three.js initialization error:', e);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// -------------------------------------------------------------
// 1. Three.js Setup
// -------------------------------------------------------------
function initThreeJS() {
  const canvas = document.getElementById('threeCanvas');
  const container = document.getElementById('canvasContainer');
  container.classList.add('transparent-bg');

  // Renderer
  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Scene
  scene = new THREE.Scene();

  // Camera
  camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 1.2, 3.8);

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 1.0, 0);
  controls.maxDistance = 10;
  controls.minDistance = 0.5;

  // Lighting
  ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);

  keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
  keyLight.position.set(2.5, 4, 3.5);
  scene.add(keyLight);

  fillLight = new THREE.DirectionalLight(0xa5b4fc, 0.6);
  fillLight.position.set(-3, 2, -1);
  scene.add(fillLight);

  rimLight = new THREE.DirectionalLight(0x34d399, 0.8);
  rimLight.position.set(0, 3, -3);
  scene.add(rimLight);

  // Resize handler
  window.addEventListener('resize', onWindowResize);
  onWindowResize();

  // Render loop
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
}

function onWindowResize() {
  const container = document.getElementById('canvasContainer');
  if (!container || !renderer || !camera) return;
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width === 0 || height === 0) return;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

// -------------------------------------------------------------
// 2. Load 3D Models
// -------------------------------------------------------------
async function load3DModels() {
  const loader = new GLTFLoader();
  
  const loadGltf = (url) => new Promise((resolve) => {
    loader.load(
      url, 
      (gltf) => resolve(gltf), 
      undefined, 
      (err) => {
        console.warn(`Failed loading 3D model ${url}:`, err);
        resolve(null);
      }
    );
  });

  try {
    const [classicGltf, slimGltf] = await Promise.all([
      loadGltf('/models/player.gltf'),
      loadGltf('/models/pfp.glb')
    ]);
    if (classicGltf && classicGltf.scene) cachedModels.classic = classicGltf.scene;
    if (slimGltf && slimGltf.scene) cachedModels.slim = slimGltf.scene;
    console.log('✅ 3D Character models loaded');
  } catch (err) {
    console.error('Error in load3DModels:', err);
  }
}

// -------------------------------------------------------------
// 3. Apply Pose and Skin to 3D Scene
// -------------------------------------------------------------
function displayPoseInStudio(pose) {
  state.currentPose = pose;

  // Update Studio Header
  document.getElementById('studioPoseTitle').textContent = pose.name || 'Minecraft Pose';
  document.getElementById('studioPoseAuthor').textContent = `Автор: ${pose.authorName || 'MCRender'}`;

  // Open Modal
  const modal = document.getElementById('studioModal');
  modal.classList.remove('hidden');
  setTimeout(() => onWindowResize(), 50);

  // Show loader
  const loader = document.getElementById('canvasLoader');
  loader.classList.remove('hidden');

  setTimeout(() => {
    buildCharacter(pose);
    loader.classList.add('hidden');
  }, 100);
}

function buildCharacter(pose) {
  // Remove existing character
  if (currentCharacterModel) {
    scene.remove(currentCharacterModel);
    currentCharacterModel = null;
  }

  const modelSource = state.skin.model === 'slim' && cachedModels.slim 
    ? cachedModels.slim 
    : cachedModels.classic;

  if (!modelSource) return;

  // Clone base scene using SkeletonUtils to properly bind bones to mesh
  currentCharacterModel = SkeletonUtils.clone(modelSource);

  // Prepare Materials
  currentCharacterModel.traverse((child) => {
    if (child.isMesh && child.material) {
      if (Array.isArray(child.material)) {
        child.material = child.material.map(m => m.clone());
      } else {
        child.material = child.material.clone();
      }
    }
  });

  // Apply Texture
  applySkinTexture(state.skin.proxyUrl || state.skin.url);

  // Apply Pose Transformations
  if (pose && pose.nodeTransformation) {
    applyNodeTransformation(currentCharacterModel, pose.nodeTransformation);
  }

  scene.add(currentCharacterModel);
  resetCamera();
}

function applyNodeTransformation(model, nodeTransformation) {
  // Map all bones by multiple name variations
  const bones = {};
  model.traverse((node) => {
    if (node.name) {
      const clean = node.name.replace(/:/g, '');
      bones[clean] = node;
      bones[node.name] = node;
      bones[clean.toLowerCase()] = node;
      bones[node.name.toLowerCase()] = node;
    }
  });

  const tempEuler = new THREE.Euler();
  const tempQuat = new THREE.Quaternion();

  for (const [boneKey, transform] of Object.entries(nodeTransformation)) {
    if (boneKey.startsWith('_') || ['Main', 'MAIN', 'Center', 'center'].includes(boneKey)) continue;
    const bone = bones[boneKey] || bones[boneKey.replace(/[:._]/g, '')] || bones[boneKey.toLowerCase()];
    if (!bone) continue;

    const { rotation, translation, scale } = transform;

    // 1. Rotation (Euler in radians XYZ)
    if (rotation && Array.isArray(rotation)) {
      tempEuler.set(rotation[0], rotation[1], rotation[2], 'XYZ');
      tempQuat.setFromEuler(tempEuler);
      bone.quaternion.copy(tempQuat);
    }

    // 2. Translation
    if (translation && Array.isArray(translation)) {
      bone.position.set(translation[0], translation[1], translation[2]);
    }

    // 3. Scale
    if (scale !== undefined) {
      const s = typeof scale === 'number' ? scale : (scale[0] || 1);
      bone.scale.set(s, s, s);
    }
  }
}

function applySkinTexture(skinUrl) {
  if (!currentCharacterModel || !skinUrl) return;

  const textureLoader = new THREE.TextureLoader();
  textureLoader.load(skinUrl, (tex) => {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    currentTexture = tex;

    currentCharacterModel.traverse((child) => {
      if (child.isMesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => {
            m.map = tex;
            m.roughness = 0.9;
            m.metalness = 0.0;
            m.transparent = true;
            m.needsUpdate = true;
          });
        } else {
          child.material.map = tex;
          child.material.roughness = 0.9;
          child.material.metalness = 0.0;
          child.material.transparent = true;
          child.material.needsUpdate = true;
        }
      }
    });
  }, undefined, (err) => {
    console.error('Error loading skin texture:', err);
    showToast('Не удалось применить текстуру скина', 'error');
  });
}

function resetCamera() {
  if (!controls || !camera) return;
  camera.position.set(0, 1.2, 3.8);
  controls.target.set(0, 1.0, 0);
  controls.update();
}

// -------------------------------------------------------------
// 4. Export High-Resolution Clean PNG (No Watermark)
// -------------------------------------------------------------
async function downloadCleanRender() {
  if (!renderer || !scene || !camera) return;

  const downloadBtn = document.getElementById('downloadRenderBtn');
  const initialText = downloadBtn.innerHTML;
  downloadBtn.disabled = true;
  downloadBtn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i><span>Генерация ${state.settings.resolution}p...</span>`;
  if (window.lucide) window.lucide.createIcons();

  try {
    const targetHeight = state.settings.resolution; // 1080, 1440, 2160
    const aspect = camera.aspect;
    const targetWidth = Math.round(targetHeight * aspect);

    // Create offscreen canvas and renderer
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = targetWidth;
    offscreenCanvas.height = targetHeight;

    const exportRenderer = new THREE.WebGLRenderer({
      canvas: offscreenCanvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    exportRenderer.outputColorSpace = THREE.SRGBColorSpace;
    exportRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    exportRenderer.toneMappingExposure = 1.0;
    exportRenderer.setSize(targetWidth, targetHeight, false);

    // Background setup
    let oldBackground = scene.background;
    if (state.settings.background === 'transparent') {
      scene.background = null;
    } else if (state.settings.background === 'dark') {
      scene.background = new THREE.Color(0x0f172a);
    } else if (state.settings.background === 'cyber') {
      scene.background = new THREE.Color(0x1e1b4b);
    } else if (state.settings.background === 'green') {
      scene.background = new THREE.Color(0x00ff00);
    }

    // Render offscreen at pristine full resolution
    exportRenderer.render(scene, camera);

    // Restore main scene background
    scene.background = oldBackground;

    // Convert to Blob and Download
    const blob = await new Promise(resolve => offscreenCanvas.toBlob(resolve, 'image/png'));
    exportRenderer.dispose();

    if (blob) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const poseName = (state.currentPose?.name || 'minecraft_pose')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/gi, '_');
      link.download = `${poseName}_${state.skin.username}_${state.settings.resolution}p.png`;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast(`Рендер в ${state.settings.resolution}p успешно скачан!`, 'success');
    } else {
      throw new Error('Не удалось создать файл изображения');
    }
  } catch (err) {
    console.error('Export error:', err);
    showToast('Ошибка при экспорте изображения: ' + err.message, 'error');
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.innerHTML = initialText;
    if (window.lucide) window.lucide.createIcons();
  }
}

// -------------------------------------------------------------
// 5. Skin Lookup and Management
// -------------------------------------------------------------
async function applyUsernameSkin(username) {
  if (!username) return;
  username = username.trim();

  showToast(`Загрузка скина игрока "${username}"...`, 'info');

  try {
    const res = await fetch(`/api/skin/resolve?username=${encodeURIComponent(username)}`);
    const data = await res.json();

    if (data.success) {
      state.skin.username = data.username;
      state.skin.url = data.skinUrl;
      state.skin.proxyUrl = data.proxyUrl;
      state.skin.model = data.model || 'classic';

      // Save to localStorage
      localStorage.setItem('mcrender_skin', JSON.stringify(state.skin));

      // Update UI avatar
      const avatarUrl = `https://minotar.net/avatar/${encodeURIComponent(username)}/64`;
      document.getElementById('skinAvatarImg').src = avatarUrl;
      document.getElementById('nickInput').value = username;
      const studioNick = document.getElementById('studioNickInput');
      if (studioNick) studioNick.value = username;

      // Update all card links to pass current nickname
      updateCardLinks();

      // Update model buttons
      updateModelButtons(state.skin.model);

      // Apply to 3D character
      if (state.currentPose) {
        buildCharacter(state.currentPose);
      }

      showToast(`Скин "${username}" применен (${state.skin.model})!`, 'success');
    } else {
      showToast('Игрок не найден, используется стандартный скин', 'error');
    }
  } catch (err) {
    console.error('Skin fetch error:', err);
    showToast('Ошибка при получении скина', 'error');
  }
}

function updateCardLinks() {
  const currentNick = encodeURIComponent(state.skin.username || 'Steve');
  document.querySelectorAll('a[href^="/p/"]').forEach(link => {
    const href = link.getAttribute('href');
    if (!href) return;
    const baseSlug = href.split('?')[0];
    link.setAttribute('href', `${baseSlug}?nick=${currentNick}`);
  });
}

function updateModelButtons(model) {
  const classicBtn = document.getElementById('modelClassicBtn');
  const slimBtn = document.getElementById('modelSlimBtn');
  if (model === 'slim') {
    slimBtn.className = 'px-2 py-0.5 rounded-full font-medium transition-all bg-brand-600 text-white';
    classicBtn.className = 'px-2 py-0.5 rounded-full font-medium transition-all text-gray-400 hover:text-white';
  } else {
    classicBtn.className = 'px-2 py-0.5 rounded-full font-medium transition-all bg-brand-600 text-white';
    slimBtn.className = 'px-2 py-0.5 rounded-full font-medium transition-all text-gray-400 hover:text-white';
  }
}

async function uploadCustomSkin(file) {
  if (!file) return;

  const formData = new FormData();
  formData.append('skin', file);
  formData.append('model', state.skin.model);

  showToast('Загрузка пользовательского скина...', 'info');

  try {
    const res = await fetch('/api/upload-skin', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      state.skin.username = 'Custom';
      state.skin.url = data.skinUrl;
      state.skin.proxyUrl = data.proxyUrl;

      // Local preview
      const objectUrl = URL.createObjectURL(file);
      document.getElementById('skinAvatarImg').src = objectUrl;
      document.getElementById('nickInput').value = 'Custom';

      if (state.currentPose) {
        buildCharacter(state.currentPose);
      }

      showToast('Пользовательский скин успешно установлен!', 'success');
    } else {
      showToast('Ошибка загрузки скина', 'error');
    }
  } catch (err) {
    console.error('Upload error:', err);
    showToast('Ошибка загрузки файла скина', 'error');
  }
}

// -------------------------------------------------------------
// 6. Pose Gallery & Import
// -------------------------------------------------------------
async function fetchPoses() {
  try {
    const res = await fetch('/api/poses');
    const data = await res.json();
    if (data.success) {
      state.poses = data.poses;
      renderPoses(state.poses);
    }
  } catch (err) {
    console.error('Error fetching poses:', err);
    showToast('Ошибка загрузки каталога поз', 'error');
  }
}

function renderPoses(posesToRender) {
  const grid = document.getElementById('posesGrid');
  const countBadge = document.getElementById('posesCountBadge');
  countBadge.textContent = posesToRender.length;

  if (posesToRender.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-16 text-center text-gray-500">
        <i data-lucide="inbox" class="w-10 h-10 mx-auto mb-2 text-gray-600"></i>
        <p class="text-sm font-semibold text-gray-400">Позы не найдены</p>
        <p class="text-xs text-gray-500 mt-1">Вставьте ссылку выше, чтобы импортировать позу с mcrender.net</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  grid.innerHTML = posesToRender.map(pose => {
    const preview = pose.imageUrl || 'https://www.mcrender.net/og/main-og.png';
    const author = pose.authorName || 'creator';
    const views = pose.viewCount || 0;
    const isSpecial = pose.slug === 'hehe-673e6a2d';

    const currentNick = encodeURIComponent(state.skin.username || 'Steve');
    return `
      <div class="pose-card group bg-gray-900/90 border ${isSpecial ? 'border-brand-500 shadow-lg shadow-brand-500/10' : 'border-gray-800'} hover:border-brand-500/60 rounded-2xl overflow-hidden flex flex-col">
        <!-- Thumbnail Preview -->
        <a href="/p/${pose.slug}?nick=${currentNick}" target="_blank" class="aspect-[4/3] bg-gray-950 relative overflow-hidden flex items-center justify-center cursor-pointer block">
          <img 
            src="${preview}" 
            alt="${pose.name}" 
            loading="lazy"
            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onerror="this.src='/models/steve.png'"
          >
          <div class="absolute inset-0 bg-gradient-to-t from-gray-950 via-transparent to-transparent opacity-80"></div>
          
          ${isSpecial ? `
            <span class="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full bg-brand-500 text-white font-bold text-[10px] uppercase tracking-wider shadow">
              Выбор автора
            </span>
          ` : ''}

          <!-- Quick Action Overlay -->
          <div class="absolute inset-0 bg-brand-500/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <span class="px-3.5 py-1.5 rounded-full bg-brand-600 text-white font-semibold text-xs shadow-lg flex items-center gap-1.5">
              <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
              <span>Открыть в новой вкладке</span>
            </span>
          </div>
        </a>

        <!-- Meta info -->
        <div class="p-4 flex-1 flex flex-col justify-between">
          <div>
            <div class="flex items-start justify-between gap-2 mb-1">
              <a href="/p/${pose.slug}?nick=${currentNick}" target="_blank" class="font-bold text-sm text-white truncate group-hover:text-brand-400 transition-colors" title="${pose.name}">
                ${pose.name}
              </a>
              <button class="delete-pose-btn text-gray-500 hover:text-red-400 p-1 rounded transition-colors" data-slug="${pose.slug}" title="Удалить позу">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
            <div class="flex items-center gap-2 text-xs text-gray-400 mb-3">
              <span>Автор: <strong class="text-gray-300 font-medium">${author}</strong></span>
              ${views > 0 ? `<span>• ${views} просм.</span>` : ''}
            </div>
          </div>

          <!-- Bottom Button -->
          <a 
            href="/p/${pose.slug}?nick=${currentNick}" 
            target="_blank"
            class="w-full py-2.5 px-3 rounded-xl bg-gray-800 hover:bg-brand-600 text-gray-200 hover:text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm"
          >
            <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
            <span>Открыть в 3D Студии</span>
          </a>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();

  // Attach card triggers
  document.querySelectorAll('.open-pose-trigger').forEach(el => {
    el.addEventListener('click', () => {
      const slug = el.getAttribute('data-slug');
      window.open(`/p/${slug}`, '_blank');
    });
  });

  // Attach delete triggers
  document.querySelectorAll('.delete-pose-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const slug = btn.getAttribute('data-slug');
      if (confirm(`Удалить позу "${slug}"?`)) {
        await deletePose(slug);
      }
    });
  });
}

async function deletePose(slug) {
  try {
    const res = await fetch(`/api/poses/${slug}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      state.poses = state.poses.filter(p => p.slug !== slug);
      renderPoses(state.poses);
      showToast('Поза удалена', 'info');
    }
  } catch (err) {
    showToast('Ошибка при удалении позы', 'error');
  }
}

async function importPose(url) {
  const statusEl = document.getElementById('importStatus');
  const importBtn = document.getElementById('importBtn');
  const initialText = importBtn.innerHTML;

  importBtn.disabled = true;
  importBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Импорт...</span>`;
  if (window.lucide) window.lucide.createIcons();

  statusEl.className = 'mt-3 text-xs p-3 rounded-xl border bg-brand-500/10 border-brand-500/30 text-brand-300 flex items-center gap-2';
  statusEl.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Импортируем данные позы с mcrender.net...</span>`;
  statusEl.classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();

  try {
    const res = await fetch('/api/import-pose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();

    if (data.success && data.pose) {
      const newPose = data.pose;
      // Add or replace
      state.poses = state.poses.filter(p => p.slug !== newPose.slug);
      state.poses.unshift(newPose);
      renderPoses(state.poses);

      statusEl.className = 'mt-3 text-xs p-3 rounded-xl border bg-emerald-500/15 border-emerald-500/30 text-emerald-400 flex items-center justify-between';
      statusEl.innerHTML = `
        <div class="flex items-center gap-2">
          <i data-lucide="check-circle" class="w-4 h-4 text-emerald-400"></i>
          <span>Поза <strong>"${newPose.name}"</strong> успешно импортирована и сохранена на главном меню!</span>
        </div>
        <button id="openImportedBtn" class="px-2.5 py-1 rounded-lg bg-emerald-500 text-gray-950 font-bold text-[11px] hover:bg-emerald-400">Открыть сейчас</button>
      `;
      if (window.lucide) window.lucide.createIcons();

      document.getElementById('openImportedBtn').onclick = () => {
        window.open(`/p/${newPose.slug}`, '_blank');
      };

      showToast(`Поза "${newPose.name}" импортирована!`, 'success');
      document.getElementById('poseUrlInput').value = '';
    } else {
      throw new Error(data.error || 'Не удалось получить позу');
    }
  } catch (err) {
    statusEl.className = 'mt-3 text-xs p-3 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 flex items-center gap-2';
    statusEl.innerHTML = `<i data-lucide="alert-circle" class="w-4 h-4 text-red-400"></i><span>Ошибка: ${err.message}</span>`;
    if (window.lucide) window.lucide.createIcons();
    showToast('Ошибка импорта: ' + err.message, 'error');
  } finally {
    importBtn.disabled = false;
    importBtn.innerHTML = initialText;
    if (window.lucide) window.lucide.createIcons();
  }
}

// -------------------------------------------------------------
// 7. Event Listeners Setup
// -------------------------------------------------------------
function setupEventListeners() {
  // Import Form
  document.getElementById('importForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = document.getElementById('poseUrlInput').value.trim();
    if (url) importPose(url);
  });

  // Nickname Apply with auto-debounce
  let debounceTimer = null;
  const nickInput = document.getElementById('nickInput');
  if (nickInput) {
    nickInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      const val = e.target.value.trim();
      if (!val || val.length < 3 || val.toLowerCase() === (state.skin.username || '').toLowerCase()) return;
      debounceTimer = setTimeout(() => {
        applyUsernameSkin(val);
      }, 650);
    });
    nickInput.addEventListener('change', (e) => {
      clearTimeout(debounceTimer);
      const val = e.target.value.trim();
      if (val) applyUsernameSkin(val);
    });
    nickInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(debounceTimer);
        const nick = nickInput.value.trim();
        if (nick) applyUsernameSkin(nick);
      }
    });
  }

  const applyNickBtn = document.getElementById('applyNickBtn');
  if (applyNickBtn) {
    applyNickBtn.addEventListener('click', () => {
      clearTimeout(debounceTimer);
      const nick = nickInput ? nickInput.value.trim() : '';
      if (nick) applyUsernameSkin(nick);
    });
  }

  // Studio Nickname Apply
  document.getElementById('studioNickApplyBtn').addEventListener('click', () => {
    const nick = document.getElementById('studioNickInput').value.trim();
    if (nick) applyUsernameSkin(nick);
  });

  // Quick Nickname clicks
  document.querySelectorAll('.quick-nick').forEach(btn => {
    btn.addEventListener('click', () => {
      const nick = btn.textContent.trim();
      document.getElementById('nickInput').value = nick;
      document.getElementById('studioNickInput').value = nick;
      applyUsernameSkin(nick);
    });
  });

  // Custom Skin Upload
  document.getElementById('skinFileInput').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      uploadCustomSkin(e.target.files[0]);
    }
  });

  // Model Type Buttons
  document.getElementById('modelClassicBtn').addEventListener('click', () => {
    state.skin.model = 'classic';
    updateModelButtons('classic');
    if (state.currentPose) buildCharacter(state.currentPose);
  });
  document.getElementById('modelSlimBtn').addEventListener('click', () => {
    state.skin.model = 'slim';
    updateModelButtons('slim');
    if (state.currentPose) buildCharacter(state.currentPose);
  });

  // Close Studio Modal
  document.getElementById('closeStudioBtn').addEventListener('click', () => {
    document.getElementById('studioModal').classList.add('hidden');
  });

  // Reset Camera Button
  document.getElementById('resetCamBtn').addEventListener('click', resetCamera);

  // Background Selection
  document.querySelectorAll('.bg-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bg-option').forEach(b => {
        b.className = 'bg-option px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border border-gray-800 bg-gray-900 text-gray-400 hover:text-white transition-all';
      });
      btn.className = 'bg-option active px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border border-brand-500 bg-brand-500/10 text-brand-400 transition-all';
      
      const bgType = btn.getAttribute('data-bg');
      state.settings.background = bgType;
      
      const container = document.getElementById('canvasContainer');
      container.className = 'flex-1 relative overflow-hidden flex items-center justify-center';
      if (bgType === 'transparent') container.classList.add('transparent-bg');
      else if (bgType === 'dark') container.classList.add('dark-bg');
      else if (bgType === 'cyber') container.classList.add('cyber-bg');
      else if (bgType === 'green') container.classList.add('green-bg');
    });
  });

  // Resolution Buttons
  document.querySelectorAll('.res-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.res-btn').forEach(b => {
        b.className = 'res-btn py-2 rounded-lg text-xs font-semibold border border-gray-800 bg-gray-900 text-gray-400 text-center hover:text-white';
      });
      btn.className = 'res-btn active py-2 rounded-lg text-xs font-semibold border border-brand-500 bg-brand-500/10 text-brand-400 text-center';
      state.settings.resolution = parseInt(btn.getAttribute('data-res'), 10);
    });
  });

  // Lighting Controls
  document.getElementById('lightIntensity').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('lightIntensityVal').textContent = `${val.toFixed(1)}x`;
    if (keyLight) keyLight.intensity = val * 1.1;
    if (ambientLight) ambientLight.intensity = val * 0.6;
  });

  document.getElementById('rimLightToggle').addEventListener('change', (e) => {
    if (rimLight) rimLight.visible = e.target.checked;
  });

  // Download Button
  document.getElementById('downloadRenderBtn').addEventListener('click', downloadCleanRender);

  // Search Filter
  document.getElementById('searchPosesInput').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderPoses(state.poses);
    } else {
      const filtered = state.poses.filter(p => 
        (p.name && p.name.toLowerCase().includes(q)) || 
        (p.slug && p.slug.toLowerCase().includes(q)) ||
        (p.authorName && p.authorName.toLowerCase().includes(q))
      );
      renderPoses(filtered);
    }
  });
}

// -------------------------------------------------------------
// 8. Toast Notifications
// -------------------------------------------------------------
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  
  const bg = type === 'success' ? 'bg-emerald-600 border-emerald-500' :
             type === 'error' ? 'bg-red-600 border-red-500' :
             'bg-gray-800 border-gray-700';

  const icon = type === 'success' ? 'check-circle' :
               type === 'error' ? 'alert-triangle' :
               'info';

  toast.className = `${bg} border text-white text-xs font-medium px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 transform transition-all duration-300 translate-y-4 opacity-0 pointer-events-auto`;
  toast.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4"></i><span>${message}</span>`;
  container.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-4', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('translate-y-4', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
