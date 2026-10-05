import { useMemo } from 'react';

import {
  CARD_DIMENSIONS,
  CARD_FACE_OFFSET,
} from './cardGeometry';
import { getStatTexture, STAT_BADGE_SIZE, type StatKind } from './statBadge';

/**
 * 卡面上的动态数值徽标（`V-CARD-3`）。
 *
 * 与烘焙卡面分离：这里显示的是**当前**攻防与冷却，会被技能改动；
 * 成品卡面上没有任何数值，所以两者不会重复。
 *
 * 位置在卡牌本地坐标系里（+Z 朝上、+Y 朝卡面上方）：
 * 左下 ATK、右下 HP、中下 CD。压在卡面下缘的边框区域内，
 * 不遮挡插画主体。
 */

export interface StatBadgesProps {
  readonly atk: number;
  readonly hp: number;
  readonly cd: number;
  /** 变化中的项会加白圈高亮，用于「这一下改了什么」的即时反馈。 */
  readonly emphasised?: ReadonlySet<StatKind> | undefined;
  /** 卡牌尺寸缩放。准备区的卡更小，但徽标要保持可读。 */
  readonly scale?: number | undefined;
}

/** 徽标在卡面本地坐标下的位置（卡牌为 1×1.5）。 */
const POSITIONS: Record<StatKind, [number, number]> = {
  atk: [-0.3, -0.585],
  hp: [0.3, -0.585],
  cd: [0, -0.585],
};

export function StatBadges({ atk, hp, cd, emphasised, scale = 1 }: StatBadgesProps) {
  const textures = useMemo(
    () => ({
      atk: getStatTexture('atk', atk, emphasised?.has('atk') ?? false),
      hp: getStatTexture('hp', hp, emphasised?.has('hp') ?? false),
      cd: getStatTexture('cd', cd, emphasised?.has('cd') ?? false),
    }),
    [atk, hp, cd, emphasised],
  );

  // CD 徽标略小：它不参与每一次伤害结算，视觉权重低一档
  const sizes: Record<StatKind, number> = {
    atk: STAT_BADGE_SIZE,
    hp: STAT_BADGE_SIZE,
    cd: STAT_BADGE_SIZE * 0.86,
  };

  return (
    <group>
      {(Object.keys(POSITIONS) as StatKind[]).map((kind) => {
        const [x, y] = POSITIONS[kind];
        const size = sizes[kind] * scale;
        return (
          <mesh
            key={kind}
            position={[x * scale, y * scale, CARD_FACE_OFFSET + 0.0018]}
            renderOrder={1}
          >
            <planeGeometry args={[size, size]} />
            {/* 徽标是压在卡面上的贴纸，不参与光照计算：
                如果用受光材质，暗处的卡上数字会一起变暗而读不清 */}
            <meshBasicMaterial map={textures[kind]} transparent depthWrite={false} />
          </mesh>
        );
      })}
    </group>
  );
}

/** 供计算命中盒/贴花位置使用。 */
export const CARD_FACE_Z = CARD_FACE_OFFSET;
export { CARD_DIMENSIONS };
