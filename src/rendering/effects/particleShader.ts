/**
 * 粒子着色器。
 *
 * 用 `Points` + 自定义着色器，不用贴图（`V-FX-6`：固定缓冲区与对象池）：
 * 圆形柔边在片元里用距离场算出来，省掉一张图集，也省掉一次纹理采样。
 *
 * 颜色不做预乘：three 的加色混合是 `src.rgb * src.a + dst`，
 * 把 alpha 乘进 rgb 会让衰减变成平方（这个坑在全息层已经踩过一次）。
 */

export const PARTICLE_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;

  uniform float uPixelScale;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;
    vAlpha = aAlpha;

    // 按透视缩放：远处的粒子要变小
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelScale / max(0.001, -mvPosition.z);

    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // 圆形柔边：中心亮、边缘透明，得到火花/烟尘的观感
    vec2 offset = gl_PointCoord - vec2(0.5);
    float radius = length(offset) * 2.0;
    if (radius > 1.0) {
      discard;
    }

    float falloff = pow(1.0 - radius, 2.0);

    // 稍微提亮中心，让密集区域更「热」
    float core = pow(1.0 - radius, 6.0) * 0.6;

    gl_FragColor = vec4(vColor + core, falloff * vAlpha);
  }
`;
