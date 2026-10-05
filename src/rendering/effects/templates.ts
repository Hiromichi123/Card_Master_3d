import { Color, Vector3 } from 'three';

import { easeInOutCubic, easeOutCubic, easeOutExpo } from '../anim/easings';
import { Timeline } from '../anim/Timeline';
import type { ParticlePool } from './ParticlePool';

/**
 * 技能特效模板（`VISUAL_SPEC.md` 第 4 节的 9 个模板 + 普通攻击）。
 *
 * 每个模板都是「**起手 → 发射/施法 → 命中 → 余波**」四段结构，
 * 数值上的 `n` 参数只调整**强度、数量、尺度**，不复制出新的效果
 * ——这是施工清单「不为每类技能另建重复框架」的具体落法。
 *
 * 模板只操作粒子池与时间轴，不碰场景图：发射物用「沿弧线位置持续发射粒子」
 * 表现，不再单独建一个弹体 Mesh。这样命中时机与轨迹天然一致，
 * 也不会出现「目标先消失、弹体追向空位置」（`V-FX-3`）。
 */

export type EffectTemplateId =
  | 'normalAttack'
  | 'fireball'
  | 'iceSeal'
  | 'lightning'
  | 'groupFireball'
  | 'groupIceSeal'
  | 'groupLightning'
  | 'shield'
  | 'heal'
  | 'buff'
  | 'debuff'
  | 'flow'
  | 'status';

export interface EffectContext {
  readonly pool: ParticlePool;
  /** 施法/攻击起点，世界坐标。 */
  readonly from: Vector3;
  /** 目标点，世界坐标。 */
  readonly to: Vector3;
  /** 群体效果的额外目标点。 */
  readonly extraTargets: readonly Vector3[];
  readonly color: Color;
  /** 技能参数 n。影响威力相关的观感（体积、亮度）。 */
  readonly intensity: number;
  /** 粒子数量倍数，查看器可调。 */
  readonly countScale: number;
  /** 时长倍数，查看器可调（1 = 正常）。 */
  readonly durationScale: number;
  /** 命中瞬间回调，用于伤害数字、镜头反馈等。 */
  readonly onHit?: (() => void) | undefined;
}

export interface EffectRecipe {
  readonly id: EffectTemplateId;
  /** 镜头震动强度基准，0 表示不震。`V-WORLD-5` 要求可开关且不影响结果。 */
  readonly cameraShake: number;
  build(context: EffectContext): Timeline;
}

/** 复用的临时向量：模板每秒可能被调用多次，不在里面 new。 */
const scratchA = new Vector3();
const scratchB = new Vector3();

/** 烟尘色。放在模块级，避免每次命中都 new 一个 Color。 */
const SMOKE = new Color(0.32, 0.3, 0.34);

/** 按参数缩放粒子数量，并夹在一个合理区间，避免 n=8 的卡刷爆预算。 */
function scaleCount(base: number, context: EffectContext, perIntensity = 3): number {
  const scaled = (base + perIntensity * Math.max(0, context.intensity)) * context.countScale;
  return Math.round(Math.min(scaled, base * 4));
}

/** 时长：基础值 × 参数轻微影响 × 查看器倍数。 */
function dur(base: number, context: EffectContext): number {
  return base * context.durationScale;
}

/** 沿弧线在指定进度处发射拖尾粒子。 */
function emitTrail(
  context: EffectContext,
  from: Vector3,
  to: Vector3,
  t: number,
  height: number,
  count: number,
  color: Color,
  sizeBase: number,
  speed: number,
): void {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  scratchA.lerpVectors(from, to, clamped);
  scratchA.y += 4 * clamped * (1 - clamped) * height;

  context.pool.emit({
    origin: scratchA,
    count,
    // 拖尾是逐帧发射的，必须按帧率归一化
    perFrame: true,
    speed: [speed * 0.4, speed],
    color,
    colorJitter: 0.18,
    size: [sizeBase * 0.7, sizeBase * 1.5],
    life: [0.18, 0.42],
    gravity: 1.2,
    drag: 3.5,
    spawnRadius: 0.035,
  });
}

/** 命中冲击：向外扩散的一圈火花 + 一小团烟尘。 */
function emitImpact(
  context: EffectContext,
  position: Vector3,
  color: Color,
  strength: number,
): void {
  context.pool.emit({
    origin: position,
    count: scaleCount(26, context, 4),
    speed: [1.6 * strength, 4.2 * strength],
    color,
    colorJitter: 0.2,
    size: [0.09, 0.24],
    life: [0.22, 0.5],
    gravity: -2.2,
    drag: 4.5,
    spawnRadius: 0.06,
  });

  // 烟尘：暗一点、慢一点、活得久一点，给冲击一个「体积」
  scratchB.copy(position);
  scratchB.y += 0.06;
  context.pool.emit({
    origin: scratchB,
    count: scaleCount(14, context, 2),
    speed: [0.3, 1.1],
    color: SMOKE,
    colorJitter: 0.1,
    size: [0.28, 0.62],
    life: [0.5, 1.1],
    gravity: 0.45,
    drag: 2.2,
    spawnRadius: 0.12,
  });
}

// ---------------------------------------------------------------------------
// 普通攻击（V-FX-ATK）
// ---------------------------------------------------------------------------

const normalAttack: EffectRecipe = {
  id: 'normalAttack',
  cameraShake: 0.35,
  build(context) {
    const timeline = new Timeline();
    const { pool, from, to, color } = context;
    const hitPoint = scratchA.copy(to);

    // 起手：起点处蓄力，粒子向内收拢
    timeline.add({
      duration: dur(0.12, context),
      easing: easeOutCubic,
      onUpdate: () => {
        pool.emit({
          perFrame: true,
          origin: from,
          count: 2,
          speed: [0.2, 0.8],
          color,
          colorJitter: 0.15,
          size: [0.06, 0.16],
          life: [0.15, 0.32],
          gravity: 0.6,
          drag: 4,
          spawnRadius: 0.12,
        });
      },
    });

    // 挥击：一道快速掠过的粒子弧
    timeline.add({
      duration: dur(0.14, context),
      easing: easeInOutCubic,
      onUpdate: (t) => {
        emitTrail(context, from, hitPoint, t, 0.22, 3, color, 0.11, 2.2);
      },
    });

    // 命中：接触闪光
    timeline.add({
      duration: dur(0.1, context),
      onComplete: () => {
        emitImpact(context, hitPoint, color, 0.8);
        context.onHit?.();
      },
    });

    // 余波
    timeline.add({ duration: dur(0.16, context) });
    return timeline;
  },
};

// ---------------------------------------------------------------------------
// 火焰 / 爆破（V-FX-FIRE）
// ---------------------------------------------------------------------------

const FIRE_CORE = new Color(1, 0.72, 0.32);
const FIRE_TAIL = new Color(1, 0.42, 0.12);

const fireball: EffectRecipe = {
  id: 'fireball',
  cameraShake: 0.6,
  build(context) {
    const timeline = new Timeline();
    const { pool, from, to } = context;
    const height = Math.max(0.5, from.distanceTo(to) * 0.32);

    // 起手：手心聚火
    timeline.add({
      duration: dur(0.16, context),
      easing: easeOutCubic,
      onUpdate: () => {
        scratchB.copy(from);
        pool.emit({
          perFrame: true,
          origin: scratchB,
          count: 3,
          speed: [0.2, 0.7],
          color: FIRE_CORE,
          colorJitter: 0.2,
          size: [0.08, 0.2],
          life: [0.14, 0.3],
          gravity: 1.6,
          drag: 3,
          spawnRadius: 0.1,
        });
      },
    });

    // 飞行：弹体 + 拖尾。粒子沿弧线连续发射，等效于一个带尾迹的弹体
    timeline.add({
      duration: dur(0.34, context),
      easing: (t) => t, // 轨迹本身已经是曲线，再叠加缓动会看不出飞行
      onUpdate: (t) => {
        emitTrail(context, from, to, t, height, scaleCount(4, context), FIRE_CORE, 0.17, 1.4);
        emitTrail(context, from, to, t, height, scaleCount(3, context), FIRE_TAIL, 0.13, 0.9);
      },
    });

    // 命中：冲击环 + 烟尘
    timeline.add({
      duration: dur(0.06, context),
      onComplete: () => {
        emitImpact(context, to, FIRE_CORE, 1 + 0.12 * context.intensity);
        context.pool.emit({
          origin: to,
          count: scaleCount(30, context, 5),
          speed: [2.4, 5.5],
          color: FIRE_TAIL,
          colorJitter: 0.22,
          size: [0.14, 0.36],
          life: [0.3, 0.7],
          gravity: 2.2,
          drag: 3.4,
          spawnRadius: 0.08,
        });
        context.onHit?.();
      },
    });

    // 余波：地面残焰
    timeline.add({
      duration: dur(0.3, context),
      easing: easeOutExpo,
      onUpdate: (t) => {
        if (Math.random() > 0.55 - t * 0.3) {
          pool.emit({
            perFrame: true,
            origin: to,
            count: 1,
            speed: [0.3, 1.2],
            direction: new Vector3(0, 1, 0),
            spread: 0.6,
            color: FIRE_TAIL,
            colorJitter: 0.2,
            size: [0.08, 0.2],
            life: [0.25, 0.6],
            gravity: 1.4,
            drag: 2.6,
            spawnRadius: 0.16,
          });
        }
      },
    });

    return timeline;
  },
};

const groupFireball: EffectRecipe = {
  id: 'groupFireball',
  cameraShake: 0.8,
  build(context) {
    const timeline = new Timeline();
    const targets = [context.to, ...context.extraTargets];
    const height = 1.2;

    // 起手：双手同时聚火
    timeline.add({
      duration: dur(0.18, context),
      onUpdate: () => {
        context.pool.emit({
          perFrame: true,
          origin: context.from,
          count: 4,
          speed: [0.3, 1],
          color: FIRE_CORE,
          colorJitter: 0.2,
          size: [0.1, 0.24],
          life: [0.14, 0.3],
          gravity: 1.6,
          drag: 3,
          spawnRadius: 0.18,
        });
      },
    });

    timeline.add({
      duration: dur(0.36, context),
      easing: (t) => t,
      onUpdate: (t) => {
        // 每颗火球错开一点出发时间，避免整齐得像一个整体
        targets.forEach((target, index) => {
          const offset = index * 0.12;
          const local = (t - offset) / (1 - offset);
          if (local <= 0 || local > 1) {
            return;
          }
          emitTrail(context, context.from, target, local, height, 3, FIRE_CORE, 0.16, 1.2);
          emitTrail(context, context.from, target, local, height, 2, FIRE_TAIL, 0.12, 0.8);
        });
      },
    });

    timeline.add({
      duration: dur(0.08, context),
      onComplete: () => {
        for (const target of targets) {
          emitImpact(context, target, FIRE_CORE, 0.85);
        }
        context.onHit?.();
      },
    });

    timeline.add({ duration: dur(0.24, context) });
    return timeline;
  },
};

// ---------------------------------------------------------------------------
// 冰（V-FX-ICE）
// ---------------------------------------------------------------------------

const ICE = new Color(0.56, 0.84, 1);
const ICE_CORE = new Color(0.86, 0.96, 1);

const iceSeal: EffectRecipe = {
  id: 'iceSeal',
  cameraShake: 0.3,
  build(context) {
    const timeline = new Timeline();
    const { pool, from, to } = context;
    const height = Math.max(0.4, from.distanceTo(to) * 0.28);

    timeline.add({
      duration: dur(0.14, context),
      easing: easeOutCubic,
      onUpdate: () => {
        pool.emit({
          perFrame: true,
          origin: from,
          count: 2,
          speed: [0.2, 0.6],
          color: ICE_CORE,
          colorJitter: 0.1,
          size: [0.07, 0.16],
          life: [0.16, 0.34],
          gravity: 0.2,
          drag: 3.4,
          spawnRadius: 0.09,
        });
      },
    });

    // 冰晶弹体：粒子更大更亮、拖尾更短，观感上与火球区分开
    timeline.add({
      duration: dur(0.3, context),
      easing: (t) => t,
      onUpdate: (t) => {
        emitTrail(context, from, to, t, height, scaleCount(3, context), ICE, 0.14, 0.7);
      },
    });

    // 命中：结晶 + 地面霜环
    timeline.add({
      duration: dur(0.1, context),
      onComplete: () => {
        pool.emit({
          origin: to,
          count: scaleCount(28, context, 4),
          speed: [0.6, 2.4],
          color: ICE_CORE,
          colorJitter: 0.12,
          size: [0.12, 0.3],
          life: [0.4, 0.9],
          gravity: 0.8,
          drag: 2.6,
          spawnRadius: 0.1,
        });
        // 霜环：贴地向外扩散
        pool.emit({
          origin: to,
          count: scaleCount(34, context, 3),
          speed: [1.4, 2.6],
          direction: new Vector3(0, 0.06, 0),
          spread: 0.35,
          color: ICE,
          colorJitter: 0.1,
          size: [0.1, 0.22],
          life: [0.35, 0.75],
          gravity: -0.4,
          drag: 3.6,
        });
        context.onHit?.();
      },
    });

    timeline.add({ duration: dur(0.2, context) });
    return timeline;
  },
};

const groupIceSeal: EffectRecipe = {
  id: 'groupIceSeal',
  cameraShake: 0.45,
  build(context) {
    const timeline = new Timeline();
    const targets = [context.to, ...context.extraTargets];

    timeline.add({
      duration: dur(0.16, context),
      onUpdate: () => {
        context.pool.emit({
          perFrame: true,
          origin: context.from,
          count: 3,
          speed: [0.3, 0.9],
          color: ICE_CORE,
          colorJitter: 0.1,
          size: [0.08, 0.2],
          life: [0.16, 0.34],
          gravity: 0.2,
          drag: 3,
          spawnRadius: 0.16,
        });
      },
    });

    timeline.add({
      duration: dur(0.34, context),
      easing: (t) => t,
      onUpdate: (t) => {
        targets.forEach((target, index) => {
          const offset = index * 0.1;
          const local = (t - offset) / (1 - offset);
          if (local <= 0 || local > 1) {
            return;
          }
          emitTrail(context, context.from, target, local, 0.9, 3, ICE, 0.13, 0.7);
        });
      },
    });

    timeline.add({
      duration: dur(0.1, context),
      onComplete: () => {
        for (const target of targets) {
          context.pool.emit({
            origin: target,
            count: scaleCount(18, context, 2),
            speed: [0.5, 2],
            color: ICE_CORE,
            colorJitter: 0.12,
            size: [0.12, 0.26],
            life: [0.4, 0.8],
            gravity: 0.7,
            drag: 2.6,
            spawnRadius: 0.12,
          });
        }
        context.onHit?.();
      },
    });

    timeline.add({ duration: dur(0.2, context) });
    return timeline;
  },
};

// ---------------------------------------------------------------------------
// 电（V-FX-BOLT）
// ---------------------------------------------------------------------------

const BOLT = new Color(0.75, 0.9, 1);
const BOLT_CORE = new Color(1, 0.98, 0.78);

const lightning: EffectRecipe = {
  id: 'lightning',
  cameraShake: 0.55,
  build(context) {
    const timeline = new Timeline();
    const { pool, from, to } = context;
    const segments = 22;

    // 起手：极短，电荷聚集
    timeline.add({
      duration: dur(0.08, context),
      onUpdate: () => {
        pool.emit({
          perFrame: true,
          origin: from,
          count: 3,
          speed: [0.4, 1.4],
          color: BOLT,
          colorJitter: 0.1,
          size: [0.06, 0.14],
          life: [0.1, 0.22],
          gravity: 0,
          drag: 5,
          spawnRadius: 0.1,
        });
      },
    });

    // 放电：沿折线铺粒子。每帧重新抖动折线，得到「电弧在跳」的观感。
    // 直接连 from→to 会变成一条直棍，必须有横向抖动才是闪电。
    timeline.add({
      duration: dur(0.18, context),
      onUpdate: () => {
        // 抖动在两端收敛、中段最大，电弧才不会脱开起点与目标
        const jitter = 0.2 + 0.07 * context.intensity;
        for (let i = 0; i <= segments; i += 1) {
          const t = i / segments;
          scratchA.lerpVectors(from, to, t);
          // 抖动随路径位置变化：两端贴合、中间最自由，像真实的电弧
          const envelope = Math.sin(Math.PI * t);
          scratchA.x += (Math.random() - 0.5) * jitter * envelope;
          scratchA.y += (Math.random() - 0.5) * jitter * envelope;
          scratchA.z += (Math.random() - 0.5) * jitter * envelope;

          context.pool.emit({
            perFrame: true,
            origin: scratchA,
            count: 2,
            // 速度压得很低：粒子一飞散，电弧就散成一片点，读不出「线」
            speed: [0.02, 0.28],
            color: Math.random() > 0.75 ? BOLT_CORE : BOLT,
            colorJitter: 0.08,
            size: [0.07, 0.18],
            life: [0.08, 0.2],
            gravity: 0,
            drag: 6,
          });
        }
      },
    });

    // 命中：短促的爆闪
    timeline.add({
      duration: dur(0.06, context),
      onComplete: () => {
        pool.emit({
          origin: to,
          count: scaleCount(26, context, 3),
          speed: [1.8, 4.6],
          color: BOLT_CORE,
          colorJitter: 0.1,
          size: [0.1, 0.26],
          life: [0.16, 0.4],
          gravity: -1.4,
          drag: 5,
          spawnRadius: 0.07,
        });
        context.onHit?.();
      },
    });

    timeline.add({ duration: dur(0.14, context) });
    return timeline;
  },
};

const groupLightning: EffectRecipe = {
  id: 'groupLightning',
  cameraShake: 0.75,
  build(context) {
    const timeline = new Timeline();
    const targets = [context.to, ...context.extraTargets];
    const segments = 18;

    timeline.add({ duration: dur(0.08, context) });

    timeline.add({
      duration: dur(0.2, context),
      onUpdate: () => {
        for (const target of targets) {
          for (let i = 0; i <= segments; i += 1) {
            const t = i / segments;
            scratchA.lerpVectors(context.from, target, t);
            const envelope = Math.sin(Math.PI * t);
            const jitter = 0.18 * envelope;
            scratchA.x += (Math.random() - 0.5) * jitter;
            scratchA.y += (Math.random() - 0.5) * jitter;
            scratchA.z += (Math.random() - 0.5) * jitter;
            context.pool.emit({
              perFrame: true,
              origin: scratchA,
              count: 2,
              speed: [0.02, 0.24],
              color: Math.random() > 0.75 ? BOLT_CORE : BOLT,
              colorJitter: 0.08,
              size: [0.06, 0.15],
              life: [0.08, 0.18],
              gravity: 0,
              drag: 6,
            });
          }
        }
      },
    });

    timeline.add({
      duration: dur(0.06, context),
      onComplete: () => {
        for (const target of targets) {
          context.pool.emit({
            origin: target,
            count: scaleCount(16, context, 2),
            speed: [1.4, 3.6],
            color: BOLT_CORE,
            colorJitter: 0.1,
            size: [0.09, 0.22],
            life: [0.14, 0.34],
            gravity: -1.2,
            drag: 5,
            spawnRadius: 0.08,
          });
        }
        context.onHit?.();
      },
    });

    timeline.add({ duration: dur(0.14, context) });
    return timeline;
  },
};

// ---------------------------------------------------------------------------
// 防御 / 闪避 / 免疫（V-FX-GUARD）
// ---------------------------------------------------------------------------

const SHIELD = new Color(0.5, 0.7, 1);
const SHIELD_RIM = new Color(0.85, 0.93, 1);

const shield: EffectRecipe = {
  id: 'shield',
  cameraShake: 0.2,
  build(context) {
    const timeline = new Timeline();
    const { pool, to } = context;

    // 护盾成形：从目标点向外的球面壳层，用粒子堆出一层「曲面」
    timeline.add({
      duration: dur(0.16, context),
      easing: easeOutCubic,
      onUpdate: (t) => {
        const radius = 0.35 + 0.3 * t;
        pool.emit({
          perFrame: true,
          origin: to,
          count: scaleCount(10, context, 2),
          speed: [radius, radius * 1.15],
          color: t > 0.7 ? SHIELD_RIM : SHIELD,
          colorJitter: 0.1,
          size: [0.08, 0.2],
          life: [0.25, 0.5],
          gravity: 0.15,
          drag: 4.5,
          spawnRadius: 0.05,
        });
      },
    });

    // 承受：壳层表面泛起涟漪
    timeline.add({
      duration: dur(0.34, context),
      easing: easeOutExpo,
      onUpdate: (t) => {
        if (Math.random() < 0.7 * (1 - t * 0.5)) {
          pool.emit({
            perFrame: true,
            origin: to,
            count: 2,
            speed: [0.6, 1.3],
            color: SHIELD,
            colorJitter: 0.12,
            size: [0.06, 0.16],
            life: [0.2, 0.45],
            gravity: -0.2,
            drag: 4,
            spawnRadius: 0.45,
          });
        }
      },
    });

    // 碎裂/消散：向外崩开的碎片
    timeline.add({
      duration: dur(0.2, context),
      onComplete: () => {
        pool.emit({
          origin: to,
          count: scaleCount(22, context, 2),
          speed: [1.6, 3.4],
          color: SHIELD_RIM,
          colorJitter: 0.12,
          size: [0.07, 0.18],
          life: [0.25, 0.5],
          gravity: -1.6,
          drag: 3.2,
          spawnRadius: 0.4,
        });
        context.onHit?.();
      },
    });

    return timeline;
  },
};

// ---------------------------------------------------------------------------
// 治疗 / 增益（V-FX-BUFF）
// ---------------------------------------------------------------------------

const HEAL = new Color(0.55, 0.96, 0.72);
const HEAL_CORE = new Color(0.86, 1, 0.92);
const BLESS = new Color(1, 0.86, 0.45);

const heal: EffectRecipe = {
  id: 'heal',
  cameraShake: 0,
  build(context) {
    const timeline = new Timeline();
    const { pool, to } = context;

    // 治疗环：贴地升起一圈
    timeline.add({
      duration: dur(0.18, context),
      easing: easeOutCubic,
      onUpdate: (t) => {
        pool.emit({
          perFrame: true,
          origin: to,
          count: scaleCount(12, context, 2),
          speed: [0.9 * (0.4 + t), 1.6 * (0.4 + t)],
          direction: new Vector3(0, 0.12, 0),
          spread: 0.25,
          color: HEAL,
          colorJitter: 0.1,
          size: [0.1, 0.22],
          life: [0.35, 0.7],
          gravity: -0.3,
          drag: 3.4,
        });
      },
    });

    // 生命流光：向上飘起的光点
    timeline.add({
      duration: dur(0.7, context),
      easing: easeOutExpo,
      onUpdate: (t) => {
        if (Math.random() > 0.35 - t * 0.2) {
          pool.emit({
            perFrame: true,
            origin: to,
            count: 2,
            speed: [0.35, 1],
            direction: new Vector3(0, 1, 0),
            spread: 0.18,
            color: Math.random() > 0.6 ? HEAL_CORE : HEAL,
            colorJitter: 0.12,
            size: [0.08, 0.2],
            life: [0.5, 1.05],
            gravity: -0.55,
            drag: 1.6,
            spawnRadius: 0.3,
          });
        }
      },
    });

    timeline.add({
      duration: dur(0.1, context),
      onComplete: () => context.onHit?.(),
    });

    return timeline;
  },
};

const buff: EffectRecipe = {
  id: 'buff',
  cameraShake: 0,
  build(context) {
    const timeline = new Timeline();
    const { pool, to } = context;

    // 法阵：贴地展开
    timeline.add({
      duration: dur(0.24, context),
      easing: easeOutCubic,
      onUpdate: (t) => {
        const radius = 0.25 + 0.55 * t;
        pool.emit({
          perFrame: true,
          origin: to,
          count: scaleCount(14, context, 2),
          speed: [radius * 0.9, radius * 1.1],
          direction: new Vector3(0, 0.05, 0),
          spread: 0.2,
          color: BLESS,
          colorJitter: 0.14,
          size: [0.09, 0.2],
          life: [0.3, 0.6],
          gravity: 0,
          drag: 4,
        });
      },
    });

    // 上升的剑形/祝福符号（用竖直线状粒子暗示）
    timeline.add({
      duration: dur(0.6, context),
      easing: easeOutExpo,
      onUpdate: (t) => {
        if (Math.random() > 0.3 - t * 0.2) {
          pool.emit({
            perFrame: true,
            origin: to,
            count: 2,
            speed: [0.5, 1.4],
            direction: new Vector3(0, 1, 0),
            spread: 0.1,
            color: BLESS,
            colorJitter: 0.16,
            size: [0.07, 0.17],
            life: [0.45, 0.95],
            gravity: -0.7,
            drag: 1.4,
            spawnRadius: 0.34,
          });
        }
      },
    });

    timeline.add({
      duration: dur(0.1, context),
      onComplete: () => context.onHit?.(),
    });

    return timeline;
  },
};

// ---------------------------------------------------------------------------
// 负面 / 生命交换（V-FX-DEBUFF）
// ---------------------------------------------------------------------------

const CURSE = new Color(0.68, 0.4, 1);
const BLOOD = new Color(1, 0.32, 0.42);

const debuff: EffectRecipe = {
  id: 'debuff',
  cameraShake: 0.3,
  build(context) {
    const timeline = new Timeline();
    const { pool, to, color } = context;

    // 束缚：从四周收拢
    timeline.add({
      duration: dur(0.2, context),
      easing: easeOutCubic,
      onUpdate: (t) => {
        const radius = 0.8 * (1 - t) + 0.2;
        pool.emit({
          perFrame: true,
          origin: to,
          count: scaleCount(10, context, 2),
          speed: [0.2, 0.6],
          color: color ?? CURSE,
          colorJitter: 0.18,
          size: [0.09, 0.2],
          life: [0.25, 0.5],
          gravity: 0.3,
          drag: 3,
          spawnRadius: radius,
        });
      },
    });

    // 生命转移：从目标流向来源
    timeline.add({
      duration: dur(0.5, context),
      easing: easeOutCubic,
      onUpdate: (t) => {
        emitTrail(context, to, context.from, t, 0.5, 2, BLOOD, 0.12, 0.7);
      },
    });

    timeline.add({
      duration: dur(0.12, context),
      onComplete: () => context.onHit?.(),
    });

    return timeline;
  },
};

// ---------------------------------------------------------------------------
// 卡牌流转 / 复制（V-FX-FLOW）
// ---------------------------------------------------------------------------

const FLOW = new Color(0.62, 0.72, 1);

const flow: EffectRecipe = {
  id: 'flow',
  cameraShake: 0,
  build(context) {
    const timeline = new Timeline();
    const { pool, from, to } = context;

    // 卡背飞行：一条由粒子连成的轨迹，带轻微的时钟环暗示
    timeline.add({
      duration: dur(0.42, context),
      easing: easeInOutCubic,
      onUpdate: (t) => {
        emitTrail(context, from, to, t, 0.35, scaleCount(3, context), FLOW, 0.11, 0.5);
      },
    });

    timeline.add({
      duration: dur(0.16, context),
      onComplete: () => {
        pool.emit({
          origin: to,
          count: scaleCount(18, context, 2),
          speed: [0.6, 1.8],
          color: FLOW,
          colorJitter: 0.14,
          size: [0.08, 0.2],
          life: [0.25, 0.55],
          gravity: 0,
          drag: 3.6,
          spawnRadius: 0.12,
        });
        context.onHit?.();
      },
    });

    return timeline;
  },
};

// ---------------------------------------------------------------------------
// 被动状态（V-FX-STATUS）——不持续占用重粒子
// ---------------------------------------------------------------------------

const STATUS = new Color(0.7, 0.76, 0.9);

const status: EffectRecipe = {
  id: 'status',
  cameraShake: 0,
  build(context) {
    const timeline = new Timeline();
    // 只在目标上方打一小簇静态提示粒子，不做持续发射
    timeline.add({
      duration: dur(0.2, context),
      onComplete: () => {
        scratchB.copy(context.to);
        scratchB.y += 0.9;
        context.pool.emit({
          origin: scratchB,
          count: scaleCount(14, context, 1),
          speed: [0.15, 0.5],
          color: STATUS,
          colorJitter: 0.1,
          size: [0.07, 0.15],
          life: [0.5, 0.9],
          gravity: -0.2,
          drag: 3,
          spawnRadius: 0.14,
        });
        context.onHit?.();
      },
    });
    return timeline;
  },
};

// ---------------------------------------------------------------------------

export const EFFECT_RECIPES: Record<EffectTemplateId, EffectRecipe> = {
  normalAttack,
  fireball,
  iceSeal,
  lightning,
  groupFireball,
  groupIceSeal,
  groupLightning,
  shield,
  heal,
  buff,
  debuff,
  flow,
  status,
};

/**
 * 技能族 → 特效模板。
 *
 * 这是 `VISUAL_SPEC.md` 第 4 节那张对照表的代码形式。
 * P4 覆盖全部 35 族时，只需在这里补齐映射，不需要新写效果。
 */
export const FAMILY_TO_EFFECT: Record<string, EffectTemplateId> = {
  fireball: 'fireball',
  bombard: 'fireball',
  explodeOnDeath: 'fireball',
  groupFireball: 'groupFireball',
  groupBombard: 'groupFireball',
  iceSeal: 'iceSeal',
  groupIceSeal: 'groupIceSeal',
  lightning: 'lightning',
  groupLightning: 'groupLightning',
  defense: 'shield',
  armorBreak: 'shield',
  dodge: 'shield',
  immunity: 'shield',
  healAlly: 'heal',
  groupHeal: 'heal',
  selfHeal: 'heal',
  blessing: 'buff',
  groupBlessing: 'buff',
  inspire: 'buff',
  groupInspire: 'buff',
  curse: 'debuff',
  injury: 'debuff',
  vampire: 'debuff',
  berserk: 'debuff',
  selfDestruct: 'debuff',
  drawCard: 'flow',
  soulReturn: 'flow',
  haste: 'flow',
  delay: 'flow',
  clone: 'flow',
  copy: 'flow',
  undying: 'flow',
  rebirth: 'flow',
  silence: 'status',
  counter: 'normalAttack',
};

/** 默认主题色，供没有明确颜色的模板兜底。 */
export const DEFAULT_EFFECT_COLOR = new Color(0.7, 0.8, 1);
