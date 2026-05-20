/* ==========================================================================
   3D viewer
   Renders a .glb file inside #viewer using Three.js + GLTFLoader.
   Handles both point cloud GLBs and mesh GLBs automatically.

   Set CONFIG.debug = true to see a wireframe bounding box around the model.
   This is the easiest way to verify the model is loading and where it is.
   ========================================================================== */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const CONFIG = {
  modelUrl: 'shisa.glb',
  backgroundColor: 0xffffff,
  cameraFovDeg: 60,
  cameraDistanceMultiplier: 1.8,
  damping: 0.08,

  // Auto-scaled per model. The script computes a sensible point size
  // from the bounding box, so this multiplier is the knob to turn if
  // the points look too small or too chunky.
  pointSizeFactor: 0.002,

  // Lighting (used only for textured meshes)
  ambientIntensity: 0.7,
  directionalIntensity: 0.6,

  // 👇 SET TO false ONCE THE MODEL IS VISIBLE
  // When true, draws a wireframe bounding box so you can confirm
  // the GLB loaded and see where it is in the scene.
  debug: true,
};

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

const container = document.getElementById('viewer');
if (!container) {
  console.error('[viewer] No #viewer element found in the page.');
} else {
  initViewer(container);
}

function initViewer(container) {
  const loaderEl = container.querySelector('.loader');
  console.log('[viewer] Initializing. Container size:',
    container.clientWidth, 'x', container.clientHeight);

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.backgroundColor);

  // Camera
  const camera = new THREE.PerspectiveCamera(
    CONFIG.cameraFovDeg,
    container.clientWidth / container.clientHeight,
    0.001,
    10000
  );
  camera.position.set(0, 0, 2);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // Lights (harmless for point clouds, needed for textured meshes)
  scene.add(new THREE.AmbientLight(0xffffff, CONFIG.ambientIntensity));
  const dirLight = new THREE.DirectionalLight(0xffffff, CONFIG.directionalIntensity);
  dirLight.position.set(2, 3, 4);
  scene.add(dirLight);

  // Orbit controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = CONFIG.damping;

  // ---------------------------------------------------------------------------
  // Load the GLB
  // ---------------------------------------------------------------------------

  if (loaderEl) loaderEl.textContent = 'Loading…';
  console.log('[viewer] Fetching:', CONFIG.modelUrl);

  let bytesLoaded = 0;
  let hasTotal = false;
  const heartbeat = setInterval(() => {
    if (loaderEl && !hasTotal && bytesLoaded > 0) {
      const mb = (bytesLoaded / 1024 / 1024).toFixed(1);
      loaderEl.textContent = `Loading… ${mb} MB`;
    }
  }, 300);

  new GLTFLoader().load(
    CONFIG.modelUrl,
    (gltf) => {
      clearInterval(heartbeat);
      onModelLoaded(gltf, scene, camera, controls, loaderEl);
    },
    (xhr) => {
      bytesLoaded = xhr.loaded;
      if (xhr.total) {
        hasTotal = true;
        const pct = ((xhr.loaded / xhr.total) * 100).toFixed(0);
        if (loaderEl) loaderEl.textContent = `Loading ${pct}%`;
      }
    },
    (err) => {
      clearInterval(heartbeat);
      console.error('[viewer] GLB load FAILED:', err);
      if (loaderEl) loaderEl.textContent = 'Failed to load (see console)';
    }
  );

  // Render loop
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  // Resize handling
  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
}

// -----------------------------------------------------------------------------
// Process the loaded GLB
// -----------------------------------------------------------------------------

function onModelLoaded(gltf, scene, camera, controls, loaderEl) {
  console.log('[viewer] GLB loaded successfully. Processing…');
  if (loaderEl) loaderEl.textContent = 'Preparing scene…';

  const model = gltf.scene;

  // First pass: compute bounding box so we can pick a sensible point size
  const bbox = new THREE.Box3().setFromObject(model);
  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  console.log('[viewer] Bounding box:', {
    min: bbox.min.toArray().map(n => n.toFixed(3)),
    max: bbox.max.toArray().map(n => n.toFixed(3)),
    size: size.toArray().map(n => n.toFixed(3)),
    maxDim: maxDim.toFixed(3),
  });

  const autoPointSize = maxDim * CONFIG.pointSizeFactor;
  console.log('[viewer] Auto-computed point size:', autoPointSize.toFixed(5));

  // Second pass: configure materials for each child
  let vertCount = 0;
  let isPointCloud = false;
  let meshCount = 0;
  let pointsCount = 0;

  model.traverse((child) => {
    if (child.isPoints) {
      isPointCloud = true;
      pointsCount++;
      vertCount += child.geometry.attributes.position?.count ?? 0;
      const hasColor = !!child.geometry.attributes.color;

      child.material = new THREE.PointsMaterial({
        size: autoPointSize,
        vertexColors: hasColor,
        color: hasColor ? 0xffffff : 0x222222,   // dark gray fallback for visibility on white
        sizeAttenuation: true,
      });
    } else if (child.isMesh) {
      meshCount++;
      vertCount += child.geometry.attributes.position?.count ?? 0;
      if (child.geometry.attributes.color && child.material) {
        child.material.vertexColors = true;
        child.material.needsUpdate = true;
      }
    }
  });

  console.log(`[viewer] Found ${meshCount} mesh(es), ${pointsCount} point object(s), ${vertCount.toLocaleString()} total vertices`);

  // Center the model at the origin
  const center = bbox.getCenter(new THREE.Vector3());
  model.position.sub(center);

  scene.add(model);

  // Debug bounding box — shows you where the model is even if points are invisible
  if (CONFIG.debug) {
    const box = new THREE.Box3().setFromObject(model);
    const helper = new THREE.Box3Helper(box, 0xff3366);
    scene.add(helper);
    console.log('[viewer] DEBUG: pink bounding box added. Set CONFIG.debug = false to hide.');
  }

  // Position the camera proportionally to the model's size
  camera.position.set(0, 0, maxDim * CONFIG.cameraDistanceMultiplier);
  camera.near = Math.max(maxDim / 1000, 0.001);
  camera.far  = maxDim * 100;
  camera.updateProjectionMatrix();

  controls.target.set(0, 0, 0);
  controls.update();

  console.log('[viewer] Camera placed at z =', camera.position.z.toFixed(3));
  console.log('[viewer] Render complete.');

  if (loaderEl) loaderEl.style.display = 'none';
}
