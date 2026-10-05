import { useMemo } from 'react';

import type { SideId } from '../../domain/cards/types';
import { useSettingsStore } from '../../state/settingsStore';
import {
  BATTLE_CARD_SCALE,
  CARD_SIZE,
  PREP_CARD_SCALE,
  buildSlots,
  type SlotZone,
} from './layout';

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
  /** 点击某个槽位。只有可放置/可选目标的槽位会发出这个事件。 */
  readonly onSlotClick?: ((side: SideId, zone: SlotZone, index: number) => void) | undefined;
}

/** 槽位稳定键，供上层做集合查找。 */
export function slotKey(side: string, zone: string, index: number): string {
  return `${side}:${zone}:${index}`;
}

export function SlotMarkers({ placeable, targeted, onSlotClick }: Props) {
  const slots = useMemo(() => buildSlots(), []);
  // 槽位的三种状态色来自当前台面主题，换主题时整张桌子的配色一起变
  const accent = useSettingsStore((state) => state.tableTheme.accent);
  const colors = useMemo(
    () => ({
      base: `#${accent.slot.toString(16).padStart(6, '0')}`,
      placeable: `#${accent.placeable.toString(16).padStart(6, '0')}`,
      target: `#${accent.target.toString(16).padStart(6, '0')}`,
    }),
    [accent],
  );

  return (
    <group>
      {slots.map((slot) => {
        const key = slotKey(slot.side, slot.zone, slot.index);
        const isTarget = targeted?.has(key) ?? false;
        const isPlaceable = placeable?.has(key) ?? false;

        // 战斗槽用方角，准备槽用圆角，光靠形状就能区分两类区域。
        // 环的大小跟着该区的卡牌缩放走，否则卡片放大之后槽位会比牌小一圈。
        const cardScale = slot.zone === 'battle' ? BATTLE_CARD_SCALE : PREP_CARD_SCALE;
        const inset = (slot.zone === 'battle' ? 1.02 : 0.98) * cardScale;
        const color = isTarget
          ? colors.target
          : isPlaceable
            ? colors.placeable
            : colors.base;
        // 常态也要看得见：槽位是玩家判断“牌放哪”的唯一线索，
        // 全透明等于让人猜（V-TABLE-2 要求低对比，不是不可见）。
        const opacity = isTarget ? 0.95 : isPlaceable ? 0.8 : 0.34;

        // 只有可放置/可选目标的槽位才接点击。
        // 全都接的话，点桌面上任何一处都会命中一个槽位，`onPointerMissed`
        // 再也不触发，点空白取消选中就废了。
        const clickable = isPlaceable || isTarget;

        return (
          <group
            key={key}
            position={[slot.position[0], 0, slot.position[2]]}
          >
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.009, 0]}>
              {/*
                4 段圆环、起始角 π/4，画出来是一个**顶点落在半径上**的方框，
                边长是半径的 √2 倍。所以要让方框正好框住卡牌，半径取 边长/√2——
                照半径等于半个边长写的话，框会明显比牌小一圈。
              */}
              <ringGeometry
                args={[
                  (CARD_SIZE.width * inset) / Math.SQRT2 - 0.06 * cardScale,
                  (CARD_SIZE.width * inset) / Math.SQRT2,
                  4,
                  1,
                  Math.PI / 4,
                ]}
              />
              <meshBasicMaterial color={color} transparent opacity={opacity} />
            </mesh>

            {/*
              命中区。
              圆环本身只是一圈细线，直接拿它做点击目标会很难点中；
              铺一张与卡面等大的透明平面，点击范围才符合直觉。
              用 opacity 0 而不是 visible=false——不可见的物体不参与射线检测。
            */}
            {clickable && onSlotClick && (
              <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, 0.012, 0]}
                onClick={(event) => {
                  event.stopPropagation();
                  // 传**每侧**下标：引擎的 prep/battle 数组是这个口径，
                  // `slot.index` 是全局编号，混用会把牌放到别人的槽里
                  onSlotClick(slot.side, slot.zone, slot.rowIndex);
                }}
              >
                <planeGeometry args={[CARD_SIZE.width * inset, CARD_SIZE.height * inset]} />
                <meshBasicMaterial
                  transparent
                  opacity={0}
                  depthWrite={false}
                />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}
