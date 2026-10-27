import './style.css';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollSmoother } from 'gsap/ScrollSmoother';

import { QUALITY, IS_DEBUG, IS_MOBILE, PREFERS_REDUCED_MOTION } from './quality.js';
import { starVertex, starFragment, cinematicShader } from './shaders.js';

/* ============================================================================
 * 0. Setup helpers
 * ========================================================================== */
const BASE = import.meta.env.BASE_URL;
gsap.registerPlugin(ScrollTrigger, ScrollSmoother);

// A GUI that is either the real lil-gui (debug) or a chainable no-op stub.
let gui;
if (IS_DEBUG) {
  const { GUI } = await import('lil-gui');
  gui = new GUI({ width: 340, title: 'Moon Knight — Debug' });
} else {
  const noop = () => proxy;
  const proxy = new Proxy(function () {}, {
    get: () => noop,
    apply: () => proxy,
  });
  gui = proxy;
}

// Smooth scrolling
ScrollSmoother.create({
  wrapper: '#smooth-wrapper',
  content: '#smooth-content',
  smooth: IS_MOBILE ? 0.8 : 1.2,
  effects: !IS_MOBILE,
  normalizeScroll: true,
});

/* ============================================================================
 * 1. Core: scene / camera / renderer
 * ========================================================================== */
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x060814, 0.0009);

const canvas = document.querySelector('canvas.webgl');
const sizes = { width: window.innerWidth, height: window.innerHeight };

const camera = new THREE.PerspectiveCamera(30, sizes.width / sizes.height, 0.1, 2000);
camera.position.set(0, 0, 20);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !QUALITY.smaa, // if SMAA pass runs we skip MSAA to save cost
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setClearColor(0x000000, 0);
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.maxPixelRatio));
renderer.shadowMap.enabled = QUALITY.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;

// Orbit controls are only useful for inspection → debug only.
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enabled = IS_DEBUG;

/* ============================================================================
 * 2. Lighting — cinematic 3-point rig (key + cool rim + warm rim) with a
 *    low hemisphere/ambient fill so shadows stay rich but never crush to black.
 * ========================================================================== */
const ambientLight = new THREE.AmbientLight(0xb9c6ff, 0.08);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0x9fb6ff, 0x0a0a12, 0.3);
scene.add(hemiLight);

// Key light (the god-ray spot that reveals Moon Knight). Kept as `spotLight`
// so every scroll animation that drives it still works unchanged. Toned right
// down + faster decay so the white suit keeps its detail instead of clipping.
const spotLight = new THREE.SpotLight(0xfff4e2, 850, 120, Math.PI / 6, 0.9, 1.8);
spotLight.position.set(0, 20, 7);
spotLight.castShadow = QUALITY.shadows;
spotLight.shadow.mapSize.set(QUALITY.shadowMapSize, QUALITY.shadowMapSize);
spotLight.shadow.bias = -0.0005;
spotLight.shadow.radius = 6;
spotLight.target.position.set(0, 0, 0);
scene.add(spotLight);
scene.add(spotLight.target);

// Cool back/rim light — carves the silver silhouette out of the dark.
const rimLight = new THREE.DirectionalLight(0x6f8cff, 1.7);
rimLight.position.set(-7, 5, -9);
scene.add(rimLight);

// Subtle warm kicker on the opposite side for dimension (kept low + less
// saturated so it doesn't wash the boomerang in orange bloom).
const warmRim = new THREE.DirectionalLight(0xffd2a6, 0.28);
warmRim.position.set(8, 2, -4);
scene.add(warmRim);

// GUI (debug only)
const spotLightFolder = gui.addFolder('🔦 Spot Light');
spotLightFolder.add(spotLight.position, 'x', -20, 20, 0.1).name('Position X');
spotLightFolder.add(spotLight.position, 'y', 0, 20, 0.1).name('Position Y');
spotLightFolder.add(spotLight.position, 'z', -20, 20, 0.1).name('Position Z');
spotLightFolder.add(spotLight, 'intensity', 0, 2000, 10).name('Intensity');
spotLightFolder.add(spotLight, 'angle', 0, Math.PI / 2, 0.01).name('Angle');
spotLightFolder.add(spotLight, 'penumbra', 0, 1, 0.01).name('Penumbra');

/* ============================================================================
 * 2b. HDR environment (image-based lighting) — deferred so it never blocks the
 *     first paint. Used for reflections/PBR only, not as a visible background.
 * ========================================================================== */
function loadEnvironment() {
  if (!QUALITY.envMap) return;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  new RGBELoader().load(
    `${BASE}backgrounds/scene.hdr`,
    (hdr) => {
      const envMap = pmrem.fromEquirectangular(hdr).texture;
      scene.environment = envMap;
      scene.environmentIntensity = 0.35;
      hdr.dispose();
      pmrem.dispose();
    },
    undefined,
    () => pmrem.dispose(),
  );
}

/* ============================================================================
 * 4. GPU Starfield
 * ========================================================================== */
function createStarfield(count) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const scales = new Float32Array(count);

  const palette = [
    new THREE.Color(0xffffff),
    new THREE.Color(0xbcd4ff),
    new THREE.Color(0xfff3d1),
    new THREE.Color(0x9db8ff),
  ];

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    // Distribute on a large shell around the scene.
    const r = 120 + Math.random() * 380;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i3 + 2] = r * Math.cos(phi);

    const c = palette[(Math.random() * palette.length) | 0];
    colors[i3] = c.r;
    colors[i3 + 1] = c.g;
    colors[i3 + 2] = c.b;

    scales[i] = 0.5 + Math.random() * 2.0;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: starVertex,
    fragmentShader: starFragment,
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: 9 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, QUALITY.maxPixelRatio) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

const starfield = createStarfield(QUALITY.starCount);
scene.add(starfield);

/* ============================================================================
 * 5. Model loading (Draco compressed .glb)
 * ========================================================================== */
let moonKnightModel = null;
let boomerangModel = null;
let loadedModels = [];
let modelsLoaded = 0;
const totalModels = 2;
let loadingProgress = 0;

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(`${BASE}draco/`);
dracoLoader.setDecoderConfig({ type: 'js' });
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

function updateLoadingProgress() {
  const progressPercent = (loadingProgress / totalModels) * 100;
  const progressBar = document.querySelector('.loading-progress');
  if (progressBar) progressBar.style.width = `${progressPercent}%`;
  const loadingText = document.querySelector('.loading-text');
  if (loadingText) {
    loadingText.textContent = `Summoning the Fist of Khonshu… ${progressPercent.toFixed(0)}%`;
  }
}

function hidePreloader() {
  const loaderEl = document.getElementById('preloader');
  if (!loaderEl) return;
  gsap.to(loaderEl, {
    opacity: 0,
    scale: 1.08,
    duration: 0.8,
    ease: 'power2.inOut',
    onComplete: () => {
      loaderEl.remove();
      ScrollTrigger.refresh();
    },
  });
}

const loadModel = (path, position, rotation, scale, modelName) => {
  gltfLoader.load(
    path,
    (gltf) => {
      const mesh = gltf.scene;
      mesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = QUALITY.shadows;
          child.receiveShadow = QUALITY.shadows;
          if (child.material && child.material.map) {
            child.material.map.anisotropy = QUALITY.anisotropy;
          }
        }
      });

      mesh.position.set(position.x, position.y, position.z);
      mesh.rotation.set(rotation.x, rotation.y, rotation.z);
      mesh.scale.set(scale.x, scale.y, scale.z);
      scene.add(mesh);

      if (modelName === 'moonKnight') moonKnightModel = mesh;
      if (modelName === 'boomerang') boomerangModel = mesh;

      loadedModels.push(mesh);
      modelsLoaded++;
      loadingProgress++;
      updateLoadingProgress();

      if (modelsLoaded === totalModels) {
        setupAllAnimations();
        setTimeout(hidePreloader, 400);
      }
    },
    undefined,
    (error) => {
      console.error(`Error loading ${modelName}`, error);
      loadingProgress++;
      updateLoadingProgress();
      if (loadingProgress >= totalModels) setTimeout(hidePreloader, 800);
    },
  );
};

loadModel(
  `${BASE}models/moon_knight.glb`,
  { x: 0, y: -100, z: -19 },
  { x: 0, y: Math.PI * 2, z: 0 },
  { x: 18, y: 18, z: 18 },
  'moonKnight',
);

loadModel(
  `${BASE}models/boomerang.glb`,
  { x: 0, y: 4, z: 0 },
  { x: Math.PI, y: Math.PI, z: Math.PI },
  { x: 1, y: 1, z: 1 },
  'boomerang',
);

function setModelOpacity(model, opacity) {
  if (!model) return;
  model.traverse((child) => {
    if (child.isMesh && child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((material) => {
        if (!material.transparent) {
          material.transparent = true;
          material.needsUpdate = true;
        }
        material.opacity = opacity;
      });
    }
  });
}

/* ============================================================================
 * 6. Debug GUI for models
 * ========================================================================== */
function setupModelGUI(model, label) {
  if (!model || !IS_DEBUG) return;
  const f = gui.addFolder(label);
  ['x', 'y', 'z'].forEach((axis) =>
    f.add(model.position, axis, -100, 100, 0.1).name(`Pos ${axis.toUpperCase()}`),
  );
  ['x', 'y', 'z'].forEach((axis) =>
    f.add(model.rotation, axis, 0, Math.PI * 2, 0.01).name(`Rot ${axis.toUpperCase()}`),
  );
  f.add(model.scale, 'x', 0.1, 50, 0.1).name('Scale').onChange((v) => model.scale.setScalar(v));
}

/* ============================================================================
 * 7. Scroll animations (values preserved from the original build)
 * ========================================================================== */
const markers = IS_DEBUG;

function setupAllAnimations() {
  setupBoomerangAnimations();
  setupMoonKnightAnimations();
  setupCombinedAnimations();
  setupParticleTrailAnimations();
  setupModelGUI(moonKnightModel, '🌙 Moon Knight');
  setupModelGUI(boomerangModel, '🪃 Boomerang');
  // Defer the heavy HDR so it never competes with the reveal.
  setTimeout(loadEnvironment, 600);
  ScrollTrigger.refresh();
}

gsap.to('.intro-logo', { y: 0, duration: 1, ease: 'linear', delay: 1, opacity: 1 });

function setupCombinedAnimations() {
  gsap
    .timeline({
      scrollTrigger: {
        trigger: '.section-two',
        start: 'top bottom',
        end: 'bottom center',
        scrub: 0.5,
      },
    })
    .to('.intro-logo', { opacity: 0, duration: 1 });

  gsap
    .timeline({
      scrollTrigger: {
        trigger: '.section-tweleve',
        start: 'top bottom',
        end: 'bottom center',
        scrub: 0.5,
      },
    })
    .to(camera.position, { x: 16 });

  gsap
    .timeline({
      scrollTrigger: {
        trigger: '.section-fourteen',
        start: 'top bottom',
        end: 'bottom center',
        scrub: 0.5,
      },
    })
    .to(camera.position, { x: 0, y: 14, z: 50, ease: 'power1.inOut' });
}

function setupBoomerangAnimations() {
  if (!boomerangModel) return;

  gsap.set(boomerangModel.position, { x: 0, y: 20, z: 0 });
  gsap.set(boomerangModel.rotation, { x: Math.PI, y: Math.PI, z: Math.PI });
  gsap.set(boomerangModel.scale, { x: 1, y: 1, z: 1 });

  gsap
    .timeline({
      scrollTrigger: {
        trigger: '.section-two',
        start: 'top bottom',
        end: 'bottom center',
        scrub: 0.5,
      },
    })
    .to(boomerangModel.position, { x: 0, y: 0, z: 0, duration: 1, ease: 'power2.out' })
    .to(boomerangModel.rotation, { x: 0, y: 0, z: 0, duration: 1, ease: 'power2.out' }, 0)
    .to(boomerangModel.scale, { x: 1.5, y: 1.5, z: 1.5, duration: 0.5, ease: 'power2.out' }, 0);

  gsap
    .timeline({
      scrollTrigger: {
        trigger: '.section-three',
        start: 'center center',
        end: 'bottom center',
        scrub: 0.5,
      },
    })
    .to(boomerangModel.position, { x: 0, y: 0, z: 0, duration: 1, ease: 'power2.inOut' })
    .to(boomerangModel.rotation, { x: 2.98, y: 0, z: 0.28, duration: 1, ease: 'power2.inOut' }, 0)
    .to(boomerangModel.scale, { x: 2.8, y: 2.8, z: 2.8, duration: 0.5, ease: 'power2.inOut' }, 0);

  gsap
    .timeline({
      scrollTrigger: {
        trigger: '.section-four',
        start: 'top center',
        end: 'bottom center',
        scrub: 0.5,
        markers,
      },
    })
    .to(boomerangModel.position, { x: -0.2, y: 3.4, z: -8.6, duration: 1, ease: 'power2.inOut' })
    .to(boomerangModel.rotation, { z: 0, duration: 1, ease: 'power2.inOut' }, 0)
    .to(boomerangModel.scale, { x: 2.6, y: 2.6, z: 2.6, duration: 0.5, ease: 'power2.inOut' }, 0);

  gsap
    .timeline({
      scrollTrigger: {
        trigger: '.section-fifteen',
        start: 'top center',
        end: 'bottom center',
        scrub: 0.5,
        markers,
      },
    })
    .to(boomerangModel.position, { x: -0.2, y: 50, z: -8.6, duration: 1, ease: 'power2.inOut' });
}

function setupMoonKnightAnimations() {
  if (!moonKnightModel) return;

  gsap.set(moonKnightModel.position, { x: 0, y: -100, z: -19 });
  gsap.set(moonKnightModel.rotation, { x: 0, y: Math.PI * 2, z: 0 });
  gsap.set(moonKnightModel.scale, { x: 18, y: 18, z: 18 });
  setModelOpacity(moonKnightModel, 0);

  gsap
    .timeline({
      scrollTrigger: {
        trigger: '.section-five',
        start: 'top center',
        end: 'center center',
        scrub: 0.3,
        markers,
      },
    })
    .to(
      {},
      {
        duration: 1,
        ease: 'power2.out',
        onUpdate: function () {
          setModelOpacity(moonKnightModel, this.progress());
        },
      },
      0,
    )
    .to(spotLight, { x: 0, y: 20, z: 5, duration: 1 });

  gsap
    .timeline({
      scrollTrigger: {
        trigger: '.section-fifteen',
        start: 'top center',
        end: 'bottom top',
        scrub: 0.5,
      },
    })
    .to(camera.position, { x: 0, y: -0.5, z: 8.6, ease: 'power1.inOut' });

  gsap
    .timeline({
      scrollTrigger: {
        trigger: '.section-sixteen',
        start: 'top center',
        end: 'bottom center',
        scrub: 0.5,
      },
    })
    .to(moonKnightModel.position, { x: 0, y: -5.1, z: 0, ease: 'power2.inOut' })
    .to(moonKnightModel.rotation, { x: 0, y: 0, z: 0, ease: 'power2.inOut' }, 0)
    .to(moonKnightModel.scale, { x: 1, y: 1, z: 1, ease: 'power2.inOut' }, 0)
    .to(spotLight, { intensity: 480, ease: 'power2.inOut' }, 0);
}

// Reveal the editorial content sections as they scroll into view.
gsap.utils.toArray('.common-sections').forEach((section) => {
  const content = section.querySelector('.content');
  const image = section.querySelector('.section-img');
  const tl = gsap.timeline({
    scrollTrigger: { trigger: section, start: 'top 75%', end: 'top 40%', scrub: 0.6 },
  });
  if (content) tl.from(content, { y: 60, opacity: 0, ease: 'power2.out' }, 0);
  if (image) tl.from(image, { y: 80, opacity: 0, ease: 'power2.out' }, 0.1);
});

// Animate section captions on the cinematic (empty) stages.
gsap.utils.toArray('.stage-caption').forEach((caption) => {
  gsap.fromTo(
    caption,
    { opacity: 0, y: 40 },
    {
      opacity: 1,
      y: 0,
      ease: 'power2.out',
      scrollTrigger: { trigger: caption, start: 'top 80%', end: 'top 55%', scrub: 0.6 },
    },
  );
});

/* ============================================================================
 * 8. Post-processing pipeline (device-adaptive)
 * ========================================================================== */
const composer = new EffectComposer(renderer);
composer.setSize(sizes.width, sizes.height);
composer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.maxPixelRatio));

const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

let bloomPass = null;
if (QUALITY.bloom) {
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(sizes.width, sizes.height),
    QUALITY.bloomStrength,
    0.3, // radius — tight, controlled falloff
    0.82, // threshold — only the eyes/emblem/brightest highlights bloom
  );
  composer.addPass(bloomPass);

  const bloomFolder = gui.addFolder('✨ Bloom');
  bloomFolder.add(bloomPass, 'strength', 0, 3, 0.01).name('Strength');
  bloomFolder.add(bloomPass, 'radius', 0, 2, 0.01).name('Radius');
  bloomFolder.add(bloomPass, 'threshold', 0, 1, 0.01).name('Threshold');
}

let cinematicPass = null;
if (QUALITY.vignette || QUALITY.grain) {
  cinematicPass = new ShaderPass(cinematicShader);
  cinematicPass.uniforms.uGrain.value = QUALITY.grain ? 0.022 : 0;
  cinematicPass.uniforms.uVignetteStrength.value = QUALITY.vignette ? 0.85 : 0;
  composer.addPass(cinematicPass);
}

composer.addPass(new OutputPass());

if (QUALITY.smaa) {
  const smaaPass = new SMAAPass(
    sizes.width * renderer.getPixelRatio(),
    sizes.height * renderer.getPixelRatio(),
  );
  composer.addPass(smaaPass);
}

/* ============================================================================
 * 9. 2D particle hyperspace overlay (device-adaptive count)
 * ========================================================================== */
// Build a soft glow sprite ONCE per colour (radial gradient) so we can render
// thousands of particles with cheap drawImage calls instead of per-particle
// canvas shadowBlur (which was the main frame-rate killer).
function makeGlowSprite(color, size = 32) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.35, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return cv;
}

class ParticleTrailSystem {
  constructor(count) {
    this.canvas = document.getElementById('particle-canvas');
    this.c = this.canvas.getContext('2d');
    this.count = count;
    this.colors = ['#2185C5', '#7ECEFD', '#FFF6E5', '#d9c38b'];
    this.sprites = this.colors.map((col) => makeGlowSprite(col));
    this.particles = [];
    this.radians = 0;
    this.intensity = 0; // 0 = idle (transparent), 1 = full hyperspace warp
    this.active = false;

    this.setupCanvas();
    this.init();
    this.animate();

    window.addEventListener('resize', () => {
      this.setupCanvas();
      this.init();
    });
  }
  setupCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }
  activate() {
    this.active = true;
  }
  deactivate() {
    this.active = false;
  }
  init() {
    this.particles = [];
    const w = this.canvas.width + 1000;
    const h = this.canvas.height + 2000;
    for (let i = 0; i < this.count; i++) {
      this.particles.push({
        x: Math.random() * w - w / 2,
        y: Math.random() * h - h / 2,
        r: 4 + Math.random() * 10,
        s: (Math.random() * this.sprites.length) | 0,
      });
    }
  }
  animate() {
    requestAnimationFrame(() => this.animate());
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Fully idle → keep the canvas transparent (lets the CSS gradient + 3D
    // starfield show through) and skip all the heavy drawing.
    if (!this.active && this.intensity < 0.02) {
      if (this.intensity !== 0) {
        this.c.clearRect(0, 0, w, h);
        this.intensity = 0;
      }
      return;
    }

    this.intensity += ((this.active ? 1 : 0) - this.intensity) * 0.06;

    // Trailing dark wash — opacity ramps with intensity so it fades cleanly in
    // and out. This is what creates the light-streak "warp" trails.
    this.c.globalAlpha = Math.min(1, this.intensity * 1.3);
    this.c.fillStyle = 'rgba(5, 6, 12, 0.28)';
    this.c.fillRect(0, 0, w, h);

    this.c.save();
    this.c.translate(w / 2, h / 2);
    this.c.rotate(this.radians);
    this.c.globalCompositeOperation = 'lighter';
    this.c.globalAlpha = this.intensity;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const d = p.r;
      this.c.drawImage(this.sprites[p.s], p.x - d, p.y - d, d * 2, d * 2);
    }
    this.c.restore();
    this.c.globalCompositeOperation = 'source-over';
    this.c.globalAlpha = 1;

    this.radians += 0.006 * (0.4 + this.intensity);
  }
}

const particleTrailSystem = new ParticleTrailSystem(QUALITY.particleCount);

function setupParticleTrailAnimations() {
  ScrollTrigger.create({
    trigger: '.section-seventeen',
    start: 'top center',
    end: 'bottom center',
    onEnter: () => particleTrailSystem.activate(),
    onLeave: () => particleTrailSystem.deactivate(),
    onEnterBack: () => particleTrailSystem.activate(),
    onLeaveBack: () => particleTrailSystem.deactivate(),
  });
}

/* ============================================================================
 * 10. Resize
 * ========================================================================== */
window.addEventListener('resize', () => {
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio, QUALITY.maxPixelRatio);

  camera.aspect = sizes.width / sizes.height;
  camera.updateProjectionMatrix();

  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(pr);

  composer.setSize(sizes.width, sizes.height);
  composer.setPixelRatio(pr);

  starfield.material.uniforms.uPixelRatio.value = pr;
});

/* ============================================================================
 * 11. Render loop (pauses when tab hidden)
 * ========================================================================== */
const clock = new THREE.Clock();
let running = true;
document.addEventListener('visibilitychange', () => {
  running = !document.hidden;
  if (running) tick();
});

const tick = () => {
  if (!running) return;
  const elapsed = clock.getElapsedTime();

  if (controls.enabled) controls.update();

  starfield.material.uniforms.uTime.value = elapsed;
  starfield.rotation.y = elapsed * 0.01;

  if (cinematicPass) cinematicPass.uniforms.uTime.value = elapsed;

  composer.render();
  requestAnimationFrame(tick);
};

tick();
