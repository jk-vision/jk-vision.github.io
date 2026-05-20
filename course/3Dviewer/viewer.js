/* ==========================================================================
   3D viewer
   Renders a .glb file inside #viewer using Three.js + GLTFLoader.
   Handles both point cloud GLBs and mesh GLBs automatically.

   Centering: uses the centroid (mean position) of the points, not the
   bounding-box center, so outlier points don't shift the cloud off-screen.
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

  // Point size is auto-computed from the model's scale. Increase the factor
  // for chunkier points, decrease for finer ones.
  pointSizeFactor: 0.002,

  // Robust framing: use only the central X% of points to size the camera,
  // so a handful of outliers don't make the cloud look tiny in the middle.
  // 0.98 means "ignore the farthest 2% from the centroid".
  inlierFraction: 0.98,

  // Lighting (only used for textured meshes)
  ambientIntensity: 0.7,
  directionalIntensity: 0.6,

  // Set to true to draw a pink bounding box (useful only for debugging).
  debug: false,
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

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.backgroundColor);

  const camera = new THREE.PerspectiveCamera(
    CONFIG.cameraFovDeg,
    container.clientWidth / container.clientHeight,
    0.001,
    10000
  );
  camera.position.set(0, 0, 2);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, CONFIG.ambientIntensity));
  const dirLight = new THREE.DirectionalLight(0xffffff, CONFIG.directionalIntensity);
  dirLight.position.set(2, 3, 4);
  scene.add(dirLight);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = CONFIG.damping;

  // ---------------------------------------------------------------------------
  // Load the GLB
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
      console.error('[viewer] GLB load FAILED:', err);
      if (loaderEl) loaderEl.textContent = 'Failed to load';
    }
  );

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
}

// -----------------------------------------------------------------------------
// Compute centroid + a robust extent that ignores outliers
// -----------------------------------------------------------------------------

function analyzePoints(model, inlierFraction) {
  let totalCount = 0;

  // First pass: sum positions to get the centroid
  const sum = new THREE.Vector3();
  model.traverse((child) => {
    if (child.isPoints || child.isMesh) {
      const posAttr = child.geometry?.attributes?.position;
      if (!posAttr) return;
      const arr = posAttr.array;
      for (let i = 0; i < arr.length; i += 3) {
        sum.x += arr[i];
        sum.y += arr[i + 1];
        sum.z += arr[i + 2];
      }
      totalCount += posAttr.count;
    }
  });

  if (totalCount === 0) {
    return { centroid: new THREE.Vector3(), extent: 1 };
  }

  const centroid = sum.divideScalar(totalCount);

  // Second pass: compute distances from centroid
  const dists = new Float32Array(totalCount);
  let idx = 0;
  model.traverse((child) => {
    if (child.isPoints || child.isMesh) {
      const posAttr = child.geometry?.attributes?.position;
      if (!posAttr) return;
      const arr = posAttr.array;
      for (let i = 0; i < arr.length; i += 3) {
        const dx = arr[i]     - centroid.x;
        const dy = arr[i + 1] - centroid.y;
        const dz = arr[i + 2] - centroid.z;
        dists[idx++] = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
    }
  });

  // Sort distances and take the inlierFraction-th percentile as the extent.
  // This makes camera framing robust to outliers.
  const sorted = dists.slice().sort();
  const cutoffIdx = Math.floor(sorted.length * inlierFraction);
  const extent = sorted[Math.min(cutoffIdx, sorted.length - 1)] || 1;

  return { centroid, extent, totalCount };
}

// -----------------------------------------------------------------------------
// Process the loaded GLB
// -----------------------------------------------------------------------------

function onModelLoaded(gltf, scene, camera, controls, loaderEl) {
  if (loaderEl) loaderEl.textContent = 'Preparing scene…';

  const model = gltf.scene;

  // Centroid-based analysis with outlier filtering
  const { centroid, extent, totalCount } = analyzePoints(model, CONFIG.inlierFraction);

  console.log('[viewer] Centroid:', centroid.toArray().map(n => n.toFixed(3)));
  console.log(`[viewer] Robust extent (${(CONFIG.inlierFraction * 100).toFixed(0)}th percentile distance): ${extent.toFixed(3)}`);
  console.log(`[viewer] Total vertices: ${totalCount.toLocaleString()}`);

  const autoPointSize = extent * CONFIG.pointSizeFactor;

  // Configure materials
  let isPointCloud = false;
  model.traverse((child) => {
    if (child.isPoints) {
      isPointCloud = true;
      const hasColor = !!child.geometry.attributes.color;
      child.material = new THREE.PointsMaterial({
        size: autoPointSize,
        vertexColors: hasColor,
        color: hasColor ? 0xffffff : 0x222222,
        sizeAttenuation: true,
      });
    } else if (child.isMesh) {
      if (child.geometry.attributes.color && child.material) {
        child.material.vertexColors = true;
        child.material.needsUpdate = true;
      }
    }
  });

  // Translate the model so its centroid sits at the origin
  model.position.sub(centroid);

  scene.add(model);

  // Optional debug bounding box
  if (CONFIG.debug) {
    const box = new THREE.Box3().setFromObject(model);
    scene.add(new THREE.Box3Helper(box, 0xff3366));
    console.log('[viewer] DEBUG: pink bounding box added. Set CONFIG.debug = false to hide.');
  }

  // Position camera based on the *robust* extent, not the raw bounding box.
  // extent is roughly the radius of the inlier cloud, so use 2x for diameter.
  const framingDistance = extent * 2 * CONFIG.cameraDistanceMultiplier;
  camera.position.set(0, 0, framingDistance);
  camera.near = Math.max(extent / 1000, 0.001);
  camera.far  = extent * 100;
  camera.updateProjectionMatrix();

  controls.target.set(0, 0, 0);
  controls.update();

  console.log(`[viewer] Rendered ${isPointCloud ? 'point cloud' : 'mesh'}, camera at z = ${framingDistance.toFixed(3)}`);

  if (loaderEl) loaderEl.style.display = 'none';
}
