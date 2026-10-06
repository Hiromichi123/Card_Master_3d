import { Color, type IUniform } from 'three';

/**
 * 全息遮罩层（`V-HOLO-1..4`）。
 *
 * **写这个文件里的 GLSL 注释时，绝对不要用反引号。**
 * 整段着色器是 JS 模板字符串，注释里的一个反引号会提前终止它——
 * 报出来的是 TS1005「',' expected」这种跟真因毫不相干的错。
 * 这个坑本项目已经踩过三次（P1 验证记录第 3.8 节记过第一次）。
 * 要引用什么就写中文引号「」，或者干脆不写。
 *
 * 设计要点：
 *
 * 1. **独立的一层材质，不是改卡面材质**（`V-CARD-4`：插画、边框、全息可分离）。
 *    关掉它就是完全原始的卡面。
 * 2. **反光跟随视角**（`V-HOLO-1`）：渐变与闪烁由**视线方向在卡面局部坐标下的
 *    投影**驱动，而不是屏幕空间渐变。这是 3D 卡里「鼠标位置」的等价物——
 *    展示位那边指针在卡面上走，这边相机绕着卡转，两边喂给下游的是同一组参数
 *    （见 `foilModel.ts` 的 `FoilView`）。
 * 3. **不淹没名称与插画**（`V-HOLO-2`）：整体强度压得很低。
 *    验收标准是「中文名仍然读得清」，不是「看起来最闪」。
 *
 * **参考** `pokemon-cards-css`（GPL-3.0）的 Trainer Gallery 箔：
 * 一个大尺度的 color-dodge 线性渐变给出虹彩金属感，再在光标处叠一层
 * hard-light 径向渐变给出闪烁。**不复制其实现**——没有它的代码、
 * 类名、变量名或数值（`V-HOLO-3`、PLAN 第 3.3 节）。
 */

/**
 * 末尾的索引签名不是装饰：three 的 `uniforms` 要求
 * `{ [name: string]: IUniform }`，只写具名字段会因缺少索引签名而类型不兼容。
 */
export interface HoloUniforms {
  readonly uTime: IUniform<number>;
  /** 整体强度（按稀有度）。 */
  readonly uStrength: IUniform<number>;
  /** 是否用虹彩：0 用 uTint 那一色（该稀有度的代表色），1 用整圈彩虹。 */
  readonly uRainbow: IUniform<number>;
  /** 单色箔的代表色。 */
  readonly uTint: IUniform<Color>;
  readonly [name: string]: IUniform;
}

export function createHoloUniforms(): HoloUniforms {
  return {
    uTime: { value: 0 },
    uStrength: { value: 0 },
    uRainbow: { value: 0 },
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
      把视线方向投到卡面的局部坐标轴上。

      不去求 modelMatrix 的逆：取矩阵的三列就是卡牌的右、上、法线三个轴
      （卡牌是均匀缩放，列向量归一化之后就是旋转部分）。
      求逆在 GLSL ES 1.0 里没有，取列则到处都能用。

      为什么要局部坐标：世界坐标的视线方向在卡牌自转时也会变，
      那样「倾斜卡牌反光不动、转动卡牌反光乱跑」。局部坐标下，
      只有观众相对卡面的角度会影响渐变——这才是箔片的物理。
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
  uniform float uRainbow;
  uniform vec3 uTint;

  varying vec2 vHoloUv;
  varying vec3 vViewLocal;
  varying float vFacing;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    // 视线在卡面局部坐标下的两个分量，就是 3D 卡里的「指针位置」
    vec2 look = vViewLocal.xy;

    /*
      渐变轴：斜着穿过卡面。

      **一个周期横跨整张卡**，这是「金属上的虹彩」而不是「条纹」的关键。
      早先这里叠了两组正弦带互相干涉，读出来是一条条带；而参考实现用的是
      一个大尺度的线性渐变，background-size 放大到 300% 乘 400%，
      所以一个渐变周期就盖满整张卡。
    */
    float along = vHoloUv.x * 0.86 + vHoloUv.y * 0.51;

    // 渐变随视角滑移：倾斜时整片虹彩扫过去
    float sweep = fract(along * 0.85 + look.x * 0.22 + look.y * 0.12 + uTime * 0.015);

    // 虹彩：色相沿渐变轴缓慢铺开
    vec3 iridescent = hsv2rgb(vec3(sweep, 0.78, 1.0));

    // 单色箔：同一个色相上的明暗起伏，读起来是金属表面的过渡
    vec3 tinted = uTint * (0.5 + 1.2 * abs(sin(along * 2.6 + look.y * 0.3)));

    vec3 base = mix(tinted, iridescent, uRainbow);

    /*
      闪烁：跟着视角走的径向光。

      中心取视线方向的**反面**（镜面高光出现在反射方向上：视点在左，
      亮斑就在右）。跟着 look 走会得到相反的运动，
      看起来像光源在动而不是人在动。
    */
    vec2 glareCenter = vec2(0.5) - look * 0.5;
    vec2 glareDelta = vHoloUv - glareCenter;
    float shimmer = exp(-dot(glareDelta, glareDelta) * 16.0);

    // 掠射时整体更亮：箔片的反射本来就出现在斜看的时候
    float glancing = 1.0 - clamp(vFacing, 0.0, 1.0);
    vec3 color = base * (0.55 + shimmer * 0.9 + glancing * 0.35);

    /*
      叠加幅度。

      加色混合下贡献量 = color * alpha，所以 alpha 就是「往卡面加多少亮度的颜色」。
      峰值约 0.2：看得见反光，又不至于把插画和中文名糊掉（V-HOLO-2）。
    */
    float alpha = clamp((0.42 + shimmer * 0.85 + glancing * 0.3) * uStrength * 0.3, 0.0, 0.5);

    // 加色混合下 three 的公式是 src.rgb * src.a + dst，
    // 所以这里输出**未乘 alpha 的颜色**，alpha 交给混合阶段。
    // 若写成 rgb * alpha，等于把 alpha 用两次，效果会变成几乎不可见的平方衰减。
    gl_FragColor = vec4(color, alpha);
  }
`;
