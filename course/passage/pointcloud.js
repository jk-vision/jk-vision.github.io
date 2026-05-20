/* ==========================================================================
   Point cloud viewer
   Renders a .ply point cloud inside #pc-viewer using Three.js + PLYLoader.
   Loaded as an ES module — see the <script type="module"> in the HTML.
   ========================================================================== */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

// -----------------------------------------------------------------------------
// Configuration — change these to suit your data
// -----------------------------------------------------------------------------

const CONFIG = {
  plyUrl: 'nakaniwa_setup_1.ply',   // path to your .ply file (relative to the HTML)
  backgroundColor: 0x2a4d69,        // matches --main-color in your site CSS
  pointSize: 0.01,                  // initial point size; tweak per dataset
  fallbackPointColor: 0xffffff,     // used only when the PLY has no vertex colors
  cameraFovDeg: 60,
  cameraDistanceMultiplier: 1.5,    // how far back to place the camera (× longest cloud axis)
  damping: 0.08,
};

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

const container = document.getElementById('pc-viewer');
if (!container) {
  console.warn('[pointcloud] No #pc-viewer element found. Skipping init.');
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
  container.appendChild(renderer.domElement);

  // Orbit controls (drag to rotate, scroll to zoom, right-click to pan)
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = CONFIG.damping;

  // Material — uses per-vertex colors from the PLY if available
  const material = new THREE.PointsMaterial({
    size: CONFIG.pointSize,
    vertexColors: true,
    sizeAttenuation: true,
  });

  // ---------------------------------------------------------------------------
  // Load the PLY
  // ---------------------------------------------------------------------------

  new PLYLoader().load(
    CONFIG.plyUrl,
    (geometry) => onPlyLoaded(geometry, scene, camera, controls, material, loaderEl),
    (xhr) => onPlyProgress(xhr, loaderEl),
    (err) => onPlyError(err, loaderEl)
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
// PLY load callbacks
// -----------------------------------------------------------------------------

function onPlyLoaded(geometry, scene, camera, controls, material, loaderEl) {
  geometry.computeBoundingBox();
  geometry.center();

  // Fallback when the file has no per-vertex colors
  if (!geometry.hasAttribute('color')) {
    material.vertexColors = false;
    material.color = new THREE.Color(CONFIG.fallbackPointColor);
  }

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  // Auto-fit camera distance to the cloud's bounding box
  const size = new THREE.Vector3();
  geometry.boundingBox.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  camera.position.set(0, 0, maxDim * CONFIG.cameraDistanceMultiplier);
  controls.target.set(0, 0, 0);
  controls.update();

  if (loaderEl) loaderEl.style.display = 'none';
}

function onPlyProgress(xhr, loaderEl) {
  if (loaderEl && xhr.total) {
    const pct = ((xhr.loaded / xhr.total) * 100).toFixed(0);
    loaderEl.textContent = `Loading ${pct}%`;
  }
}

function onPlyError(err, loaderEl) {
  console.error('[pointcloud] PLY load error:', err);
  if (loaderEl) loaderEl.textContent = 'Failed to load';
}
