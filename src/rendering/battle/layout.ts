/**
 * 战桌的世界坐标布局。
 *
 * 全部用世界坐标表达，不沿用旧版的屏幕像素坐标（`V-WORLD-1`）。
 * 桌面是 XZ 平面，Y 为高度；-Z 是敌方方向，+Z 是玩家方向。
 *
 * 这里的数字都是**可调整的**：改这一处就能改槽位间距、行距与手牌位置，
 * 不需要动场景组件。
 *
 * **对称性只有一个来源。** 双方的行都按「盘面中心 ± 行偏移」算，
 * 不是一边取 `+z`、另一边取 `-z`——后者的对称轴是世界原点，
 * 而盘面中心在 `BOARD_CENTER_Z`，两者不重合，画出来就是一边贴边一边空一大截。
 */

import type { SideId } from '../../domain/cards/types';
import { CARD_DIMENSIONS } from '../cards/cardGeometry';

/**
 * 卡牌实体尺寸。
 *
 * 真正的定义在 `rendering/cards/cardGeometry.ts`——几何、UV 与命中盒都要用它，
 * 必须只有一处来源；这里只是转发，方便布局代码就近引用。
 * 原始卡面是 720×1080，比例 2:3。
 */
export const CARD_SIZE = CARD_DIMENSIONS;

/** 战斗槽：每方 5 个（旧版 `BBS:44`）。 */
export const BATTLE_SLOT_COUNT = 5;
/** 准备区：每方 8 个（旧版 `BBS:45`）。 */
export const PREP_SLOT_COUNT = 8;

/** 盘面（8×8 格子垫）中心在世界里的 z。所有行都围绕它对称排布。 */
export const BOARD_CENTER_Z = 0.82;

/**
 * 各行相对盘面中心的偏移（绝对值，符号由 `side` 决定）。
 *
 * 数值是这样定出来的：
 * - 战斗行放大到 1.5 倍后单张高 2.25，行中心在 1.8 时两排之间留 1.45 的空档，
 *   与准备行之间也还有 0.29；
 * - 准备行放在 4.0，卡片外缘 4.79，收在格子垫（半深 5.2）以内；
 * - 手牌在 6.05，整个落在格子垫之外。
 *
 * **手牌不能只看它在世界里的位置。** 抬高之后它在屏幕上会往上跑：
 * 抬 1.2 个单位，在 46° 的俯角下约等于往盘面里挪 0.83。
 * 第一版把牌放在 5.45、抬 1.5，屏幕上正好压在准备行上——准备区的牌全被挡住。
 * 所以这里是「离盘面中心的距离 − 抬高换算出来的视觉位移」一起算出来的，
 * 而不是只把牌挪出格子垫了事。
 */
const ROW = {
  battle: 1.8,
  prep: 4.0,
  hand: 6.4,
} as const;

/**
 * 各区的卡牌缩放。
 *
 * 战斗区是全场的视觉中心，放大到 1.5 让它真正占住棋盘；
 * 准备区只比原来大一点（0.86 → 1.05），它是等候席，不该跟主战场抢注意力。
 */
export const BATTLE_CARD_SCALE = 1.5;
export const PREP_CARD_SCALE = 0.88;
export const HAND_CARD_SCALE = 1.15;
export const PILE_CARD_SCALE = 0.62;

/** 牌堆/弃牌堆在各自准备行外侧的位置，以及距盘面中心的偏移。 */
export const PILE_X = 4.72;
export const PILE_Z_OFFSET = ROW.prep;

export const LAYOUT = {
  /** 战斗槽间距。5 张 1.5 宽的卡排开占 8.9，收在格子垫的 10.4 之内。 */
  battleSpacing: 1.85,
  /** 准备槽间距。8 张 1.05 宽的卡排开占 8.4，两端还给牌堆/弃牌堆留出位置。 */
  prepSpacing: 1.05,
  /** 战斗行的 z（玩家侧；敌方是它关于盘面中心的镜像）。 */
  battleZ: BOARD_CENTER_Z + ROW.battle,
  /** 准备行的 z（玩家侧）。 */
  prepZ: BOARD_CENTER_Z + ROW.prep,
  /** 玩家手牌扇形的基准 z（玩家侧）。 */
  handZ: BOARD_CENTER_Z + ROW.hand,

  /**
   * 桌面中心与尺寸。
   *
   * 桌面按内容的实际外接范围加少量余量，两边都不留大段空桌面。
   * 现在的内容范围是「敌方手牌 → 我方手牌」，比 P2 时期更深，
   * 所以桌面进深跟着加大。
   */
  tableCenterZ: BOARD_CENTER_Z,
  tableWidth: 11.6,
  tableDepth: 13.4,
  /** 桌面厚度。 */
  tableThickness: 0.35,
} as const;

export type SlotZone = 'battle' | 'prep';

export interface SlotDescriptor {
  readonly side: SideId;
  readonly zone: SlotZone;
  /**
   * 全局下标（0..25），按「玩家战斗区 → 敌方战斗区 → 玩家准备区 → 敌方准备区」编号。
   *
   * 它只用于 `slotKey()` 这类**稳定标识**。别拿它当引擎里的槽位下标——
   * `SideZones.battle` / `prep` 用的是**每侧**下标（0..4 / 0..7），
   * 两者混用会把牌放到别人的槽里（P3 踩过：点准备槽报 `noEmptyPrepSlot`）。
   */
  readonly index: number;
  /** 每侧下标。进引擎、进布局，都用这个。 */
  readonly rowIndex: number;
  /** 槽位中心的世界坐标。 */
  readonly position: readonly [number, number, number];
}

/** 一行槽位居中排列，返回各槽的 x 坐标。 */
function rowOffsets(count: number, spacing: number): number[] {
  const span = (count - 1) * spacing;
  return Array.from({ length: count }, (_, i) => i * spacing - span / 2);
}

const battleOffsets = rowOffsets(BATTLE_SLOT_COUNT, LAYOUT.battleSpacing);
const prepOffsets = rowOffsets(PREP_SLOT_COUNT, LAYOUT.prepSpacing);

/** 某一侧某一行中心的世界 z。对称性就靠这一个函数。 */
export function rowZ(side: SideId, offset: number): number {
  return side === 'player' ? BOARD_CENTER_Z + offset : BOARD_CENTER_Z - offset;
}

/**
 * 生成全部槽位。
 *
 * 排布：己方在 +Z，敌方在 -Z；每方的准备区在自己的战斗区**外侧**
 * （旧版里玩家的等候区在下方、敌方的在上方，这里用同一套世界坐标表达）。
 */
export function buildSlots(): SlotDescriptor[] {
  const slots: SlotDescriptor[] = [];

  const push = (
    side: SideId,
    zone: SlotZone,
    offsets: readonly number[],
    zOffset: number,
  ): void => {
    const z = rowZ(side, zOffset);
    offsets.forEach((offset, rowIndex) => {
      slots.push({
        side,
        zone,
        index: slots.length,
        rowIndex,
        position: [offset, 0, z],
      });
    });
  };

  push('player', 'battle', battleOffsets, ROW.battle);
  push('enemy', 'battle', battleOffsets, ROW.battle);
  push('player', 'prep', prepOffsets, ROW.prep);
  push('enemy', 'prep', prepOffsets, ROW.prep);

  return slots;
}

/**
 * 手牌的位姿参数。
 *
 * 手牌从「摊在盘面里」改成「浮在盘外、抬到空中、朝自己这侧立起来」，
 * 读起来才像握在手里，也才不跟棋盘上的格子抢位置。
 */
export const HAND = {
  /** 相邻两张的横向间距。早期配置是 0.62，那时卡是 1.0 宽，按比例放到 1.15。 */
  spread: 0.72,
  /**
   * 抬离桌面的高度。
   *
   * 抬得越高，牌在屏幕上越往上跑（46° 俯角下约等于往盘面里挪 `lift × 0.7`）。
   */
  lift: 0.85,
  /**
   * 相对平放再立起来的角度。
   *
   * 取回早期配置的 0.42：0.42 是一把**摊开的手牌**，1.2 接近竖着举牌，
   * 后者虽然屏幕投影更矮、更不容易压到准备行，但看起来不像在打牌。
   * 不压到准备行改由「离盘面中心更远」来保证，见 `ROW`。
   */
  tilt: 0.42,
  /** 扇形的弧深系数：越靠外侧越往后收一点。取回早期配置。 */
  arc: 0.012,
  /**
   * 手牌扇形的**层高差**：越靠左（玩家视角）抬得越高。
   *
   * 冷却数字在卡牌的右上角，而扇形里右边的牌会压住左边那张的右上角。
   * 让左边的牌高一点点，它就压在右边的牌之上，角上的数字不会被吃掉；
   * 差值不能太小：扇形本身还带一点**弧深**（外侧的牌往后收 0.012），
   * 那点深度差会把左边的牌推到后面去，0.02 的层高差压不过它——
   * 实测左牌的冷却数字还是被中间那张盖住了。0.04 才稳。
   */
  stackStep: 0.04,
  /** 悬停时再抬起的高度。 */
  hoverLift: 0.5,
  /** 悬停时的放大倍数。 */
  hoverScale: 1.18,
} as const;

/**
 * 手牌扇形的第 index 张（共 total 张）的位姿。
 *
 * 敌方是**整套镜像**的：横向位置、扇形角度、立起方向都取反，
 * 于是两把牌各自朝自己的玩家倾，而不是并排朝同一个方向。
 *
 * **立起方向与 `faceDown` 会互相影响，这里有个约束。**
 * 盖着的牌靠「绕 Y 转 π」翻面，而倾角参与同一个欧拉旋转：
 * 牌面朝向相机与否，取决于 `sin(θ − 相机俯角)` 的符号（θ 是倾角）。
 * 只有 θ 落在约 (−2.37, 0.77) 区间内，盖着的牌才真的盖着。
 * 玩家侧 θ = −π/2 + 0.42、敌方 θ = −π/2 − 0.42 都在区间内；
 * 但**倾角不能调大到 0.8 以上**，否则敌方手牌会翻过来朝上
 * （P3 早期用 0.95 时就是这样，当时误判成「镜像会导致翻面」）。
 */
export function handCardTransform(
  index: number,
  total: number,
  side: SideId,
): { position: [number, number, number]; rotationY: number; rotationX: number } {
  const centered = total <= 1 ? 0 : index - (total - 1) / 2;
  const arcDepth = HAND.arc * centered * centered;
  const sign = side === 'player' ? 1 : -1;
  // 世界坐标里的「左侧」：玩家是下标小的，敌方因为镜像过来而是下标大的
  const stackIndex = side === 'player' ? total - 1 - index : index;

  return {
    position: [
      sign * centered * HAND.spread,
      HAND.lift + stackIndex * HAND.stackStep,
      rowZ(side, ROW.hand + arcDepth),
    ],
    rotationY: -sign * centered * 0.075,
    // 平放是 -π/2，加一个正角就立起来；敌方取负，朝它自己那一侧倾
    rotationX: -Math.PI / 2 + sign * HAND.tilt,
  };
}

/** 牌堆 / 弃牌堆在某一侧的位置。 */
export function pilePosition(side: SideId, kind: 'deck' | 'discard'): readonly [number, number, number] {
  return [
    kind === 'deck' ? -PILE_X : PILE_X,
    0,
    rowZ(side, PILE_Z_OFFSET),
  ];
}

/** 卡牌平放时的基础旋转：面朝上，纹理上方指向 -Z。 */
export const CARD_FLAT_ROTATION_X = -Math.PI / 2;
