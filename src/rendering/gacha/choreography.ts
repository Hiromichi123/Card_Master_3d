/**
 * 抽卡演出的**编排**：什么时候、哪张卡、在哪、多大、翻到第几成。
 *
 * 这一层是纯数学——不 import three、不 import React，也不碰时间轴。
 * `GachaDriver` 每帧调一次 `samplePose` / `sampleCamera`，把结果写进
 * three 的 group 与相机。分开的好处很直接：**翻卡的时间线可以脱离 3D 单测**，
 * 而「跳过 = 播完」这种性质在 3D 里几乎没法断言。
 *
 * 曲线与 `rendering/anim/motion.ts` 同源（`V-CARD-8` 定的「出牌/部署/抽卡
 * 共用这几条曲线」）：入场从槽位上方下落，落地带过冲，翻面是绕 Y 的 π。
 * 这里用纯数字三元组重写了一遍而没直接调 `motion.ts`——那个模块 import 了 three，
 * 而本层的整条价值就在于不 import 它。两边的一致性由单测里对抛物线的断言把着。
 */

/** 卡面宽高比（`cardGeometry` 的 1 × 1.5）。 */
export const CARD_ASPECT = 1.5;
/** 单抽那张卡的缩放。 */
export const SINGLE_CARD_SCALE = 2.5;
/** 十连时每张卡的缩放。 */
export const TEN_CARD_SCALE = 1.64;
/** 十连的列数。 */
export const TEN_COLUMNS = 5;

/** 起飞点：画面下方偏前，像从牌堆里抬起来。 */
export const DECK_POINT: readonly [number, number, number] = [0, -1.35, 0.25];
/** 从起飞到落位的时长。 */
export const FLIGHT = 0.55;
/** 相邻两张的起飞间隔——错峰就是靠它，十张一起翻读起来是「一坨」。 */
export const STAGGER = 0.22;
export const MENU_CAMERA_DISTANCE = 4.2;
export const UI_EXIT = 0.45;
export const PULL_BACK = 1.1;
export const PUSH_IN = 0.85;
export const FLIP_GAP = 0.12;
export const RARE_FOCUS_HOLD = 0.65;
export const CAMERA_RETURN = 0.45;
export const FALL_HEIGHT = 2.2;
/** 普通卡翻面时长。 */
export const FLIP_BASE = 0.42;
/** 高稀有卡的翻面时长：慢一点，让「这张不一样」读得出来。 */
export const FLIP_HIGH = 0.72;
/** 落位之后多久撒粒子。 */
export const BURST_LEAD = 0.06;
/** 高亮卡在翻面之后停留多久（相机推近就发生在这段里）。 */
export const FOCUS_HOLD_HIGH = 1.6;
export const FOCUS_HOLD_LOW = 0.35;
/** 飞行途中的朝向偏移（弧度）：进场时侧一点，落位时正对镜头。 */
const FLIGHT_TURN = 0.28;

export type Vec3 = readonly [number, number, number];

/** 一张卡的全程时间表。 */
export interface CardShot {
  readonly index: number;
  readonly cardId: string;
  readonly rarity: string;
  /** 落位坐标（x, y），z 恒为 0。 */
  readonly slot: readonly [number, number];
  /** 起飞延迟。 */
  readonly delay: number;
  readonly flight: number;
  /** 开始翻面的绝对时刻。 */
  readonly flipAt: number;
  readonly flipDuration: number;
  /** 撒粒子的绝对时刻。 */
  readonly burstAt: number;
  /** 是否属于高稀有（翻得慢、有额外光效）。 */
  readonly high: boolean;
}

/** 某一帧某张卡的姿态。**就地写入**，不要在每帧 new（R3F 的经典陷阱）。 */
export interface CardPose {
  readonly position: [number, number, number];
  rotationY: number;
  scale: number;
  /**
   * 翻面进度，**与 `CardMesh` 的 `flipControl` 同一套约定**：
   * 0 = 正面朝上（已揭开），1 = 背面朝上（盖着）。
   * 所以「揭开」是 1 → 0，`rotation.y = flip * π`（见 `motion.flipAngle`）。
   */
  flip: number;
  visible: boolean;
}

export interface CameraPose {
  readonly position: [number, number, number];
  readonly target: [number, number, number];
}

export interface CameraKey {
  readonly at: number;
  readonly pose: CameraPose;
}

export interface GachaChoreography {
  readonly shots: readonly CardShot[];
  /** 整段演出的总时长。 */
  readonly total: number;
  readonly cardScale: number;
  /** 相机要聚焦的那一张（并列时取下标最小的）。没有高稀有就是 null。 */
  readonly highlightIndex: number | null;
  readonly camera: readonly CameraKey[];
  /** 全部卡的外接盒（宽, 高），供取景计算。 */
  readonly content: readonly [number, number];
  /** 相机与内容中心的距离。 */
  readonly cameraDistance: number;
  readonly landingStart: number;
  readonly allLandedAt: number;
  readonly revealStart: number;
}

export function createPose(): CardPose {
  return { position: [0, 0, 0], rotationY: 0, scale: 1, flip: 1, visible: false };
}

export function createCameraPose(): CameraPose {
  return { position: [0, 0, 0], target: [0, 0, 0] };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** 落地过冲：先冲过去一点再收回来，`V-CARD-8` 里出牌用的是同一条。 */
function easeOutBackSoft(t: number): number {
  const c = 1.70158 * 0.6;
  const inv = t - 1;
  return 1 + (c + 1) * inv * inv * inv + c * inv * inv;
}

/**
 * 落位坐标。
 *
 * 单抽一张居中；十连摆 5 × 2。间距按**卡的实际大小**算，
 * 所以换缩放不用改间距——卡小了格子跟着小。
 */
export function gridSlots(
  count: 1 | 10,
  cardScale: number,
): readonly (readonly [number, number])[] {
  if (count === 1) {
    return [[0, 0]];
  }
  const width = cardScale;
  const height = cardScale * CARD_ASPECT;
  const columnGap = width * 1.16;
  const rowGap = height * 1.25;
  const slots: (readonly [number, number])[] = [];
  for (let index = 0; index < count; index += 1) {
    const column = index % TEN_COLUMNS;
    const row = Math.floor(index / TEN_COLUMNS);
    slots.push([
      (column - (TEN_COLUMNS - 1) / 2) * columnGap,
      (0.5 - row) * rowGap,
    ]);
  }
  return slots;
}

/** 让 `contentW × contentH` 完整入画所需的距离（还留了 15% 余量）。 */
export function frameDistance(
  contentW: number,
  contentH: number,
  fovDeg: number,
  aspect: number,
): number {
  const halfFov = (fovDeg * Math.PI) / 360;
  const vertical = contentH / 2 / Math.tan(halfFov);
  const horizontal = contentW / 2 / (aspect * Math.tan(halfFov));
  return Math.max(vertical, horizontal) * 1.15;
}

/** 给定距离上，相机能看到多大一块（背景板要盖住它）。 */
export function backdropSize(
  distance: number,
  fovDeg: number,
  aspect: number,
): readonly [number, number] {
  const height = 2 * distance * Math.tan((fovDeg * Math.PI) / 360);
  return [height * aspect, height];
}

export interface BuildArgs {
  readonly cards: readonly { readonly cardId: string; readonly rarity: string }[];
  readonly rankOf: (rarity: string) => number;
  readonly isHighRarity: (rarity: string) => boolean;
  readonly aspect: number;
  readonly initialCamera?: CameraPose;
  readonly fovDeg?: number;
}

/**
 * 排一次演出的全程。
 *
 * **高亮只有一张**：`argmax(rankOf)`，并列取下标最小的。
 * 这一条不是美学取舍——4 个单稀有度限定池是 100% 高稀有，
 * 不这样十连会有 10 张卡同时要求「聚焦」，相机只能在中间来回抽。
 */
export function buildChoreography(args: BuildArgs): GachaChoreography {
  const count = args.cards.length === 1 ? 1 : args.cards.length;
  const cardScale = count === 1 ? SINGLE_CARD_SCALE : TEN_CARD_SCALE;
  const slots = gridSlots(count === 1 ? 1 : 10, cardScale);

  let highlightIndex: number | null = null;
  let highlightRank = -Infinity;
  args.cards.forEach((card, index) => {
    if (!args.isHighRarity(card.rarity)) {
      return;
    }
    const rank = args.rankOf(card.rarity);
    if (rank > highlightRank) {
      highlightRank = rank;
      highlightIndex = index;
    }
  });

  const landingStart = UI_EXIT + PULL_BACK;
  const allLandedAt = landingStart + Math.max(0, args.cards.length - 1) * STAGGER + FLIGHT;
  const revealStart = allLandedAt + PUSH_IN;
  let nextFlipAt = revealStart;
  const shots: CardShot[] = args.cards.map((card, index) => {
    const high = args.isHighRarity(card.rarity);
    const flipDuration = high ? FLIP_HIGH : FLIP_BASE;
    const flipAt = nextFlipAt;
    nextFlipAt += flipDuration + FLIP_GAP + (index === highlightIndex ? RARE_FOCUS_HOLD + CAMERA_RETURN : 0);
    return { index, cardId: card.cardId, rarity: card.rarity, slot: slots[index] ?? [0, 0],
      delay: landingStart + index * STAGGER, flight: FLIGHT, flipAt, flipDuration,
      burstAt: flipAt + flipDuration * 0.5, high };
  });
  const highlight = highlightIndex === null ? null : shots[highlightIndex];
  const flipEnd = shots.reduce((max, shot) => Math.max(max, shot.flipAt + shot.flipDuration), revealStart);
  const focusEnd = highlight ? highlight.flipAt + highlight.flipDuration + RARE_FOCUS_HOLD + CAMERA_RETURN : flipEnd;
  const total = Math.max(flipEnd, focusEnd) + FOCUS_HOLD_LOW;
  const content: readonly [number, number] = [
    cardScale + (slots.length > 1 ? (TEN_COLUMNS - 1) * cardScale * 1.16 : 0),
    slots.length > 1 ? cardScale * CARD_ASPECT * 2.25 : cardScale * CARD_ASPECT,
  ];
  const fovDeg = args.fovDeg ?? 42;
  const cameraDistance = frameDistance(content[0], content[1], fovDeg, args.aspect) * 1.1;
  const initial: CameraPose = args.initialCamera ?? { position: [0, 0, MENU_CAMERA_DISTANCE], target: [0, 0, 0] };
  const dx = initial.position[0] - initial.target[0];
  const dy = initial.position[1] - initial.target[1];
  const dz = initial.position[2] - initial.target[2];
  const initialDistance = Math.hypot(dx, dy, dz);
  const pullDistance = Math.max(cameraDistance * 1.35, initialDistance * 1.35);
  const ratio = pullDistance / Math.max(0.01, initialDistance);
  // Preserve the exact viewing direction until the slow pullback has completed.
  const wide: CameraPose = { position: [initial.target[0] + dx * ratio, initial.target[1] + dy * ratio,
    initial.target[2] + dz * ratio], target: [...initial.target] };
  const rest: CameraPose = { position: [0, 0.1, cameraDistance], target: [0, 0, 0] };
  const camera: CameraKey[] = [{ at: 0, pose: initial }, { at: UI_EXIT, pose: initial },
    { at: landingStart, pose: wide }, { at: allLandedAt, pose: wide }, { at: revealStart, pose: rest }];
  if (highlight) {
    const focusedAt = highlight.flipAt + highlight.flipDuration;
    const focus: CameraPose = { position: [highlight.slot[0] * 0.5, highlight.slot[1] * 0.5 + 0.05, cameraDistance * 0.52],
      target: [highlight.slot[0], highlight.slot[1], 0] };
    camera.push({ at: highlight.flipAt, pose: rest }, { at: focusedAt, pose: focus },
      { at: focusedAt + RARE_FOCUS_HOLD, pose: focus }, { at: focusedAt + RARE_FOCUS_HOLD + CAMERA_RETURN, pose: rest });
  }
  camera.push({ at: total, pose: rest });

  return {
    shots,
    total,
    cardScale,
    highlightIndex,
    camera,
    content,
    cameraDistance,
    landingStart,
    allLandedAt,
    revealStart,
  };
}

/**
 * 某张卡在 `elapsed` 时刻的姿态。
 *
 * 「跳过 = 播完」靠的就是这个函数**无状态**：直接传 `total` 进去，
 * 拿到的就是终态（落位、正面朝上、全尺寸），不需要真的把中间过程跑一遍。
 */
export function samplePose(
  choreo: GachaChoreography,
  index: number,
  elapsed: number,
  out: CardPose,
): CardPose {
  const shot = choreo.shots[index];
  if (!shot) {
    out.visible = false;
    return out;
  }

  // 还没轮到自己：不画。堆在起飞点会十张叠在一起打架
  if (elapsed < shot.delay) {
    out.visible = false;
    out.flip = 1;
    out.scale = choreo.cardScale;
    return out;
  }

  out.visible = true;
  const since = elapsed - shot.delay;
  const flightT = clamp01(since / shot.flight);
  const easedFlight = easeOutCubic(flightT);

  // Descend over the target slot, stay close to the board, and keep the back facing the camera.
  out.position[0] = shot.slot[0];
  out.position[1] = shot.slot[1] + FALL_HEIGHT * (1 - easedFlight);
  out.position[2] = 0.18 * (1 - easedFlight) * Math.max(1, choreo.cardScale);

  out.rotationY = (1 - easedFlight) * FLIGHT_TURN;
  // 落地带一点过冲：从 0.55 倍弹到 1 倍，落到手里才有分量
  out.scale =
    choreo.cardScale * (0.55 + 0.45 * (flightT >= 1 ? 1 : easeOutBackSoft(flightT)));

  const flipT = clamp01((elapsed - shot.flipAt) / shot.flipDuration);
  // 1 = 盖着 → 0 = 揭开（`CardMesh` 的约定，见 `CardPose.flip` 注释）
  out.flip = 1 - easeInOutCubic(flipT);
  // Lift only while rotating: the far edge must clear the nearby board, then settle back at z=0.
  out.position[2] += Math.sin(Math.PI * out.flip) * choreo.cardScale * 0.55;
  return out;
}

/** 相机在 `elapsed` 时刻应该在哪（关键帧之间线性插值，阻尼交给调用方）。 */
export function sampleCamera(
  choreo: GachaChoreography,
  elapsed: number,
  out: CameraPose,
): CameraPose {
  const keys = choreo.camera;
  if (keys.length === 0) {
    return out;
  }
  const first = keys[0] as CameraKey;
  const last = keys[keys.length - 1] as CameraKey;
  if (elapsed <= first.at) {
    writeCamera(out, first.pose);
    return out;
  }
  if (elapsed >= last.at) {
    writeCamera(out, last.pose);
    return out;
  }
  for (let i = 1; i < keys.length; i += 1) {
    const to = keys[i] as CameraKey;
    const from = keys[i - 1] as CameraKey;
    if (elapsed > to.at) {
      continue;
    }
    const span = to.at - from.at;
    const t = span <= 0 ? 1 : (elapsed - from.at) / span;
    const eased = easeInOutCubic(t);
    for (let axis = 0; axis < 3; axis += 1) {
      out.position[axis] =
        (from.pose.position[axis] ?? 0) +
        ((to.pose.position[axis] ?? 0) - (from.pose.position[axis] ?? 0)) * eased;
      out.target[axis] =
        (from.pose.target[axis] ?? 0) +
        ((to.pose.target[axis] ?? 0) - (from.pose.target[axis] ?? 0)) * eased;
    }
    return out;
  }
  writeCamera(out, last.pose);
  return out;
}

function writeCamera(out: CameraPose, pose: CameraPose): void {
  for (let axis = 0; axis < 3; axis += 1) {
    out.position[axis] = pose.position[axis] ?? 0;
    out.target[axis] = pose.target[axis] ?? 0;
  }
}

/**
 * 这一帧该触发哪些爆点：`burstAt ∈ (prev, now]`。
 *
 * **跳过时一次补齐**就靠它：把 `now` 直接给成 `total`，
 * 中间没播到的爆点会全部返回，于是「跳过」与「正常播完」触发的特效
 * 是同一批、同一个次数（只是同一帧内）。
 */
export function dueBursts(
  choreo: GachaChoreography,
  prev: number,
  now: number,
): readonly number[] {
  const due: number[] = [];
  for (const shot of choreo.shots) {
    if (shot.burstAt > prev && shot.burstAt <= now) {
      due.push(shot.index);
    }
  }
  return due;
}

/** 最早开始翻面的时刻——纹理预热门禁用它兜底（别在贴图还没到时就翻）。 */
export function flipStartedAt(choreo: GachaChoreography): number {
  return choreo.shots.reduce(
    (min, shot) => Math.min(min, shot.flipAt),
    Number.POSITIVE_INFINITY,
  );
}

export function landingBeamEnvelope(shot: CardShot, elapsed: number): number {
  const age = elapsed - (shot.delay - 0.16);
  const duration = shot.flight + 0.36;
  if (age < 0 || age >= duration) return 0;
  return Math.min(1, age / 0.16) * Math.min(1, (duration - age) / 0.2);
}
