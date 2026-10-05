import { Color, Vector2, type IUniform } from 'three';

/**
 * 全息遮罩层（`V-HOLO-1..4`）。
 *
 * 设计要点：
 *
 * 1. **独立的一层材质，不是改卡面材质**。`V-CARD-4` 要求插画、边框、全息遮罩
 *    是可分离的层。做成独立叠加层之后，关掉全息就完全是原始卡面，
 *    也不会因为混合公式把插画本身改色。
 * 2. **反光跟随视角**（`V-HOLO-1`）：色带位置由视线方向与卡面法线的夹角驱动，
 *    而不是固定的屏幕空间渐变。
 * 3. **不能淹没名称与插画**（`V-HOLO-2`）：整体用加色混合但强度很低，
 *    并且用条纹遮罩让亮带只占一部分面积，不做整面均匀提亮。
 *    验收标准是「中文名仍然读得清」，不是「看起来最闪」。
 *
 * 参考 `pokemon-cards-css` 的**视觉规律**（色带随倾斜移动、闪点、高光带），
 * 不复制其实现（该仓库 GPL-3.0，见 PLAN 第 3.3 节）。
 */

/**
 * 末尾的索引签名不是装饰：three 的 `uniforms` 要求
 * `{ [name: string]: IUniform }`，只写具名字段会因缺少索引签名而类型不兼容。
 */
export interface HoloUniforms {
  readonly uTime: IUniform<number>;
  readonly uIntensity: IUniform<number>;
  readonly uBands: IUniform<number>;
  readonly uSparkle: IUniform<number>;
  /** 卡面 UV 尺寸，用于把闪点保持成近似方形。 */
  readonly uUvScale: IUniform<Vector2>;
  readonly uTint: IUniform<Color>;
  readonly [name: string]: IUniform;
}

export function createHoloUniforms(intensity: number): HoloUniforms {
  return {
    uTime: { value: 0 },
    uIntensity: { value: intensity },
    uBands: { value: 3.2 },
    uSparkle: { value: 0.55 },
    uUvScale: { value: new Vector2(3, 4.5) },
    uTint: { value: new Color(1, 1, 1) },
  };
}

export const HOLO_VERTEX_SHADER = /* glsl */ `
  varying vec2 vHoloUv;
  varying vec3 vHoloViewDir;
  varying vec3 vHoloNormal;

  void main() {
    vHoloUv = uv;

    // 世界空间法线与视线方向：色带要跟着「观众看到的角度」动，
    // 用模型空间法线会变成跟着卡牌自转，倾斜卡牌时反光不会移动。
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vHoloNormal = normalize(mat3(modelMatrix) * normal);
    vHoloViewDir = normalize(cameraPosition - worldPosition.xyz);

    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const HOLO_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;

  uniform float uTime;
  uniform float uIntensity;
  uniform float uBands;
  uniform float uSparkle;
  uniform vec2 uUvScale;
  uniform vec3 uTint;

  varying vec2 vHoloUv;
  varying vec3 vHoloViewDir;
  varying vec3 vHoloNormal;

  // hsv -> rgb，用来生成彩虹色带
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    // 菲涅尔：正对时弱、斜看时强，这是全息最关键的观感
    float facing = clamp(dot(normalize(vHoloNormal), normalize(vHoloViewDir)), 0.0, 1.0);
    float fresnel = pow(1.0 - facing, 2.0);

    // 色带沿卡面的固定斜向排布（看起来像箔上的条纹），相位由视角推动（倾斜时扫过）。
    // 用 0.5 + 0.5*sin 而不是 max(0, sin)：后者在半个周期里恒为 0，
    // 卡面上会出现大块完全无色的区域，读起来像「亮度不均」而不是「彩虹带」。
    float stripe = 0.5 + 0.5 * sin(
      (vHoloUv.x * 0.85 + vHoloUv.y * 0.55) * uBands * 2.2
      + (1.0 - facing) * 10.0
      + uTime * 0.06
    );
    // 指数取高一些：色带要**窄**。指数低时峰很宽，整张卡会变成一层均匀色膜，
    // 那不是全息，那是蒙了块彩色玻璃——V-HOLO-2 明确禁止。
    float bands = pow(stripe, 6.0);

    // 第二组更细的纵向带，叠出层次，避免只剩单向条纹
    float fine = pow(0.5 + 0.5 * sin(vHoloUv.y * 17.0 - (1.0 - facing) * 7.0 + uTime * 0.09), 10.0);

    float bandMask = clamp(bands + fine * 0.4, 0.0, 1.0);

    // 彩虹：色相主要随**卡面位置**铺开（这样才像箔上的彩虹），
    // 再叠一个由视角驱动的整体偏移（倾斜时整条光谱扫过）。
    // 位置项系数必须够大：系数太小时色相只能在很窄的一段里变化，
    // 结果整张卡是单色（实测表现为「一片红」）而不是彩虹。
    float hue = fract(vHoloUv.x * 0.55 + vHoloUv.y * 0.3 + (1.0 - facing) * 0.5 + uTime * 0.02);
    vec3 rainbow = hsv2rgb(vec3(hue, 0.85, 1.0));

    // 闪点：高频噪声，只在高光带里出现，模拟金属箔的颗粒
    vec2 sparkleUv = floor(vHoloUv * uUvScale * 26.0);
    float sparkle = step(1.0 - uSparkle * 0.05, hash(sparkleUv)) * (bandMask * 0.6 + fresnel * 0.4);

    vec3 color = (rainbow * (0.6 + bandMask * 0.6) + vec3(sparkle * 0.8)) * uTint;

    /**
     * 叠加幅度。
     *
     * 加色混合下贡献量 = color * alpha，所以 alpha 就是「往卡面加多少亮度的颜色」。
     * 早先的系数让峰值达到 0.23，实测整张卡被染成红色、插画基本看不清；
     * 这里把系数压到 0.3，峰值约 0.18（高档稀有度），既看得见反光又不盖画面。
     * 验收标准始终是「中文名与插画仍可读」，不是「越闪越好」。
     */
    float alpha = clamp((bandMask * 0.75 + fresnel * 0.45 + sparkle * 0.35) * uIntensity * 0.3, 0.0, 0.6);

    // 加色混合下 three 的公式是 src.rgb * src.a + dst，
    // 所以这里输出 **未乘 alpha 的颜色**，alpha 交给混合阶段。
    // 若写成 rgb * alpha，等于把 alpha 用两次，效果会变成几乎不可见的平方衰减。
    gl_FragColor = vec4(color, alpha);
  }
`;
