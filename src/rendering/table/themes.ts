import type { SurfaceSpec } from './materials';

/**
 * 战斗台面主题。
 *
 * **移植自** `D:\Github\Chessboard-three.js`（MIT）的
 * `src/render/three/themes.js`。那里的一份主题是一整套外观：
 * 台面与边框的材质、地面与空气的颜色、环境光强度、高亮配色、
 * 以及这个外观想要多少后处理。这里保留同样的结构，
 * 只把「棋盘格」换成战斗桌的格子垫（`mat.light` / `mat.dark`）。
 *
 * 材质一律写成**纯数据**，由 `materials.ts` 构造：
 * 换主题不需要重建场景，也不需要为每个主题准备贴图。
 *
 * 高亮颜色沿用原项目的选择理由：四个提示在红绿色盲下仍可区分——
 * 它们在**明度**上就不同，不靠红/绿一对来承载含义。
 */

export interface TableTheme {
  readonly id: string;
  readonly name: string;
  /** Independent arena geometry; omitted themes retain the classic tiled table. */
  readonly geometry?: 'mecha' | 'volcano' | 'harvest' | 'temple' | 'solar' | 'icefield' | 'abyss';
  /** 一句话描述，显示在切换器里。 */
  readonly blurb: string;

  /** 桌面大板。铺在格子垫与边框之下。 */
  readonly table: { readonly color: number; readonly roughness: number };
  readonly background: number;
  readonly fog: { readonly color: number; readonly near: number; readonly far: number };
  /** 环境贴图强度。没有 HDRI 时它只影响材质对光照的响应。 */
  readonly environmentIntensity: number;

  readonly mat: {
    /** 格子垫的浅色格。 */
    readonly light: SurfaceSpec;
    /** 格子垫的深色格。 */
    readonly dark: SurfaceSpec;
    /** 环绕格子垫的立体边框。 */
    readonly frame: SurfaceSpec;
    /** 嵌线：中线、槽位环、区域边界的强调色。 */
    readonly inlay: number;
  };

  /** 卡牌边缘与槽位提示用的强调色。 */
  readonly accent: {
    /** 常态槽位轮廓。 */
    readonly slot: number;
    /** 可放置。 */
    readonly placeable: number;
    /** 当前目标。 */
    readonly target: number;
  };

  /** 该外观想要的泛光表现。画质档决定是否启用，主题决定启用时的性格。 */
  readonly post: { readonly bloom: number; readonly bloomThreshold: number };
}

const ACCENT_DEFAULT = {
  slot: 0x93a4c2,
  placeable: 0x7fb2ff,
  target: 0xffb457,
} as const;

/** 主投影视角下空气与桌面之间的过渡距离，按场景尺度给的默认值。 */
const FOG_DEFAULT: { readonly near: number; readonly far: number } = { near: 22, far: 62 };

function fog(color: number, near: number = FOG_DEFAULT.near, far: number = FOG_DEFAULT.far) {
  return { color, near, far };
}

/**
 * 雾距离从原项目尺度换算到本项目尺度的系数。
 *
 * 主题里的 `fog.near/far` 是照搬象棋项目的数值，那边的尺度是
 * 棋盘半径 10.3、桌面圆盘半径 46、相机距离 26；本项目是 5.9 / 26 / 约 13，
 * 约为原来的 0.5 倍。**照抄原数值会让雾的起点落在圆盘之外**——
 * 圆盘的远端还没进雾就已经出了视野，边缘是一条硬边，而不是化进背景色。
 *
 * 只换算距离，颜色不动：主题的雾色同时是背景色，是那套氛围本身。
 */
const SCENE_FOG_SCALE = 0.52;

/** 把主题的雾换算到本项目的场景尺度。战斗场景与实验台共用这一处换算。 */
export function sceneFogArgs(spec: TableTheme['fog']): [number, number, number] {
  return [spec.color, spec.near * SCENE_FOG_SCALE, spec.far * SCENE_FOG_SCALE];
}

export const TABLE_THEMES: readonly TableTheme[] = [
  {
    id: 'tournament',
    name: '锦标赛',
    blurb: '木质牌桌承托黄杨木与胡桃木棋盘，大理石地面映出柔和反光。',
    table: { color: 0x6b4b2e, roughness: .36 },
    background: 0x282018,
    fog: fog(0x302822, 52, 128),
    environmentIntensity: .48,
    mat: {
      light: {
        kind: 'wood', color: 0xd9b98a, light: 0xe9d4b0, dark: 0xcaab7e,
        rings: 22, roughness: 0.58, clearcoat: 0.08, envMapIntensity: 0.4,
      },
      dark: {
        kind: 'wood', color: 0x63422a, light: 0x6d4a2c, dark: 0x51341e,
        rings: 20, roughness: 0.6, clearcoat: 0.08, envMapIntensity: 0.4,
      },
      frame: {
        kind: 'wood', color: 0x4a2f1c, light: 0x5a3a22, dark: 0x3d2413,
        rings: 14, angle: 1.2, roughness: 0.38, clearcoat: 0.4,
      },
      inlay: 0xd8c49a,
    },
    accent: ACCENT_DEFAULT,
    post: { bloom: 0.12, bloomThreshold: 0.85 },
  },

  {
    id: 'white-mecha', name: '未来', geometry: 'mecha',
    blurb: '灰银金属装甲与青蓝能源导轨，悬浮科技立方体上的虚空战场。',
    // Darker metallic coating: soft metal reflections replace the earlier ceramic matte finish.
    table: { color: 0x9ba8b1, roughness: .42 },
    background: 0x696f77, fog: fog(0x696f77, 70, 290), environmentIntensity: .75,
    mat: {
      light: { kind: 'plain', color: 0xb0bac2, roughness: .4, metalness: .68, clearcoat: .16, clearcoatRoughness: .28, envMapIntensity: .85 },
      dark: { kind: 'plain', color: 0x8b98a3, roughness: .46, metalness: .72, clearcoat: .12, clearcoatRoughness: .3, envMapIntensity: .8 },
      frame: { kind: 'plain', color: 0x647580, roughness: .34, metalness: .82 },
      inlay: 0x2cacc5,
    },
    accent: { slot: 0x607f8e, placeable: 0x1684b5, target: 0xc88630 },
    post: { bloom: .14, bloomThreshold: 1.08 },
  },

  {
    id: 'volcano',
    name: '火山',
    geometry: 'volcano',
    blurb: '起伏的玄武岩柱承托六角岩台，明亮熔岩在战斗阵列间流动。',
    table: { color: 0x25262a, roughness: .95 },
    background: 0x17181b,
    fog: fog(0x232126, 48, 120),
    environmentIntensity: 0.35,
    mat: {
      light: { kind: 'stone', color: 0x424348, roughness: .94, metalness: .02, envMapIntensity: .24 },
      dark: { kind: 'stone', color: 0x2c2d31, roughness: .94, metalness: .04, envMapIntensity: .24 },
      frame: {
        kind: 'metal', color: 0x2e2422, light: 0x3a2c28, dark: 0x1d1614, roughness: 0.5, metalness: 0.6,
      },
      inlay: 0xff7a3d,
    },
    accent: { slot: 0x8a6a63, placeable: 0x6ee7ff, target: 0xff9a4d },
    post: { bloom: .4, bloomThreshold: 1.05 },
  },

  {
    id: 'marble',
    name: '大理石厅',
    geometry: 'temple',
    blurb: '宽阔希腊神庙中的白色大理石，中央喷泉向两侧水槽分流。',
    table: { color: 0xd0d0c6, roughness: .24 },
    background: 0xbfc5c5,
    fog: fog(0xbfc5c5, 60, 210),
    environmentIntensity: .48,
    mat: {
      light: {
        kind: 'marble', color: 0xf0f0e9, base: 0xf3f1e9, vein: 0xbfc3c0, scale: 7.2,
        roughness: .33, clearcoat: .24, clearcoatRoughness: .2, envMapIntensity: .5,
      },
      dark: {
        kind: 'marble', color: 0x151719, base: 0x191d1f, vein: 0x4b5052,
        roughness: .3, clearcoat: .25, clearcoatRoughness: .18, envMapIntensity: .5,
      },
      frame: { kind: 'metal', color: 0x6b665a, roughness: 0.38, metalness: 0.85, envMapIntensity: 0.6 },
      inlay: 0xb9a97e,
    },
    accent: ACCENT_DEFAULT,
    post: { bloom: .15, bloomThreshold: 1.1 },
  },

  {
    id: 'obsidian',
    name: '太阳系',
    geometry: 'solar',
    blurb: '地球与火星轨道之间的悬浮战桌，太阳、行星与陨石带在星空中缓慢流转。',
    table: { color: 0x05070a, roughness: 0.4 },
    background: 0x07090d,
    fog: fog(0x07090d, 22, 68),
    environmentIntensity: 0.4,
    mat: {
      light: {
        kind: 'stone', color: 0x40474f, roughness: 0.4, metalness: 0.12,
        clearcoat: 0.3, envMapIntensity: 0.6,
      },
      dark: {
        kind: 'stone', color: 0x14181d, roughness: 0.42, metalness: 0.14,
        clearcoat: 0.3, envMapIntensity: 0.6,
      },
      frame: { kind: 'metal', color: 0x2a2f36, roughness: 0.22, metalness: 0.95 },
      inlay: 0x4fd6ff,
    },
    accent: { slot: 0x7f93a8, placeable: 0x49f5c4, target: 0x4fd6ff },
    post: { bloom: 0.55, bloomThreshold: 0.62 },
  },

  {
    id: 'wasteland',
    name: '丰收',
    geometry: 'harvest',
    blurb: '八角石台与起伏麦田，微风吹起金色麦浪与细微花粉。',
    table: { color: 0x777854, roughness: 1 },
    background: 0xb1a581,
    fog: fog(0xb1a581, 52, 140),
    environmentIntensity: 0.4,
    mat: {
      light: { kind: 'stone', color: 0x73785b, roughness: .94, envMapIntensity: .3 },
      dark: { kind: 'stone', color: 0x41483b, roughness: .92, metalness: .02, envMapIntensity: .3 },
      frame: { kind: 'stone', color: 0x6b5c46, light: 0x7d6c53, dark: 0x574a38, roughness: 0.9 },
      inlay: 0xa08b64,
    },
    accent: { slot: 0xb8a483, placeable: 0x8fd694, target: 0xffb457 },
    post: { bloom: 0.12, bloomThreshold: 0.85 },
  },

  {
    id: 'snow',
    name: '冰原',
    geometry: 'icefield',
    blurb: '整面冰层与覆雪边缘，错落冰冠、霜纹和冷雾延伸至远方。',
    table: { color: 0xa3bfcc, roughness: .88 },
    background: 0x5e798e,
    fog: fog(0x8ba5b7, 52, 140),
    environmentIntensity: 0.45,
    mat: {
      light: { kind: 'marble', color: 0x85b7cc, base: 0x85b7cc, vein: 0xc8e0e8, scale: 4.7,
        roughness: .34, clearcoat: .3, clearcoatRoughness: .24, metalness: .02, envMapIntensity: .36 },
      dark: { kind: 'plain', color: 0x5b8ea7, roughness: .4 },
      frame: { kind: 'stone', color: 0x54637a, light: 0x647389, dark: 0x414f63, roughness: 0.6 },
      inlay: 0xdbe6f2,
    },
    accent: { slot: 0x9fb3c8, placeable: 0x7fd4ff, target: 0xffd166 },
    post: { bloom: .18, bloomThreshold: 1.12 },
  },
  {
    id: 'abyss', name: '深渊', geometry: 'abyss',
    blurb: '破裂黑曜石祭台悬于紫灰云旋之上，符文、残门与闪电环绕。固定最高画质。',
    table: { color: 0x272332, roughness: .32 },
    background: 0x090511, fog: fog(0x130a20, 54, 300), environmentIntensity: .4,
    mat: {
      light: { kind: 'stone', color: 0x332c40, roughness: .34, metalness: .26, clearcoat: .5, clearcoatRoughness: .19, envMapIntensity: .75 },
      dark: { kind: 'stone', color: 0x24212d, roughness: .7, metalness: .12, envMapIntensity: .45 },
      frame: { kind: 'metal', color: 0x534255, roughness: .32, metalness: .78, clearcoat: .24, envMapIntensity: .8 },
      inlay: 0xa887d4,
    },
    accent: { slot: 0x9583af, placeable: 0x77deed, target: 0xf5bc7b },
    post: { bloom: .36, bloomThreshold: 1.05 },
  },
];

export const DEFAULT_THEME_ID = 'tournament';

export function getTableTheme(id: string): TableTheme {
  return TABLE_THEMES.find((theme) => theme.id === id) ?? TABLE_THEMES.find((theme) => theme.id === DEFAULT_THEME_ID)!;
}
