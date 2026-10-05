/**
 * 战桌的世界坐标布局。
 *
 * 全部用世界坐标表达，不沿用旧版的屏幕像素坐标（`V-WORLD-1`）。
 * 桌面是 XZ 平面，Y 为高度；-Z 是敌方方向，+Z 是玩家方向。
 *
 * 这里的数字都是**可调整的**：改这一处就能改槽位间距、行距与手牌位置，
 * 不需要动场景组件。
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

export const LAYOUT = {
  /** 战斗槽间距。 */
  battleSpacing: 1.16,
  /** 准备槽间距（略窄，避免整行过宽）。 */
  prepSpacing: 0.96,
  /** 战斗行的 z。 */
  battleZ: 1.85,
  /** 准备行的 z。 */
  prepZ: 3.5,
  /** 玩家手牌扇形的基准 z。 */
  handZ: 5.2,

  /**
   * 桌面中心与尺寸。
   *
   * 关键点：内容并不是围绕 z=0 对称的。实际占用范围是
   * 敌方准备区卡牌的后缘（z≈-4.25）到玩家手牌的前缘（z≈+5.9），
   * 中点 z≈0.82、进深约 10.2。桌面按这个中点和进深加少量余量，
   * 两边都不留大段空桌面，也不切到牌。
   */
  tableCenterZ: 0.82,
  tableWidth: 11.6,
  tableDepth: 11.6,
  /** 桌面厚度。 */
  tableThickness: 0.35,
} as const;

export type SlotZone = 'battle' | 'prep';

export interface SlotDescriptor {
  readonly side: SideId;
  readonly zone: SlotZone;
  readonly index: number;
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

/**
 * 生成全部槽位。
 *
 * 排布：己方在 +Z，敌方在 -Z；每方的准备区在自己的战斗区**外侧**
 * （旧版里玩家的等候区在下方、敌方的在上方，这里用同一套世界坐标表达）。
 */
export function buildSlots(): SlotDescriptor[] {
  const slots: SlotDescriptor[] = [];

  for (const offset of battleOffsets) {
    slots.push({
      side: 'player',
      zone: 'battle',
      index: slots.length,
      position: [offset, 0, LAYOUT.battleZ],
    });
  }
  for (const offset of battleOffsets) {
    slots.push({
      side: 'enemy',
      zone: 'battle',
      index: slots.length,
      position: [offset, 0, -LAYOUT.battleZ],
    });
  }
  for (const offset of prepOffsets) {
    slots.push({
      side: 'player',
      zone: 'prep',
      index: slots.length,
      position: [offset, 0, LAYOUT.prepZ],
    });
  }
  for (const offset of prepOffsets) {
    slots.push({
      side: 'enemy',
      zone: 'prep',
      index: slots.length,
      position: [offset, 0, -LAYOUT.prepZ],
    });
  }

  return slots;
}

/** 手牌扇形的第 index 张（共 total 张）的位姿。 */
export function handCardTransform(
  index: number,
  total: number,
): { position: [number, number, number]; rotationY: number; rotationX: number } {
  // 以中间为基准左右展开，并沿弧线向内收，形成扇形
  const centered = total <= 1 ? 0 : index - (total - 1) / 2;
  const spread = 0.62;
  const arcDepth = 0.012 * centered * centered;

  return {
    position: [centered * spread, 0.02, LAYOUT.handZ + arcDepth],
    rotationY: -centered * 0.075,
    // 手牌略微立起，便于阅读
    rotationX: -Math.PI / 2 + 0.42,
  };
}

/** 卡牌平放时的基础旋转：面朝上，纹理上方指向 -Z。 */
export const CARD_FLAT_ROTATION_X = -Math.PI / 2;
