/* ==========================================================================
   3D viewer
   Renders a .glb file inside #viewer using Three.js + GLTFLoader.
   Handles both point cloud GLBs and mesh GLBs automatically.

   Auto-framing: projects all points onto the screen and pulls the camera
   back just enough that they fit, with a small margin. This works
   regardless of outliers, weird coordinate orientations, or scale.
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
  damping: 0.08,

  // Point size auto-scales to the model. Tweak this multiplier for chunkier
  // or finer points.
  pointSizeFactor: 0.002,

  // Outlier rejection: ignore the farthest N% of points when framing the
  // camera. 0.98 = ignore farthest 2%.
  inlierFraction: 0.98,

  // Extra space around the cloud after auto-framing (1.0 = perfect fit, 1.2 = 20% margin)
  framingMargin: 1.2,

  // Lighting (only used for textured meshes)
  ambientIntensity: 0.7,
  directionalIntensity: 0.6,
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
// Gather all vertex positions from every Points/Mesh child
// -----------------------------------------------------------------------------

function collectAllPositions(model) {
  const arrays = [];
  let totalCount = 0;
  model.traverse((child) => {
    if (child.isPoints || child.isMesh) {
      const posAttr = child.geometry?.attributes?.position;
      if (!posAttr) return;
      arrays.push(posAttr.array);
      totalCount += posAttr.count;
    }
  });
  return { arrays, totalCount };
}

// -----------------------------------------------------------------------------
// Process the loaded GLB
// -----------------------------------------------------------------------------

function onModelLoaded(gltf, scene, camera, controls, loaderEl) {
  if (loaderEl) loaderEl.textContent = 'Preparing scene…';

  const model = gltf.scene;
  const { arrays, totalCount } = collectAllPositions(model);

  if (totalCount === 0) {
    console.warn('[viewer] No geometry found in the GLB.');
    if (loaderEl) loaderEl.textContent = 'No geometry found';
    return;
  }

  // 1) Centroid (mean position)
  const centroid = new THREE.Vector3();
  for (const arr of arrays) {
    for (let i = 0; i < arr.length; i += 3) {
      centroid.x += arr[i];
      centroid.y += arr[i + 1];
      centroid.z += arr[i + 2];
    }
  }
  centroid.divideScalar(totalCount);

  // 2) Distances from centroid (for outlier-robust extent)
  const dists = new Float32Array(totalCount);
  let idx = 0;
  for (const arr of arrays) {
    for (let i = 0; i < arr.length; i += 3) {
      const dx = arr[i]     - centroid.x;
      const dy = arr[i + 1] - centroid.y;
      const dz = arr[i + 2] - centroid.z;
      dists[idx++] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }

  // Pick the inlier extent (e.g., 98th percentile distance)
  const sorted = dists.slice().sort();
  const cutoffIdx = Math.min(
    Math.floor(sorted.length * CONFIG.inlierFraction),
    sorted.length - 1
  );
  const inlierExtent = sorted[cutoffIdx] || 1;

  console.log('[viewer] Centroid:', centroid.toArray().map(n => n.toFixed(3)));
  console.log(`[viewer] Inlier extent (${(CONFIG.inlierFraction*100).toFixed(0)}th percentile): ${inlierExtent.toFixed(3)}`);
  console.log(`[viewer] Total vertices: ${totalCount.toLocaleString()}`);

  // 3) Set point material with auto-scaled size
  const autoPointSize = inlierExtent * CONFIG.pointSizeFactor;
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

  // 4) Translate the model so the centroid sits at origin
  model.position.sub(centroid);
  scene.add(model);

  // 5) Compute the right camera distance using proper perspective math.
  // For a sphere of radius R centered at origin, the camera at distance d
  // sees it filling the frame when: d = R / sin(fov/2).
  // The HORIZONTAL fov is narrower than vertical when aspect < 1, so we
  // use whichever is more restrictive.
  const aspect = camera.aspect;
  const vFovRad = (CONFIG.cameraFovDeg * Math.PI) / 180;
  const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);
  const limitingFov = Math.min(vFovRad, hFovRad);

  const radius = inlierExtent;
  const fitDistance = (radius / Math.sin(limitingFov / 2)) * CONFIG.framingMargin;

  camera.position.set(0, 0, fitDistance);
  camera.near = Math.max(fitDistance / 1000, 0.001);
  camera.far  = fitDistance * 100;
  camera.updateProjectionMatrix();

  controls.target.set(0, 0, 0);
  controls.minDistance = fitDistance * 0.05;
  controls.maxDistance = fitDistance * 10;
  controls.update();

  console.log(`[viewer] Camera placed at z = ${fitDistance.toFixed(3)} (radius=${radius.toFixed(3)}, fov=${(limitingFov*180/Math.PI).toFixed(1)}°)`);
  console.log(`[viewer] Rendered ${isPointCloud ? 'point cloud' : 'mesh'}.`);

  if (loaderEl) loaderEl.style.display = 'none';
}
