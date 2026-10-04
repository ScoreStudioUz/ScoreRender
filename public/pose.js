import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Application State
const state = {
  slug: 'hehe-673e6a2d',
  pose: null,
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

const cachedModels = {
  classic: null,
  slim: null
};

let renderer, scene, camera, controls;
let currentCharacterModel = null;
let keyLight, fillLight, ambientLight, rimLight;

// -------------------------------------------------------------
// Initialization
// -------------------------------------------------------------
async function init() {
  if (window.lucide) window.lucide.createIcons();

  // 1. Extract slug from URL path: /p/:slug or query ?slug=...
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  if (pathParts.length > 0 && pathParts[0] === 'p' && pathParts[1]) {
    state.slug = pathParts[1];
  } else {
    const urlParams = new URLSearchParams(window.location.search);
    state.slug = urlParams.get('slug') || 'hehe-673e6a2d';
  }

  // 2. Check URL param for nickname or load saved skin from localStorage
  const urlParams = new URLSearchParams(window.location.search);
  const requestedNick = urlParams.get('nick') || urlParams.get('username');

  const savedSkin = localStorage.getItem('mcrender_skin');
  if (savedSkin) {
    try {
      const parsed = JSON.parse(savedSkin);
      if (parsed && parsed.url) {
        state.skin = parsed;
      }
    } catch (e) {
      console.warn('Could not parse saved skin:', e);
    }
  }

  if (requestedNick && requestedNick.trim()) {
    state.skin.username = requestedNick.trim();
  }

  // Sync inputs and avatars
  const currentNick = state.skin.username || 'Steve';
  const avatarUrl = `https://minotar.net/avatar/${encodeURIComponent(currentNick)}/64`;

  const nickInput = document.getElementById('nickInput');
  if (nickInput) nickInput.value = currentNick;
  const topNickInput = document.getElementById('topNickInput');
  if (topNickInput) topNickInput.value = currentNick;

  const skinAvatar = document.getElementById('skinAvatarImg');
  if (skinAvatar) skinAvatar.src = avatarUrl;
  const topSkinAvatar = document.getElementById('topSkinAvatarImg');
  if (topSkinAvatar) topSkinAvatar.src = avatarUrl;

  const badge = document.getElementById('currentModelBadge');
  if (badge) badge.textContent = state.skin.model === 'slim' ? 'Slim (3px)' : 'Classic (4px)';
  updateModelButtons(state.skin.model);

  setupEventListeners();

  // Load pose and 3D models in parallel
  await Promise.all([
    fetchCurrentPose(state.slug),
    load3DModels()
  ]);

  // If a specific nickname was requested via URL, resolve its real texture
  if (requestedNick && requestedNick.trim() && requestedNick.toLowerCase() !== 'steve') {
    applyUsernameSkin(requestedNick.trim());
  } else if (state.skin.username && state.skin.username.toLowerCase() !== 'steve' && state.skin.proxyUrl === '/models/steve.png') {
    applyUsernameSkin(state.skin.username);
  }

  initThreeJS();
  if (state.pose) {
    buildCharacter(state.pose);
  }

  // Load related poses
  loadRelatedPoses();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// -------------------------------------------------------------
// 1. Fetch Pose Data
// -------------------------------------------------------------
async function fetchCurrentPose(slug) {
  try {
    const res = await fetch(`/api/pose/${slug}`);
    const data = await res.json();
    if (data.success && data.pose) {
      state.pose = data.pose;
      updatePageMeta(state.pose);
    } else {
      showToast('Поза не найдена в каталоге', 'error');
    }
  } catch (err) {
    console.error('Error fetching pose:', err);
    showToast('Ошибка при загрузке данных позы', 'error');
  }
}

function updatePageMeta(pose) {
  document.title = `${pose.name || 'Pose'} by ${pose.authorName || 'creator'} — MCRender Studio`;
  document.getElementById('poseTitle').textContent = pose.name || 'Minecraft Pose';
  document.getElementById('breadcrumbPose').textContent = pose.name || 'Pose';
  document.getElementById('breadcrumbAuthor').textContent = pose.authorName || 'creator';
  document.getElementById('authorName').textContent = pose.authorName || 'creator';
  document.getElementById('poseSubtitle').innerHTML = `Создана автором <strong class="text-gray-200">${pose.authorName || 'creator'}</strong> • Рендеров: ${pose.renderCount || 0}`;
}

// -------------------------------------------------------------
// 2. Three.js Viewport
// -------------------------------------------------------------
function initThreeJS() {
  const canvas = document.getElementById('threeCanvas');
  const container = document.getElementById('canvasContainer');
  container.classList.add('transparent-bg');

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

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(36, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(1.15, 1.15, 2.45);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.85;
  controls.panSpeed = 0.85;
  controls.zoomSpeed = 0.95;
  controls.target.set(0, 0.62, 0);
  controls.maxDistance = 6.0;
  controls.minDistance = 0.8;
  controls.maxPolarAngle = Math.PI / 2 + 0.25;

  // Lighting
  ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(ambientLight);

  keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
  keyLight.position.set(2.5, 4, 3.5);
  scene.add(keyLight);

  fillLight = new THREE.DirectionalLight(0xa5b4fc, 0.6);
  fillLight.position.set(-3, 2, -1);
  scene.add(fillLight);

  rimLight = new THREE.DirectionalLight(0x34d399, 0.85);
  rimLight.position.set(0, 3, -3);
  scene.add(rimLight);

  window.addEventListener('resize', onWindowResize);
  onWindowResize();

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
// 3. Load 3D Models
// -------------------------------------------------------------
async function load3DModels() {
  const loader = new GLTFLoader();
  const loadGltf = (url) => new Promise((resolve) => {
    loader.load(url, resolve, undefined, (err) => {
      console.warn('Failed loading 3D model:', url, err);
      resolve(null);
    });
  });

  const [classicGltf, slimGltf] = await Promise.all([
    loadGltf('/models/player.gltf'),
    loadGltf('/models/pfp.glb')
  ]);

  if (classicGltf && classicGltf.scene) cachedModels.classic = classicGltf.scene;
  if (slimGltf && slimGltf.scene) cachedModels.slim = slimGltf.scene;
}

// -------------------------------------------------------------
// 4. Rigging and Skin Mapping
// -------------------------------------------------------------
function buildCharacter(pose) {
  const loader = document.getElementById('canvasLoader');
  if (loader) loader.classList.remove('hidden');

  if (currentCharacterModel) {
    scene.remove(currentCharacterModel);
    currentCharacterModel = null;
  }

  const modelSource = state.skin.model === 'slim' && cachedModels.slim 
    ? cachedModels.slim 
    : cachedModels.classic;

  if (!modelSource) {
    if (loader) loader.classList.add('hidden');
    return;
  }

  // Use SkeletonUtils.clone to properly rebind bone hierarchies to skinned mesh vertices!
  currentCharacterModel = SkeletonUtils.clone(modelSource);

  // Critical fix: reset root armature position (pfp.glb has an embedded [0, 0, 3.88] offset)
  currentCharacterModel.traverse((node) => {
    if (node.name && (node.name.includes('arma') || node.name.includes('SimplePlayerarma'))) {
      node.position.set(0, 0, 0);
    }
  });

  // Prepare meshes and prevent frustum culling
  currentCharacterModel.traverse((child) => {
    if (child.isMesh) {
      child.frustumCulled = false;
      if (child.geometry) {
        child.geometry.computeBoundingSphere();
        if (child.geometry.boundingSphere) {
          child.geometry.boundingSphere.radius = Math.max(3 * child.geometry.boundingSphere.radius, 5.0);
        }
      }
    }
  });

  // Apply Pose Transformations first
  if (pose && pose.nodeTransformation) {
    applyNodeTransformation(currentCharacterModel, pose.nodeTransformation);
  }

  // Apply Texture using mcrender shader materials
  applySkinTexture(state.skin.proxyUrl || state.skin.url);

  scene.add(currentCharacterModel);
  resetCamera();

  setTimeout(() => {
    if (loader) loader.classList.add('hidden');
  }, 100);
}

function applyNodeTransformation(model, nodeTransformation) {
  // Map bones by name with and without colons
  const bones = {};
  model.traverse((node) => {
    if (node.isBone || node.type === 'Bone') {
      const clean = node.name.replace(/[:._]/g, '');
      bones[clean] = node;
      bones[node.name] = node;
      bones[clean.toLowerCase()] = node;
      bones[node.name.toLowerCase()] = node;
    }
  });

  const tempEuler = new THREE.Euler();
  const tempQuat = new THREE.Quaternion();

  for (const [boneKey, transform] of Object.entries(nodeTransformation)) {
    // Skip special meta-properties and GLTF root coordinate orientation bones (Main, Center)
    if (boneKey.startsWith('_') || ['Main', 'MAIN', 'Center', 'center'].includes(boneKey)) {
      continue;
    }

    const bone = bones[boneKey] || bones[boneKey.replace(/[:._]/g, '')] || bones[boneKey.toLowerCase()];
    if (!bone) {
      continue;
    }

    const { rotation, translation, scale } = transform;

    // 1. Rotation in radians XYZ
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

  // Update matrices and skeletons
  model.updateMatrixWorld(true);
  model.traverse((child) => {
    if (child.isSkinnedMesh && child.skeleton) {
      child.skeleton.update();
    }
  });
}

function applySkinTexture(skinUrl) {
  if (!currentCharacterModel || !skinUrl) return;

  const textureLoader = new THREE.TextureLoader();
  textureLoader.load(
    skinUrl,
    (tex) => {
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;

      currentCharacterModel.traverse((child) => {
        if (child.isMesh && child.material) {
          const setupMat = (m) => {
            m.map = tex;
            m.color.set(0xffffff); // Pure white so texture is not dimmed by GLTF baseColorFactor
            m.roughness = 0.85;
            m.metalness = 0.0;
            if (m.name.toLowerCase().includes('alpha') || (child.name && child.name.toLowerCase().includes('layer2'))) {
              m.transparent = true;
              m.alphaTest = 0.5; // Discards fully transparent pixels on second layer
              m.depthWrite = true;
            }
            m.needsUpdate = true;
          };

          if (Array.isArray(child.material)) {
            child.material.forEach(setupMat);
          } else {
            setupMat(child.material);
          }
        }
      });
    },
    undefined,
    (err) => {
      console.warn('Failed loading skin texture, trying fallback:', skinUrl, err);
      if (!skinUrl.includes('minotar.net')) {
        applySkinTexture(`https://minotar.net/skin/${encodeURIComponent(state.skin.username || 'Steve')}`);
      }
    }
  );
}

function setCameraView(preset = 'iso') {
  if (!controls || !camera) return;
  const target = new THREE.Vector3(0, 0.62, 0);
  let pos = new THREE.Vector3(1.15, 1.15, 2.45);

  if (preset === 'front') {
    pos.set(0, 0.72, 2.65);
  } else if (preset === 'side') {
    pos.set(2.65, 0.72, 0);
  } else if (preset === 'center') {
    // Keep current direction vector from center but ensure target is at character center (0, 0.62, 0)
    const currentOffset = camera.position.clone().sub(controls.target);
    pos.copy(target).add(currentOffset);
  }

  controls.target.copy(target);
  camera.position.copy(pos);
  controls.update();

  // Update preset button styles
  const btnMap = {
    iso: 'camIsoBtn',
    front: 'camFrontBtn',
    side: 'camSideBtn'
  };

  ['camIsoBtn', 'camFrontBtn', 'camSideBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (btnMap[preset] === id) {
      el.className = 'px-3 py-1.5 rounded-xl bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm';
    } else {
      el.className = 'px-2.5 py-1.5 rounded-xl hover:bg-gray-800 text-gray-300 hover:text-white text-xs font-medium flex items-center gap-1 transition-all';
    }
  });
}

function resetCamera() {
  setCameraView('iso');
}

// -------------------------------------------------------------
// 5. Clean High-Res Render Export (NO WATERMARK)
// -------------------------------------------------------------
async function downloadCleanRender() {
  if (!renderer || !scene || !camera) return;

  const downloadBtn = document.getElementById('downloadRenderBtn');
  const initialText = downloadBtn.innerHTML;
  downloadBtn.disabled = true;
  downloadBtn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i><span>Рендеринг в ${state.settings.resolution}p...</span>`;
  if (window.lucide) window.lucide.createIcons();

  try {
    const targetHeight = state.settings.resolution;
    const aspect = camera.aspect;
    const targetWidth = Math.round(targetHeight * aspect);

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

    const exportCamera = camera.clone();
    exportCamera.aspect = aspect;
    exportCamera.updateProjectionMatrix();

    exportRenderer.render(scene, exportCamera);
    scene.background = oldBackground;

    const blob = await new Promise(resolve => offscreenCanvas.toBlob(resolve, 'image/png'));
    exportRenderer.dispose();

    if (blob) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const poseName = (state.pose?.name || 'minecraft_pose')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/gi, '_');
      link.download = `${poseName}_${state.skin.username}_${state.settings.resolution}p.png`;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast(`Чистый рендер в ${state.settings.resolution}p успешно сохранен!`, 'success');
    }
  } catch (err) {
    console.error('Export error:', err);
    showToast('Ошибка при экспорте изображения', 'error');
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.innerHTML = initialText;
    if (window.lucide) window.lucide.createIcons();
  }
}

// -------------------------------------------------------------
// 6. Skin Resolving & Saving
// -------------------------------------------------------------
async function applyUsernameSkin(username) {
  if (!username) return;
  username = username.trim();
  
  const loadingIndicator = document.getElementById('topSkinLoading');
  if (loadingIndicator) {
    loadingIndicator.classList.remove('hidden');
    loadingIndicator.classList.add('flex');
  }

  try {
    const res = await fetch(`/api/skin/resolve?username=${encodeURIComponent(username)}`);
    const data = await res.json();

    if (data.success) {
      const modelChanged = state.skin.model !== (data.model || 'classic');
      state.skin.username = data.username;
      state.skin.url = data.skinUrl;
      state.skin.proxyUrl = data.proxyUrl;
      state.skin.model = data.model || 'classic';

      // Save to localStorage
      localStorage.setItem('mcrender_skin', JSON.stringify(state.skin));

      // Update URL query parameter without full reload
      try {
        const u = new URL(window.location.href);
        u.searchParams.set('nick', data.username);
        window.history.replaceState({}, '', u.toString());
      } catch (e) {}

      // Update UI avatars and inputs in both sidebar and canvas top bar
      const avatarUrl = `https://minotar.net/avatar/${encodeURIComponent(username)}/64`;
      
      const avatarImg = document.getElementById('skinAvatarImg');
      if (avatarImg) avatarImg.src = avatarUrl;
      const topAvatarImg = document.getElementById('topSkinAvatarImg');
      if (topAvatarImg) topAvatarImg.src = avatarUrl;

      const nickInput = document.getElementById('nickInput');
      if (nickInput && nickInput.value !== username) nickInput.value = username;
      const topNickInput = document.getElementById('topNickInput');
      if (topNickInput && topNickInput.value !== username) topNickInput.value = username;

      const badge = document.getElementById('currentModelBadge');
      if (badge) badge.textContent = state.skin.model === 'slim' ? 'Slim (3px)' : 'Classic (4px)';

      updateModelButtons(state.skin.model);

      // If model type changed (classic vs slim) or character not yet created, rebuild
      if (modelChanged || !currentCharacterModel) {
        if (state.pose) buildCharacter(state.pose);
      } else {
        // Seamlessly update skin texture without resetting camera or glitching!
        applySkinTexture(state.skin.proxyUrl || state.skin.url);
      }

      showToast(`Скин "${username}" применен!`, 'success');
    }
  } catch (err) {
    console.error('Skin fetch error:', err);
    showToast('Ошибка получения скина', 'error');
  } finally {
    if (loadingIndicator) {
      loadingIndicator.classList.add('hidden');
      loadingIndicator.classList.remove('flex');
    }
  }
}

function updateModelButtons(model) {
  const classicBtn = document.getElementById('modelClassicBtn');
  const slimBtn = document.getElementById('modelSlimBtn');
  if (!classicBtn || !slimBtn) return;
  if (model === 'slim') {
    slimBtn.className = 'px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-all bg-brand-600 text-white';
    classicBtn.className = 'px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-all text-gray-400 hover:text-white';
  } else {
    classicBtn.className = 'px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-all bg-brand-600 text-white';
    slimBtn.className = 'px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-all text-gray-400 hover:text-white';
  }
}

async function uploadCustomSkin(file) {
  if (!file) return;
  const formData = new FormData();
  formData.append('skin', file);
  formData.append('model', state.skin.model);

  showToast('Загрузка кастомного скина...', 'info');

  try {
    const res = await fetch('/api/upload-skin', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      state.skin.username = 'Custom';
      state.skin.url = data.skinUrl;
      state.skin.proxyUrl = data.proxyUrl;

      // Save to localStorage
      localStorage.setItem('mcrender_skin', JSON.stringify(state.skin));

      const previewUrl = URL.createObjectURL(file);
      const avatar = document.getElementById('skinAvatarImg');
      if (avatar) avatar.src = previewUrl;
      const topAvatar = document.getElementById('topSkinAvatarImg');
      if (topAvatar) topAvatar.src = previewUrl;

      const nickInput = document.getElementById('nickInput');
      if (nickInput) nickInput.value = 'Custom';
      const topNickInput = document.getElementById('topNickInput');
      if (topNickInput) topNickInput.value = 'Custom';

      if (state.pose) {
        buildCharacter(state.pose);
      }
      showToast('Скин успешно установлен и сохранен!', 'success');
    }
  } catch (err) {
    showToast('Ошибка загрузки файла скина', 'error');
  }
}

// -------------------------------------------------------------
// 7. Related Poses Grid (Bottom section)
// -------------------------------------------------------------
async function loadRelatedPoses() {
  try {
    const res = await fetch('/api/poses');
    const data = await res.json();
    if (data.success && data.poses) {
      const related = data.poses.filter(p => p.slug !== state.slug).slice(0, 12);
      const container = document.getElementById('relatedPosesGrid');
      const currentNick = encodeURIComponent(state.skin.username || 'Steve');
      
      container.innerHTML = related.map(p => `
        <a href="/p/${p.slug}?nick=${currentNick}" target="_blank" class="group bg-gray-950/80 border border-gray-800/80 hover:border-brand-500/60 rounded-xl overflow-hidden flex flex-col transition-all hover:-translate-y-1 shadow-md">
          <div class="aspect-[4/3] bg-gray-900 overflow-hidden relative">
            <img 
              src="${p.imageUrl || '/models/steve.png'}" 
              alt="${p.name}" 
              loading="lazy"
              class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            >
          </div>
          <div class="p-2.5">
            <h4 class="text-xs font-bold text-white truncate group-hover:text-brand-400 transition-colors">${p.name}</h4>
            <p class="text-[10px] text-gray-400 mt-0.5">${p.authorName || 'creator'}</p>
          </div>
        </a>
      `).join('');
    }
  } catch (err) {
    console.error('Related poses error:', err);
  }
}

// -------------------------------------------------------------
// 8. Event Listeners Setup
// -------------------------------------------------------------
function setupEventListeners() {
  // Automatic debounced skin applying (650ms after user stops typing)
  let debounceTimer = null;
  const onNickType = (val) => {
    clearTimeout(debounceTimer);
    if (!val || val.trim().length < 3) return;
    const clean = val.trim();
    if (clean.toLowerCase() === (state.skin.username || '').toLowerCase()) return;

    const loadingIndicator = document.getElementById('topSkinLoading');
    if (loadingIndicator) {
      loadingIndicator.classList.remove('hidden');
      loadingIndicator.classList.add('flex');
    }

    debounceTimer = setTimeout(() => {
      applyUsernameSkin(clean);
    }, 650);
  };

  // Sidebar Nick apply
  const applyNickBtn = document.getElementById('applyNickBtn');
  const nickInput = document.getElementById('nickInput');
  if (applyNickBtn && nickInput) {
    applyNickBtn.addEventListener('click', () => {
      clearTimeout(debounceTimer);
      applyUsernameSkin(nickInput.value);
    });
    nickInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(debounceTimer);
        applyUsernameSkin(nickInput.value);
      }
    });
    nickInput.addEventListener('input', (e) => onNickType(e.target.value));
    nickInput.addEventListener('change', (e) => applyUsernameSkin(e.target.value));
  }

  // Top Canvas Quick Nick apply
  const topApplyNickBtn = document.getElementById('topApplyNickBtn');
  const topNickInput = document.getElementById('topNickInput');
  if (topApplyNickBtn && topNickInput) {
    topApplyNickBtn.addEventListener('click', () => {
      clearTimeout(debounceTimer);
      applyUsernameSkin(topNickInput.value);
    });
    topNickInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(debounceTimer);
        applyUsernameSkin(topNickInput.value);
      }
    });
    topNickInput.addEventListener('input', (e) => onNickType(e.target.value));
    topNickInput.addEventListener('change', (e) => applyUsernameSkin(e.target.value));
  }

  // Quick Nick chips
  document.querySelectorAll('.quick-nick').forEach(btn => {
    btn.addEventListener('click', () => {
      clearTimeout(debounceTimer);
      const nick = btn.textContent.trim();
      if (nickInput) nickInput.value = nick;
      if (topNickInput) topNickInput.value = nick;
      applyUsernameSkin(nick);
    });
  });

  // Floating 3D Canvas Camera Presets & Controls
  const camIsoBtn = document.getElementById('camIsoBtn');
  if (camIsoBtn) camIsoBtn.addEventListener('click', () => setCameraView('iso'));

  const camFrontBtn = document.getElementById('camFrontBtn');
  if (camFrontBtn) camFrontBtn.addEventListener('click', () => setCameraView('front'));

  const camSideBtn = document.getElementById('camSideBtn');
  if (camSideBtn) camSideBtn.addEventListener('click', () => setCameraView('side'));

  const camCenterBtn = document.getElementById('camCenterBtn');
  if (camCenterBtn) camCenterBtn.addEventListener('click', () => setCameraView('center'));

  const zoomInBtn = document.getElementById('zoomInBtn');
  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
      if (!controls || !camera) return;
      const dir = camera.position.clone().sub(controls.target);
      if (dir.length() > (controls.minDistance || 0.8) + 0.2) {
        camera.position.sub(dir.multiplyScalar(0.18));
        controls.update();
      }
    });
  }

  const zoomOutBtn = document.getElementById('zoomOutBtn');
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
      if (!controls || !camera) return;
      const dir = camera.position.clone().sub(controls.target);
      if (dir.length() < (controls.maxDistance || 6.0) - 0.2) {
        camera.position.add(dir.multiplyScalar(0.22));
        controls.update();
      }
    });
  }

  const autoRotateBtn = document.getElementById('autoRotateBtn');
  if (autoRotateBtn) {
    autoRotateBtn.addEventListener('click', () => {
      if (!controls) return;
      controls.autoRotate = !controls.autoRotate;
      controls.autoRotateSpeed = 2.0;
      if (controls.autoRotate) {
        autoRotateBtn.className = 'px-2.5 py-1.5 rounded-xl bg-brand-600 text-white text-xs font-bold flex items-center gap-1 transition-all shadow-sm';
      } else {
        autoRotateBtn.className = 'px-2.5 py-1.5 rounded-xl hover:bg-gray-800 text-gray-300 hover:text-white text-xs font-medium flex items-center gap-1 transition-all';
      }
    });
  }

  // Header reset button
  const resetCamBtn = document.getElementById('resetCamBtn');
  if (resetCamBtn) resetCamBtn.addEventListener('click', resetCamera);

  // Background Options
  document.querySelectorAll('.bg-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bg-option').forEach(b => {
        b.className = 'bg-option px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 border border-gray-800 bg-gray-950 text-gray-400 hover:text-white transition-all';
      });
      btn.className = 'bg-option active px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 border border-brand-500 bg-brand-500/10 text-brand-400 transition-all';

      const bg = btn.getAttribute('data-bg');
      state.settings.background = bg;
      const container = document.getElementById('canvasContainer');
      container.className = 'flex-1 relative min-h-[480px] lg:min-h-[620px] flex items-center justify-center overflow-hidden';
      if (bg === 'transparent') container.classList.add('transparent-bg');
      else if (bg === 'dark') container.classList.add('dark-bg');
      else if (bg === 'cyber') container.classList.add('cyber-bg');
      else if (bg === 'green') container.classList.add('green-bg');
    });
  });

  // Resolution Buttons
  document.querySelectorAll('.res-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.res-btn').forEach(b => {
        b.className = 'res-btn py-2.5 rounded-xl text-xs font-bold border border-gray-800 bg-gray-950 text-gray-400 text-center hover:text-white transition-all';
      });
      btn.className = 'res-btn active py-2.5 rounded-xl text-xs font-bold border border-brand-500 bg-brand-500/10 text-brand-400 text-center transition-all';
      state.settings.resolution = parseInt(btn.getAttribute('data-res'), 10);
    });
  });

  // Lighting sliders
  document.getElementById('lightIntensity').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('lightIntensityVal').textContent = `${val.toFixed(1)}x`;
    if (keyLight) keyLight.intensity = val * 1.1;
    if (ambientLight) ambientLight.intensity = val * 0.6;
  });

  document.getElementById('rimLightToggle').addEventListener('change', (e) => {
    if (rimLight) rimLight.visible = e.target.checked;
  });

  // Download Action
  document.getElementById('downloadRenderBtn').addEventListener('click', downloadCleanRender);
}

// Toast Notification
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
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

  requestAnimationFrame(() => toast.classList.remove('translate-y-4', 'opacity-0'));
  setTimeout(() => {
    toast.classList.add('translate-y-4', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
