/* ==========================================================================
   3D mesh / point cloud viewer
   Renders a .glb file inside #pc-viewer using Three.js + GLTFLoader.
   Loaded as an ES module — see <script type="module"> in the HTML.
   ========================================================================== */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// -----------------------------------------------------------------------------
// Configuration — change these to suit your data
// -----------------------------------------------------------------------------

const CONFIG = {
  modelUrl: 'shisa.glb',
  backgroundColor: 0x2a4d69,        // matches --main-color in your site CSS
  cameraFovDeg: 60,
  cameraDistanceMultiplier: 1.5,    // how far back the camera sits (× longest axis)
  damping: 0.08,

  // Lighting (only matters if the GLB uses PBR materials, not vertex colors)
  ambientIntensity: 0.6,
  directionalIntensity: 0.8,

  // If your mesh uses vertex colors (typical for photogrammetry/Open3D output),
  // set this to true. The script also auto-detects, but this is a manual override.
  forceVertexColors: false,
};

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

const container = document.getElementById('pc-viewer');
if (!container) {
  console.warn('[viewer] No #pc-viewer element found. Skipping init.');
} else {
  initViewer(container);
}

function initViewer(container) {
  const loaderEl = container.querySelector('.pc-loader');

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.backgroundColor);

  // Camera
  const camera = new THREE.PerspectiveCamera(
    CONFIG.cameraFovDeg,
    container.clientWidth / container.clientHeight,
    0.01,
    1000
  );
  camera.position.set(0, 0, 2);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // Lights — needed for PBR materials; harmless for vertex-color meshes
  scene.add(new THREE.AmbientLight(0xffffff, CONFIG.ambientIntensity));
  const dirLight = new THREE.DirectionalLight(0xffffff, CONFIG.directionalIntensity);
  dirLight.position.set(2, 3, 4);
  scene.add(dirLight);

  // Orbit controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = CONFIG.damping;

  // ---------------------------------------------------------------------------
  // Load the GLB — with a fallback for servers that don't send Content-Length
  // ---------------------------------------------------------------------------

  if (loaderEl) loaderEl.textContent = 'Loading…';

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
      console.error('[viewer] GLB load error:', err);
      if (loaderEl) loaderEl.textContent = 'Failed to load';
    }
  );

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  // ---------------------------------------------------------------------------
  // Resize handling
  // ---------------------------------------------------------------------------

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
}

// -----------------------------------------------------------------------------
// GLB load callback
// -----------------------------------------------------------------------------

function onModelLoaded(gltf, scene, camera, controls, loaderEl) {
  if (loaderEl) loaderEl.textContent = 'Preparing scene…';

  const model = gltf.scene;

  // If the GLB has vertex colors (common for photogrammetry/Open3D exports),
  // make sure the material actually uses them.
  let vertCount = 0;
  model.traverse((child) => {
    if (child.isMesh) {
      vertCount += child.geometry.attributes.position?.count ?? 0;
      const hasVertColors = !!child.geometry.attributes.color;
      if (hasVertColors || CONFIG.forceVertexColors) {
        if (child.material) {
          child.material.vertexColors = true;
          child.material.needsUpdate = true;
        }
      }
    }
  });

  scene.add(model);

  // Auto-center and auto-fit the camera to the model's bounding box
  const bbox = new THREE.Box3().setFromObject(model);
  const center = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  // Translate the model so its center is at the origin
  model.position.sub(center);

  // Position the camera proportionally to the model's size
  camera.position.set(0, 0, maxDim * CONFIG.cameraDistanceMultiplier);
  camera.near = maxDim / 100;
  camera.far  = maxDim * 100;
  camera.updateProjectionMatrix();

  controls.target.set(0, 0, 0);
  controls.update();

  console.log(`[viewer] Rendered model with ${vertCount.toLocaleString()} vertices`);

  if (loaderEl) loaderEl.style.display = 'none';
}
