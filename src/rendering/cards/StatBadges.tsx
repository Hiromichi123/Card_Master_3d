import { useMemo } from 'react';

import { CARD_DIMENSIONS, CARD_FACE_OFFSET } from './cardGeometry';
import { getStatTexture, type StatKind } from './statBadge';

/**
 * 卡面上的动态数值徽标（`V-CARD-3`）。
 *
 * 与烘焙卡面分离：这里显示的是**当前**攻防与冷却，会被技能改动；
 * 成品卡面上没有任何数值，所以两者不会重复。
 *
 * **同三个数字在不同区域要换一种摆法**，因为它们回答的问题不一样：
 *
 * | 区域 | 攻/血 | 冷却 |
 * | --- | --- | --- |
 * | 手牌 | 底边左右两半 | 右上角小字（还在算，随时会看） |
 * | 等待区 | 底边左右两半 | **卡面正中央的大数字**——这里是「还要等几回合」，是这张牌唯一的悬念 |
 * | 战斗区 | 底边左右两半 | **不显示**：已经上场，冷却不再是玩家要盯的信息 |
 *
 * 卡牌本地坐标是 1（宽）× 1.5（高），原点在卡面中心。
 */

/** 数值摆在哪一区。 */
export type StatLayout = 'hand' | 'prep' | 'battle';

export interface StatBadgesProps {
  readonly atk: number;
  readonly hp: number;
  readonly cd: number;
  /** 变化中的项会换成亮色，用于「这一下改了什么」的即时反馈。 */
  readonly emphasised?: ReadonlySet<StatKind> | undefined;
  readonly layout?: StatLayout | undefined;
}

/** 卡牌本地坐标下的边长。1 是卡宽。 */
const HALF = 0.25;
/** 攻/血的纵坐标。取 −0.53 时，0.42 的方块正好收在卡面下缘（−0.75）之内。 */
const BOTTOM_Y = -0.53;
const BOTTOM_SIZE = 0.42;
/** 手牌上的冷却：右上角，小一号。 */
const HAND_CD_POS: [number, number] = [0.34, 0.6];
const HAND_CD_SIZE = 0.24;
/** 等待区的冷却：卡面正中央，大数字。 */
const PREP_CD_SIZE = 0.82;

export function StatBadges({
  atk,
  hp,
  cd,
  emphasised,
  layout = 'battle',
}: StatBadgesProps) {
  const textures = useMemo(
    () => ({
      atk: getStatTexture('atk', atk, emphasised?.has('atk') ?? false),
      hp: getStatTexture('hp', hp, emphasised?.has('hp') ?? false),
      cd: getStatTexture('cd', cd, emphasised?.has('cd') ?? false),
    }),
    [atk, hp, cd, emphasised],
  );

  const plates: { key: string; texture: typeof textures.atk; x: number; y: number; size: number }[] =
    [
      // 攻在左半边、血在右半边，各自居中于自己那一半——不越过卡牌左右边界
      { key: 'atk', texture: textures.atk, x: -HALF, y: BOTTOM_Y, size: BOTTOM_SIZE },
      { key: 'hp', texture: textures.hp, x: HALF, y: BOTTOM_Y, size: BOTTOM_SIZE },
    ];

  if (layout === 'hand') {
    plates.push({
      key: 'cd',
      texture: textures.cd,
      x: HAND_CD_POS[0],
      y: HAND_CD_POS[1],
      size: HAND_CD_SIZE,
    });
  } else if (layout === 'prep') {
    plates.push({ key: 'cd', texture: textures.cd, x: 0, y: 0, size: PREP_CD_SIZE });
  }

  return (
    <group>
      {plates.map((plate) => (
        <mesh
          key={plate.key}
          /*
            位置与尺寸都是**卡牌本地坐标**，不再乘一遍缩放：
            整个 `<group>` 已经按卡牌缩放过了，这里再乘一次就是平方——
            战斗区 1.5 倍时数字会跑到卡牌外面去（实机上是一排数字浮在牌下方）。
            徽标跟着卡牌一起变大变小，准备区小一号、战斗区大一号，正是想要的。
          */
          position={[plate.x, plate.y, CARD_FACE_OFFSET + 0.0018]}
          renderOrder={1}
        >
          <planeGeometry args={[plate.size, plate.size]} />
          {/* 徽标是压在卡面上的贴纸，不参与光照计算：
              如果用受光材质，暗处的卡上数字会一起变暗而读不清 */}
          <meshBasicMaterial map={plate.texture} transparent depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/** 供计算命中盒/贴花位置使用。 */
export const CARD_FACE_Z = CARD_FACE_OFFSET;
export { CARD_DIMENSIONS };
