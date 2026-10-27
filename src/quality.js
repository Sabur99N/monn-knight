/**
 * Device capability detection → quality tier.
 * Everything expensive in the scene reads from this so the same code runs
 * smoothly from a low-end phone up to a desktop GPU.
 */

const ua = navigator.userAgent || '';
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
const cores = navigator.hardwareConcurrency || 4;
const memory = navigator.deviceMemory || 4; // GB (Chrome only)
const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 600;

function detectTier() {
  // Respect an explicit override via ?quality=low|mid|high
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced === 'low' || forced === 'mid' || forced === 'high') return forced;

  if (isMobile && (cores <= 4 || memory <= 3 || smallScreen)) return 'low';
  if (isMobile) return 'mid';
  if (cores <= 4 || memory <= 4) return 'mid';
  return 'high';
}

const tier = detectTier();

const presets = {
  low: {
    tier: 'low',
    maxPixelRatio: 1,
    shadows: false,
    shadowMapSize: 512,
    envMap: false,
    bloom: true,
    bloomStrength: 0.2,
    smaa: false,
    grain: false,
    vignette: true,
    starCount: 900,
    particleCount: 180,
    anisotropy: 1,
  },
  mid: {
    tier: 'mid',
    maxPixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    envMap: true,
    bloom: true,
    bloomStrength: 0.28,
    smaa: false,
    grain: true,
    vignette: true,
    starCount: 1800,
    particleCount: 380,
    anisotropy: 4,
  },
  high: {
    tier: 'high',
    maxPixelRatio: 1.75,
    shadows: true,
    shadowMapSize: 2048,
    envMap: true,
    bloom: true,
    bloomStrength: 0.34,
    smaa: true,
    grain: true,
    vignette: true,
    starCount: 3000,
    particleCount: 700,
    anisotropy: 8,
  },
};

export const QUALITY = presets[tier];
export const IS_MOBILE = isMobile;
export const IS_DEBUG = location.hash.includes('debug');
export const PREFERS_REDUCED_MOTION = window.matchMedia(
  '(prefers-reduced-motion: reduce)',
).matches;

if (IS_DEBUG) {
  console.log('[Quality] tier:', tier, QUALITY, { cores, memory, isMobile });
}
