import { useMemo } from 'react';

import { buildSlots, CARD_SIZE } from './layout';

/**
 * 槽位标记。
 *
 * `V-TABLE-2`：常态低对比，只有「可放置」状态才提高对比。
 * 这里只画几何与两种状态的材质参数，不管交互逻辑——
 * 哪些槽可放置由上层传入，避免渲染层自己推断规则。
 */

export type SlotHighlight = 'none' | 'placeable' | 'target';

interface Props {
  /**
   * 可放置的槽位键集合。键格式见 `slotKey()`。
   *
   * 显式写上 `| undefined`：`exactOptionalPropertyTypes` 下「缺省」与
   * 「显式传 undefined」是两回事，而调用方常常持有 `Set | undefined`。
   */
  readonly placeable?: ReadonlySet<string> | undefined;
  /** 当前被选为目标的槽位键。 */
  readonly targeted?: ReadonlySet<string> | undefined;
}

/** 槽位稳定键，供上层做集合查找。 */
export function slotKey(side: string, zone: string, index: number): string {
  return `${side}:${zone}:${index}`;
}

export function SlotMarkers({ placeable, targeted }: Props) {
  const slots = useMemo(() => buildSlots(), []);

  return (
    <group>
      {slots.map((slot) => {
        const key = slotKey(slot.side, slot.zone, slot.index);
        const isTarget = targeted?.has(key) ?? false;
        const isPlaceable = placeable?.has(key) ?? false;

        // 战斗槽用方角，准备槽用圆角，光靠形状就能区分两类区域
        const inset = slot.zone === 'battle' ? 1.02 : 0.98;
        const color = isTarget ? '#ffb457' : isPlaceable ? '#7fb2ff' : '#93a4c2';
        // 常态也要看得见：槽位是玩家判断“牌放哪”的唯一线索，
        // 全透明等于让人猜（V-TABLE-2 要求低对比，不是不可见）。
        const opacity = isTarget ? 0.95 : isPlaceable ? 0.8 : 0.34;

        return (
          <mesh
            key={key}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[slot.position[0], 0.009, slot.position[2]]}
          >
            <ringGeometry
              args={[
                (CARD_SIZE.width * inset) / 2 - 0.06,
                (CARD_SIZE.width * inset) / 2,
                4,
                1,
                Math.PI / 4,
              ]}
            />
            <meshBasicMaterial color={color} transparent opacity={opacity} />
          </mesh>
        );
      })}
    </group>
  );
}
