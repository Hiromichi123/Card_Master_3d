import { Color, Vector2, type IUniform } from 'three';

/**
 * 全息遮罩层（`V-HOLO-1..4`）。
 *
 * 设计要点：
 *
 * 1. **独立的一层材质，不是改卡面材质**（`V-CARD-4`：插画、边框、全息可分离）。
 *    关掉它就是完全原始的卡面。
 * 2. **反光跟随视角**（`V-HOLO-1`）：色带位置由**视线方向在卡面局部坐标下的投影**
 *    驱动，而不是屏幕空间渐变。这是 3D 卡里「鼠标位置」的等价物——
 *    图鉴那边指针在卡面上移动，这边相机绕着卡转，两者喂给下游的是同一组参数
 *    （见 `foilModel.ts` 的 `FoilView`）。
 * 3. **不淹没名称与插画**（`V-HOLO-2`）：条纹遮罩让亮带只占一部分面积，
 *    整体强度也压得很低。验收标准是「中文名仍然读得清」，不是「看起来最闪」。
 *
 * **参考** `pokemon-cards-css`（GPL-3.0）的**视觉规律**——斜向彩虹带、
 * 两组错位色带互相干涉形成"波浪"、细扫描线、跟着视角走的眩光。
 * **不复制其实现**：没有它的代码、类名、变量名或数值（`V-HOLO-3`、PLAN 第 3.3 节）。
 */

/**
 * 末尾的索引签名不是装饰：three 的 `uniforms` 要求
 * `{ [name: string]: IUniform }`，只写具名字段会因缺少索引签名而类型不兼容。
 */
export interface HoloUniforms {
  readonly uTime: IUniform<number>;
  /** 整体强度（按稀有度）。 */
  readonly uStrength: IUniform<number>;
  /** 色带重复密度。 */
  readonly uDensity: IUniform<number>;
  /** 色相在卡面上铺开的速度。 */
  readonly uHueSpread: IUniform<number>;
  /** 细扫描线的频率；0 表示不画。 */
  readonly uScanlines: IUniform<number>;
  /** 星点强度；0 表示不撒。 */
  readonly uSpeckle: IUniform<number>;
  /** 金色收敛程度：0 纯彩虹，1 纯金。 */
  readonly uGilt: IUniform<number>;
  /** 色带的软硬：越大带越窄越锐。画廊箔要更宽更柔。 */
  readonly uSharpness: IUniform<number>;
  /** 是否用彩虹：0 用 uTint 那一色（该稀有度的代表色），1 用彩虹。 */
  readonly uRainbow: IUniform<number>;
  /** 卡面 UV 尺寸，用于把闪点保持成近似方形。 */
  readonly uUvScale: IUniform<Vector2>;
  readonly uTint: IUniform<Color>;
  readonly [name: string]: IUniform;
}

export function createHoloUniforms(): HoloUniforms {
  return {
    uTime: { value: 0 },
    uStrength: { value: 0 },
    uDensity: { value: 3.4 },
    uHueSpread: { value: 0.55 },
    uScanlines: { value: 26 },
    uSpeckle: { value: 0.2 },
    uGilt: { value: 0 },
    uSharpness: { value: 1 },
    uRainbow: { value: 0 },
    uUvScale: { value: new Vector2(3, 4.5) },
    uTint: { value: new Color(1, 1, 1) },
  };
}

export const HOLO_VERTEX_SHADER = /* glsl */ `
  varying vec2 vHoloUv;
  varying vec3 vViewLocal;
  varying float vFacing;

  void main() {
    vHoloUv = uv;

    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
    vec3 toCamera = normalize(cameraPosition - worldPosition.xyz);

    /*
      把视线方向投到**卡面的局部坐标轴**上。

      这里不去求 modelMatrix 的逆：取矩阵的三列就是卡牌的右、上、法线三个轴
      （卡牌是均匀缩放，列向量归一化之后就是旋转部分）。
      求逆在 GLSL ES 1.0 里没有，取列则到处都能用。

      为什么要局部坐标：世界坐标的视线方向在卡牌自转时也会变，
      那样"倾斜卡牌反光不动、转动卡牌反光乱跑"。局部坐标下，
      只有**观众相对卡面的角度**会影响色带——这才是箔片的物理。
    */
    vec3 cardRight = normalize(modelMatrix[0].xyz);
    vec3 cardUp = normalize(modelMatrix[1].xyz);
    vec3 cardNormal = normalize(modelMatrix[2].xyz);

    vViewLocal = vec3(dot(toCamera, cardRight), dot(toCamera, cardUp), dot(toCamera, cardNormal));
    vFacing = abs(dot(toCamera, worldNormal));

    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const HOLO_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;

  uniform float uTime;
  uniform float uStrength;
  uniform float uDensity;
  uniform float uHueSpread;
  uniform float uScanlines;
  uniform float uSpeckle;
  uniform float uGilt;
  uniform float uSharpness;
  uniform float uRainbow;
  uniform vec2 uUvScale;
  uniform vec3 uTint;

  varying vec2 vHoloUv;
  varying vec3 vViewLocal;
  varying float vFacing;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    // 视线在卡面局部坐标下的两个分量，就是 3D 卡里的「指针位置」
    vec2 look = vViewLocal.xy;
    // 掠射程度：正对 0，越斜越大。箔片的反光主要出现在斜看的时候
    float glancing = 1.0 - clamp(vFacing, 0.0, 1.0);

    // 卡面上的两条正交轴：主方向斜着走，副方向与它垂直
    float along = vHoloUv.x * 0.86 + vHoloUv.y * 0.51;
    float across = vHoloUv.x * -0.51 + vHoloUv.y * 0.86;

    /*
      两组色带互相干涉。

      这是这套观感的关键手法：单独一组正弦带看起来是"印在卡上的条纹"，
      两组周期略不同的带叠在一起才会出现宽窄交替的波浪——
      那才是箔片的压纹感。两组都乘上视角相位，倾斜时整片一起扫过。
    */
    float phaseA = along * uDensity * 2.0 + (look.x + look.y) * 3.4 + uTime * 0.05;
    float phaseB = across * uDensity * 0.73 - (look.x - look.y) * 2.1 - uTime * 0.03;

    /*
      指数决定色带的宽窄。

      指数低时峰很宽，整张卡会变成一层均匀色膜——那不是全息，
      是蒙了块彩色玻璃（V-HOLO-2 明确禁止）。但指数过高、带子太细，
      在缩略尺寸下又会碎成噪声。

      所以它是个可调项：画廊箔要更宽更柔（uSharpness 小），
      常规箔要更细更锐（uSharpness 大）。
    */
    float exponent = 2.0 + uSharpness * 5.0;
    float bandA = pow(0.5 + 0.5 * sin(phaseA), exponent);
    float bandB = pow(0.5 + 0.5 * sin(phaseB), exponent + 2.0);
    float bands = clamp(bandA * 0.78 + bandB * 0.42, 0.0, 1.0);

    /*
      细扫描线：垂直于主方向的密纹。

      它是「箔」而非「贴纸」的分界——只有宽色带时读起来像印了张彩虹图，
      加上密纹之后才像金属箔上的压印。频率由 uScanlines 给，0 表示这类箔不画。
    */
    float scanline = uScanlines > 0.5
      ? pow(0.5 + 0.5 * sin(along * uScanlines * 6.0 + 1.2), 3.0)
      : 0.0;

    /*
      眩光：一团跟着视角走的亮斑。

      位置取"视线方向的**反面**"（0.5 - look*0.5），因为镜面高光出现在
      光线反射的方向上——视点在左，亮斑就在右。跟着 look 走会得到相反的运动，
      看起来像光源在动而不是人在动。
    */
    vec2 glareCenter = vec2(0.5) - look * 0.5;
    vec2 glareDelta = vHoloUv - glareCenter;
    float glare = exp(-dot(glareDelta, glareDelta) * 22.0);

    float hue = fract(
      along * uHueSpread * 0.6
      + look.x * 0.35
      + look.y * 0.18
      + uTime * 0.02
    );
    vec3 rainbow = hsv2rgb(vec3(hue, 0.85, 1.0));
    // 单色箔：用该稀有度的代表色（uTint），色相只做一点点偏移，
    // 免得整片死板；画廊箔用整圈彩虹
    vec3 mono = uTint * (0.75 + 0.5 * hue);
    vec3 base = mix(mono, rainbow, uRainbow);
    // 金色收敛：越接近 1 越像金箔，而不是彩虹
    vec3 color = mix(base, vec3(1.0, 0.82, 0.42), uGilt);

    // 闪点：高频噪声，只在高光带里出现，模拟金属箔的颗粒
    vec2 sparkleUv = floor(vHoloUv * uUvScale * 26.0);
    float sparkle = uSpeckle > 0.0
      ? step(1.0 - uSpeckle * 0.06, hash(sparkleUv)) * (bands * 0.6 + glancing * 0.4)
      : 0.0;

    float highlight = clamp(bands * (0.55 + scanline * 0.45) + glare * 0.8 + sparkle * 0.5, 0.0, 1.6);

    /*
      叠加幅度。

      加色混合下贡献量 = color * alpha，所以 alpha 就是「往卡面加多少亮度的颜色」。

      两头都试过：系数到 0.23 时整张卡被染红、插画基本看不清；
      而 0.32 那一版又几乎看不见——加色峰值只有 0.08，卡牌摊在桌上时
      相机接近垂直、glancing 本来就小，两下叠起来箔片等于没有。

      现在的重点是**让色带在正对时也成立**：highlight 的权重占大头、
      glancing 只做加成。箔片严格来说只在斜看时反光，但游戏里大部分时间
      就是正对着看的，全靠斜视才出现的效果等于不存在。
      验收标准始终是「中文名与插画仍可读」，不是「越闪越好」。
    */
    float alpha = clamp(
      (highlight * 0.85 + glancing * 0.15) * uStrength * 0.52,
      0.0,
      0.5
    );

    // 加色混合下 three 的公式是 src.rgb * src.a + dst，
    // 所以这里输出**未乘 alpha 的颜色**，alpha 交给混合阶段。
    // 若写成 rgb * alpha，等于把 alpha 用两次，效果会变成几乎不可见的平方衰减。
    gl_FragColor = vec4(color * uTint, alpha);
  }
`;
