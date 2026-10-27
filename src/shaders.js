/**
 * Custom GLSL shaders used across the experience.
 * Kept as template strings so no extra Vite plugin is required.
 */

/* ----------------------------------------------------------------------------
 * Atmosphere / fresnel rim glow (rendered on a slightly larger back-side shell
 * around the moon to fake light scattering at the edges).
 * ------------------------------------------------------------------------- */
export const atmosphereVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPositionView;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vPositionView = mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const atmosphereFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uPower;

  varying vec3 vNormal;
  varying vec3 vPositionView;

  void main() {
    vec3 viewDir = normalize(-vPositionView);
    float fresnel = pow(1.0 - clamp(dot(viewDir, vNormal), 0.0, 1.0), uPower);
    gl_FragColor = vec4(uColor * fresnel * uIntensity, fresnel);
  }
`;

/* ----------------------------------------------------------------------------
 * GPU starfield — a single BufferGeometry of points with per-star colour,
 * size and a cheap time-based twinkle.
 * ------------------------------------------------------------------------- */
export const starVertex = /* glsl */ `
  attribute float aScale;
  attribute vec3 aColor;

  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;

  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    float twinkle = 0.55 + 0.45 * sin(uTime * 1.5 + position.x * 8.0 + position.y * 4.0);
    vTwinkle = twinkle;

    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uSize * aScale * uPixelRatio * twinkle;
    gl_PointSize *= (300.0 / max(-mvPosition.z, 0.001));
  }
`;

export const starFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    // Tight bright core with a faint, small halo — reads as a crisp star,
    // not a fuzzy blob, and survives the bloom pass without smearing.
    float core = smoothstep(0.24, 0.0, d);
    float halo = smoothstep(0.5, 0.24, d) * 0.18;
    float alpha = clamp(core + halo, 0.0, 1.0) * vTwinkle;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

/* ----------------------------------------------------------------------------
 * Full-screen post FX: vignette + animated film grain in one pass.
 * ------------------------------------------------------------------------- */
export const cinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 1.15 },
    uGrain: { value: 0.06 },
    uVignetteStrength: { value: 0.85 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uVignetteStrength;

    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Vignette
      vec2 uv = vUv - 0.5;
      float vig = smoothstep(0.85, uVignette, length(uv));
      color.rgb *= mix(1.0, 1.0 - vig, uVignetteStrength);

      // Animated grain
      float g = (rand(vUv + fract(uTime)) - 0.5) * uGrain;
      color.rgb += g;

      gl_FragColor = color;
    }
  `,
};
