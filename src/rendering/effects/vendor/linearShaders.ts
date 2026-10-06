/**
 * Adapted from LinearAbiltyCastingThreeJS (MIT).
 * Copyright (c) 2026 mohamedachrefelouafi.
 * Source commit: 97f1de19617e9a2e3af3c8021c8c21c8f58b40f3.
 * Full license: public/assets/vfx/THIRD-PARTY-NOTICES.txt.
 */
export const LINEAR_BOLT_VERTEX = `
  #define PI  3.141592653589793
  #define TAU 6.283185307179586

  uniform float uTime;
  uniform vec3  uOrigin;
  uniform vec3  uTarget;
  uniform vec3  uSide;
  uniform float uSag;
  uniform float uSeed;
  uniform float uRestrike;

  uniform float uStrands;
  uniform float uSpread;
  uniform float uSpreadNear;
  uniform float uSpreadCurve;
  uniform float uTwist;
  uniform float uTwistSpeed;

  uniform float uJitter;
  uniform float uJitterScale;
  uniform float uOctaves;
  uniform float uJitterFalloff;
  uniform float uCrawl;
  uniform float uPinch;
  uniform float uConverge;

  uniform float uWidth;
  uniform float uWidthTip;
  uniform float uWidthCurve;
  uniform float uCoreWidth;
  uniform float uWidthScale;
  uniform float uStrandFlash;
  uniform float uFlickerSpeed;
  uniform float uFade;

  attribute float aStrand;

  varying float vT;
  varying float vSide;
  varying float vStrand;
  varying float vFlash;
  varying float vViewZ;

  
#ifndef NOISE_LIB_INCLUDED
#define NOISE_LIB_INCLUDED

vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289v4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute289(vec4 x) { return mod289v4(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt4(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

vec2 hash21(float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

vec3 hash31(float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

/* ---- Ashima / Stefan Gustavson simplex noise ---- */
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289v3(i);
  vec4 p = permute289(permute289(permute289(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt4(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

/** snoise remapped to 0..1 */
float snoise01(vec3 p) { return snoise(p) * 0.5 + 0.5; }

float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * snoise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

float fbm4(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * snoise(p);
    p = p * 2.03 + vec3(17.3, 5.1, 9.7);
    a *= 0.5;
  }
  return v;
}

/** Ridged multifractal — sharp filaments, ideal for flames and cracks. */
float ridged(vec3 p, int unusedOctaves) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * (1.0 - abs(snoise(p)));
    p *= 2.06;
    a *= 0.5;
  }
  return v;
}

/** Divergence-free curl noise — used to swirl particles and flames. */
vec3 curlNoise(vec3 p) {
  const float e = 0.12;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);

  float x0 = snoise(p - dx), x1 = snoise(p + dx);
  float y0 = snoise(p - dy), y1 = snoise(p + dy);
  float z0 = snoise(p - dz), z1 = snoise(p + dz);

  vec3 pb = p + vec3(31.416, 47.853, 12.793);
  float bx0 = snoise(pb - dx), bx1 = snoise(pb + dx);
  float by0 = snoise(pb - dy), by1 = snoise(pb + dy);
  float bz0 = snoise(pb - dz), bz1 = snoise(pb + dz);

  float inv = 1.0 / (2.0 * e);
  vec3 grad1 = vec3(x1 - x0, y1 - y0, z1 - z0) * inv;
  vec3 grad2 = vec3(bx1 - bx0, by1 - by0, bz1 - bz0) * inv;
  return normalize(cross(grad1, grad2) + 1e-5);
}

/** Cheap 2D voronoi. Returns x = distance to closest cell, y = cell id hash. */
vec2 voronoi2(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float minDist = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash21(dot(n + g, vec2(7.13, 113.17)));
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < minDist) { minDist = d; id = hash11(dot(n + g, vec2(31.7, 57.1))); }
    }
  }
  return vec2(sqrt(minDist), id);
}

mat2 rot2(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}

#endif


  /** Value noise with a *linear* ramp — piecewise-linear output, sharp corners. */
  float vnoise(float x, float seed) {
    float i = floor(x);
    float f = x - i;
    return mix(hash11(i + seed), hash11(i + 1.0 + seed), f) * 2.0 - 1.0;
  }

  /**
   * Offset of one filament from the axis, in the perpendicular plane.
   * span is the length of the cast, so uJitterScale stays kinks per *metre*
   * however far the bolt reaches.
   */
  vec2 kink(float t, float seed, float span) {
    vec2 o = vec2(0.0);
    float amp = 1.0;
    float freq = max(uJitterScale, 0.01) * span;
    float scroll = uTime * uCrawl;

    // Fixed trip count with a per-octave gate: a dynamic bound is not portable,
    // and five multiply-adds are cheaper than the branch would be anyway.
    for (int i = 0; i < 5; i++) {
      float on = step(float(i), uOctaves - 1.0);
      o.x += on * amp * vnoise(t * freq + scroll, seed + 13.0 * float(i));
      o.y += on * amp * vnoise(t * freq + scroll * 1.17, seed + 71.3 + 13.0 * float(i));
      amp *= uJitterFalloff;
      freq *= 2.0;
      scroll *= 1.63;
    }
    return o;
  }

  vec3 boltPoint(float t, float seed, float radial, vec3 n1, vec3 n2, float span) {
    vec3 axis = mix(uOrigin, uTarget, t);
    axis.y += uSag * sin(t * PI);

    // Pinned at the hand always, and at the target as hard as uConverge asks —
    // a bolt that lands somewhere other than where it was aimed reads as a bug.
    float pinch = max(uPinch, 1e-3);
    float ends = smoothstep(0.0, pinch, t) *
                 mix(1.0, smoothstep(0.0, pinch, 1.0 - t), clamp(uConverge, 0.0, 1.0));

    vec2 offset = kink(t, seed, span) * uJitter * ends;

    float angle = seed * TAU + (t * uTwist + uTime * uTwistSpeed) * TAU;
    float reach = mix(uSpreadNear, uSpread, pow(clamp(t, 0.0, 1.0), max(uSpreadCurve, 0.01)));
    offset += vec2(cos(angle), sin(angle)) * reach * radial;

    return axis + n1 * offset.x + n2 * offset.y;
  }

  void main() {
    float t = position.x;
    float side = position.y;
    vT = t;
    vSide = side;

    /* ---- the frame the offsets live in ---- */
    vec3 delta = uTarget - uOrigin;
    float span = max(length(delta), 0.01);
    vec3 dir = length(delta) > 1e-5 ? delta / span : vec3(0.0, 0.0, 1.0);
    // Gram-Schmidt rather than the raw lateral: the axis tilts downward from the
    // hand, so uSide is only approximately perpendicular to it.
    vec3 n1 = uSide - dir * dot(uSide, dir);
    n1 = length(n1) > 1e-4 ? normalize(n1) : normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
    vec3 n2 = normalize(cross(dir, n1));

    /* ---- which filament is this, and what shape is it wearing ---- */
    // The strike index snaps every filament onto a new shape uRestrike times a
    // second; the crawl inside kink() slides it continuously in between. Both
    // together are what stops a held bolt looking like a static ribbon.
    float strike = floor(uTime * max(uRestrike, 0.01));
    float seed = hash11(aStrand * 7.13 + uSeed + strike * 3.77) * 97.0;
    float radial = uStrands <= 1.0 ? 0.0 : aStrand / (uStrands - 1.0);
    vStrand = radial;

    vec3 here = boltPoint(t, seed, radial, n1, n2, span);

    // Tangent by finite difference, mirrored at the far end so the last node
    // still has a neighbour to look at.
    float step_ = 0.02;
    float ahead = t + step_;
    float flip = 1.0;
    if (ahead > 1.0) { ahead = t - step_; flip = -1.0; }
    vec3 next = boltPoint(ahead, seed, radial, n1, n2, span);
    vec3 tangent = (next - here) * flip;
    tangent = length(tangent) > 1e-5 ? normalize(tangent) : dir;

    /* ---- turn the ribbon to face the camera ---- */
    vec3 toCamera = normalize(cameraPosition - here);
    vec3 binormal = cross(tangent, toCamera);
    float bl = length(binormal);
    binormal = bl > 1e-4 ? binormal / bl : n1;

    /* ---- width ---- */
    // A stuttering per-filament blink, quantised to uFlickerSpeed so the whole
    // bundle strobes on the same clock instead of shimmering independently.
    float flash = mix(1.0, hash11(floor(uTime * uFlickerSpeed) + aStrand * 3.7 + uSeed), uStrandFlash);
    vFlash = flash;

    float halfWidth = uWidth * uWidthScale;
    halfWidth *= mix(1.0, uWidthTip, pow(clamp(t, 0.0, 1.0), max(uWidthCurve, 0.01)));
    halfWidth *= mix(uCoreWidth, 1.0, radial);
    halfWidth *= flash * uFade;

    // World space throughout: the ability's group is an identity transform, and
    // going through modelMatrix would only invite it to drift.
    vec4 mv = viewMatrix * vec4(here + binormal * side * halfWidth, 1.0);
    vViewZ = mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
export const LINEAR_BOLT_FRAGMENT = `
  uniform float uTime;
  uniform float uSeed;
  uniform float uProgress;
  uniform float uTipGlow;
  uniform float uTipLength;
  uniform float uCoreSharp;
  uniform float uGlowFalloff;
  uniform float uBranchDim;
  uniform float uFlicker;
  uniform float uFlickerSpeed;
  uniform float uPassOpacity;
  uniform float uOpacity;
  uniform float uGlow;
  uniform float uFade;
  uniform float uSoftFade;
  uniform vec3  uColorCore;
  uniform vec3  uColorInner;
  uniform vec3  uColorOuter;
  uniform vec3  uColorHalo;

  uniform float uGlobalGlow;
  uniform vec2  uResolution;
  uniform sampler2D uSceneDepth;
  uniform float uCameraNear;
  uniform float uCameraFar;

  varying float vT;
  varying float vSide;
  varying float vStrand;
  varying float vFlash;
  varying float vViewZ;

  
#ifndef NOISE_LIB_INCLUDED
#define NOISE_LIB_INCLUDED

vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289v4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute289(vec4 x) { return mod289v4(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt4(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

vec2 hash21(float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

vec3 hash31(float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

/* ---- Ashima / Stefan Gustavson simplex noise ---- */
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289v3(i);
  vec4 p = permute289(permute289(permute289(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt4(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

/** snoise remapped to 0..1 */
float snoise01(vec3 p) { return snoise(p) * 0.5 + 0.5; }

float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * snoise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

float fbm4(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * snoise(p);
    p = p * 2.03 + vec3(17.3, 5.1, 9.7);
    a *= 0.5;
  }
  return v;
}

/** Ridged multifractal — sharp filaments, ideal for flames and cracks. */
float ridged(vec3 p, int unusedOctaves) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * (1.0 - abs(snoise(p)));
    p *= 2.06;
    a *= 0.5;
  }
  return v;
}

/** Divergence-free curl noise — used to swirl particles and flames. */
vec3 curlNoise(vec3 p) {
  const float e = 0.12;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);

  float x0 = snoise(p - dx), x1 = snoise(p + dx);
  float y0 = snoise(p - dy), y1 = snoise(p + dy);
  float z0 = snoise(p - dz), z1 = snoise(p + dz);

  vec3 pb = p + vec3(31.416, 47.853, 12.793);
  float bx0 = snoise(pb - dx), bx1 = snoise(pb + dx);
  float by0 = snoise(pb - dy), by1 = snoise(pb + dy);
  float bz0 = snoise(pb - dz), bz1 = snoise(pb + dz);

  float inv = 1.0 / (2.0 * e);
  vec3 grad1 = vec3(x1 - x0, y1 - y0, z1 - z0) * inv;
  vec3 grad2 = vec3(bx1 - bx0, by1 - by0, bz1 - bz0) * inv;
  return normalize(cross(grad1, grad2) + 1e-5);
}

/** Cheap 2D voronoi. Returns x = distance to closest cell, y = cell id hash. */
vec2 voronoi2(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float minDist = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash21(dot(n + g, vec2(7.13, 113.17)));
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < minDist) { minDist = d; id = hash11(dot(n + g, vec2(31.7, 57.1))); }
    }
  }
  return vec2(sqrt(minDist), id);
}

mat2 rot2(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}

#endif

  

  void main() {
    // Ahead of the strike front there is no bolt yet. The ribbon is drawn whole
    // and clipped here rather than scaled, so the *shape* never changes as the
    // front travels — only how much of it exists.
    float tip = max(uTipLength, 1e-3);
    float drawn = (1.0 - smoothstep(uProgress - tip, uProgress, vT));
    if (drawn <= 0.002) discard;

    float v = clamp(abs(vSide), 0.0, 1.0);

    #ifdef BOLT_GLOW
      float profile = pow(1.0 - v, max(uGlowFalloff, 0.05));
      vec3 color = mix(uColorHalo, uColorOuter, profile);
      float alpha = profile;
    #else
      float profile = pow(1.0 - v, max(uCoreSharp, 0.05));
      vec3 color = mix(uColorOuter, uColorInner, smoothstep(0.0, 0.5, profile));
      color = mix(color, uColorCore, smoothstep(0.45, 1.0, profile));
      float alpha = profile;
    #endif

    // The leading edge is where the air is actually breaking down.
    color += uColorCore * smoothstep(uProgress - tip * 2.0, uProgress, vT) * uTipGlow;

    // Quantised, not sinusoidal: real lightning stutters between brightnesses,
    // it does not breathe.
    float flicker = 1.0 - uFlicker * hash11(floor(uTime * uFlickerSpeed) + uSeed);

    alpha *= drawn * flicker * vFlash * uFade * uPassOpacity * uOpacity;
    alpha *= mix(1.0, clamp(uBranchDim, 0.0, 1.0), vStrand);


    if (alpha < 0.003) discard;

    color *= uGlow * uGlobalGlow;
    gl_FragColor = vec4(color, alpha);
  }
`;
