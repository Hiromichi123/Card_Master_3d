import { useCallback } from 'react';
import type { Group } from 'three';

import type { CardDefinition } from '../../domain/cards/types';
import { CardMesh } from '../cards/CardMesh';

/**
 * 演出里的一张卡。
 *
 * **两层分工**：外层 `group` 承载编排层算出来的位移/朝向/缩放，
 * 内层 `CardMesh` 留在原点、立着面向相机（`rotationX = 0`）。
 *
 * 为什么不把位移直接交给 `CardMesh`：它自己的 `useFrame` 会写
 * `group.position` / `group.scale` / `group.rotation`（悬停抬升、朝向阻尼那套），
 * 两边写同一个对象，后写的那次会把前一次抹掉。分开两层，各写各的。
 *
 * `rotationX = 0` 也不是随手定的：平躺（`-π/2`）在正对镜头时根本看不到卡面，
 * 而绕 Y 翻 π 这个动作只有在「立着」的时候才读得出是「翻过来」。
 * 顺带避开了「倾角超出 (−2.37, 0.77) 会让盖着的牌翻上来朝上」那个坑（`battle/layout.ts`）。
 */
export interface GachaCardProps {
  readonly card: CardDefinition;
  /** 外部逐帧写入的翻面进度（`CardMesh` 的受控翻面）。 */
  readonly flipControl: { readonly current: number };
  /** 把外层 group 交给驱动器。 */
  readonly register: (group: Group | null) => void;
}

export function GachaCard({ card, flipControl, register }: GachaCardProps) {
  const ref = useCallback(
    (group: Group | null) => {
      register(group);
    },
    [register],
  );

  return (
    <group ref={ref}>
      <CardMesh
        card={card}
        position={[0, 0, 0]}
        rotationX={0}
        rotationY={0}
        faceDown={false}
        flipControl={flipControl}
        /*
          不叠数值徽标：那三个数字是战斗里的动态值，抽卡时它们还没有意义；
          而且徽标贴在卡面外侧，牌翻到一半时会在背面上透出来一层。
          数值在结果面板里给。
        */
        showStats={false}
        interactive={false}
      />
    </group>
  );
}
