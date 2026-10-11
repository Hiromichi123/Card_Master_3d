export const VORTEX_VERTEX = /* glsl */ `
attribute vec4 aOrbit;
attribute vec4 aShape;
uniform float uTime;
uniform vec2 uCover;
uniform vec2 uCenter;
uniform vec2 uEllipse;
varying vec2 vCloudUv;
varying vec2 vImageUv;
varying float vSeed;
varying float vOpacity;
varying float vDepth;
void main() {
  float angle = aOrbit.y + uTime * aOrbit.z;
  float radius = aOrbit.x + sin(uTime * 0.11 + aOrbit.w) * 0.009;
  vec2 radial = vec2(cos(angle), sin(angle));
  vec2 tangent = vec2(-radial.y, radial.x);
  // 沿切线舒展，局部翘曲与深度投影形成前后不同的云片，而非旋转平面贴图。
  float bend = sin(position.x * 2.6 + aOrbit.w + uTime * 0.07);
  float z = aShape.z + bend * 0.075;
  vec2 local = tangent * position.x * aShape.x + radial * (position.y * aShape.y + bend * 0.009);
  vec2 imageUv = uCenter + (radial * radius + local / (1.0 - z * 0.17)) * uEllipse;
  vec2 screenUv = (imageUv - 0.5) / uCover + 0.5;
  gl_Position = vec4(screenUv * 2.0 - 1.0, -z * 0.1, 1.0);
  vCloudUv = uv;
  vImageUv = imageUv;
  vSeed = aOrbit.w;
  vOpacity = aShape.w;
  vDepth = aShape.z;
}
`;

export const VORTEX_FRAGMENT = /* glsl */ `
uniform sampler2D uBackground;
uniform float uTime;
uniform float uFlash;
uniform vec2 uCenter;
uniform vec2 uEllipse;
uniform float uInner;
uniform float uOuter;
varying vec2 vCloudUv;
varying vec2 vImageUv;
varying float vSeed;
varying float vOpacity;
varying float vDepth;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
    mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.53;
  mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * noise(p);
    p = turn * p * 2.04 + vec2(13.1, 7.7);
    amplitude *= 0.48;
  }
  return value;
}
void main() {
  vec2 ring = (vImageUv - uCenter) / uEllipse;
  float radius = length(ring);
  float core = smoothstep(uInner, uInner + 0.055, radius);
  float outer = 1.0 - smoothstep(uOuter - 0.025, uOuter + 0.07, radius);
  vec2 q = vCloudUv * 2.0 - 1.0;
  float edge = pow(max(0.0, 1.0 - dot(q, q)), 1.5);
  if (edge * core * outer < 0.002) discard;
  vec2 p = vec2(vCloudUv.x * 5.5, vCloudUv.y * 3.2) + vec2(vSeed, vSeed * 0.31);
  p.x -= uTime * 0.095;
  p.y += sin(p.x * 1.9 + uTime * 0.13) * 0.3;
  float body = fbm(p);
  float filaments = noise(vec2(p.x * 3.0 + body * 5.0, p.y * 6.0 - body * 2.0));
  float density = smoothstep(0.2, 0.72, body + filaments * 0.2);
  float alpha = edge * density * vOpacity * core * outer;
  if (alpha < 0.004) discard;
  // 同底图UV的环带采色；WebGL2依纹理色彩空间解码，最终由three输出编码。
  vec2 sampleUv = clamp(vImageUv, vec2(0.002), vec2(0.998));
  vec3 original = texture2D(uBackground, sampleUv).rgb;
  vec3 nearby = texture2D(uBackground, clamp(sampleUv + ring * 0.065, vec2(0.002), vec2(0.998))).rgb;
  vec3 pigment = mix(original, nearby, 0.38);
  float nearLayer = clamp((vDepth + 0.35) / 0.6, 0.0, 1.0);
  // 底图采色保留整体色调；独立紫灰受光避免云层与底图完全同色而消失。
  pigment = mix(pigment, mix(vec3(0.055, 0.035, 0.09), vec3(0.23, 0.18, 0.32), nearLayer), 0.3);
  vec3 normal = normalize(vec3(-dFdx(density) * 95.0, -dFdy(density) * 95.0, 0.65));
  float diffuse = max(dot(normal, normalize(vec3(-0.55, 0.7, 0.9))), 0.0);
  float light = 0.42 + 0.9 * diffuse;
  float rim = pow(1.0 - density, 2.0) * (0.28 + nearLayer * 0.22);
  float selfShade = mix(0.62, 1.0, smoothstep(0.15, 0.8, body));
  vec3 lit = pigment * light * selfShade + pigment * filaments * 0.18;
  lit += vec3(0.25, 0.2, 0.36) * (rim + diffuse * nearLayer * 0.13);
  lit += uFlash * (vec3(0.52, 0.48, 0.68) + pigment) * (0.6 + rim);
  gl_FragColor = vec4(lit, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
