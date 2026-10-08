import type { ThreeEvent } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { Group } from 'three';

import type { AttackStatusKind, CardDefinition } from '../../domain/cards/types';
import { damp } from '../anim/motion';
import { FLYING_CARD_LIFT } from '../anim/combatMotion';
import { effectDirector } from '../effects/effectDirector';
import { SPEED_SCALE, useSettingsStore } from '../../state/settingsStore';
import type { StatKind } from '../cards/statBadge';
import type { StatLayout } from '../cards/StatBadges';
import { CardMesh } from '../cards/CardMesh';

/**
 * 会走位的牌。
 *
 * 规则层里牌的移动是瞬时的（`applyEventToDisplay` 一改，`BattleState` 里那张牌
 * 就已经在新区域了），但画面上不能瞬移。这里包一层 `<group>`，
 * 每帧把位置**阻尼**向目标点靠，于是所有移动——
 * 抽牌、出牌、部署、顺位整理、死亡、还魂——自动都有动画，
 * 演出层不需要为每一种移动单独写一段。
 *
 * 为什么是阻尼而不是定时补间：目标位置可能在一段动画没走完时就又变了
 * （同一次结算里出牌紧接着部署），阻尼会从当前位置平滑接上，
 * 补间则要处理「打断上一段」的麻烦。
 *
 * **必须包一层父级 `<group>`**：`CardMesh` 的 `useFrame` 每帧自己写它那一层的
 * `position.y`（悬停抬升）与旋转，从外面动画不了它本身；父级变换与它自己的
 * 局部变换是叠加的，正好。
 */
const MOVE_DAMPING = 8.5;

export interface MovingCardProps {
  readonly instanceId: string;
  readonly card: CardDefinition;
  readonly target: readonly [number, number, number];
  /** 首次出现时的起点（从牌堆飞来、从弃牌堆还魂）。 */
  readonly spawn?: readonly [number, number, number] | undefined;
  readonly rotationY?: number | undefined;
  readonly rotationX?: number | undefined;
  readonly faceDown?: boolean | undefined;
  readonly selected?: boolean | undefined;
  readonly interactive?: boolean | undefined;
  readonly scale?: number | undefined;
  readonly stats?:
    | { readonly atk: number; readonly hp: number; readonly cd: number }
    | undefined;
  readonly emphasisedStats?: ReadonlySet<StatKind> | undefined;
  readonly statLayout?: StatLayout | undefined;
  readonly showStats?: boolean | undefined;
  readonly holo?: boolean | undefined;
  readonly attackStatuses?: readonly AttackStatusKind[] | undefined;
  readonly flying?: boolean | undefined;
  readonly unyielding?: boolean | undefined;
  readonly ready?: boolean | undefined;
  readonly dragging?: boolean | undefined;
  readonly hoverTip?: boolean | undefined;
  readonly onPointerDown?: ((event: ThreeEvent<PointerEvent>) => void) | undefined;
  readonly onClick?: ((card: CardDefinition) => void) | undefined;
  readonly onHoverChange?: ((card: CardDefinition, hovered: boolean) => void) | undefined;
}

export function MovingCard({
  instanceId,
  card,
  target,
  spawn,
  rotationY,
  rotationX,
  faceDown,
  selected,
  interactive,
  scale,
  stats,
  emphasisedStats,
  statLayout,
  showStats,
  holo,
  unyielding,
  ready,
  dragging = false,
  hoverTip,
  onPointerDown,
  flying,
  attackStatuses,
  onClick,
  onHoverChange,
}: MovingCardProps) {
  const groupRef = useRef<Group>(null);
  const flyingInBattle = !dragging && statLayout === 'battle' && (flying ?? card.rawTraits.includes('飞行'));
  const wasInBattle = useRef(false);
  useEffect(() => {
    if (flyingInBattle && !wasInBattle.current) {
      const speed = useSettingsStore.getState().presentationSpeed;
      if (speed !== 'skip') effectDirector.play({
        template: 'flyingDeploy', from: target, to: [target[0], target[1] + 0.03, target[2]],
        color: '#ffffff', durationScale: SPEED_SCALE[speed],
      });
    }
    wasInBattle.current = !dragging && statLayout === 'battle';
    // Slot compaction and subsequent hits must never replay the deployment circle.
  }, [flyingInBattle, statLayout, instanceId, dragging]);
  /** 当前的视觉位置。`null` 表示这张牌还没在画面上出现过。 */
  const current = useRef<[number, number, number] | null>(null);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) {
      return;
    }

    let position = current.current;
    if (!position) {
      // 第一次出现：从起点开始（没有起点就直接落在目标上）
      const start = spawn ?? target;
      position = [start[0], start[1], start[2]];
      current.current = position;
    }

    if (dragging) {
      position[0] = target[0]; position[1] = target[1]; position[2] = target[2];
      group.position.set(position[0], position[1], position[2]);
      return;
    }
    position[0] = damp(position[0], target[0], MOVE_DAMPING, delta);
    position[1] = damp(position[1], target[1] + (flyingInBattle ? FLYING_CARD_LIFT : 0), MOVE_DAMPING, delta);
    position[2] = damp(position[2], target[2], MOVE_DAMPING, delta);
    group.position.set(position[0], position[1], position[2]);
  });

  return (
    <group ref={groupRef} onPointerDown={onPointerDown}>
      <CardMesh
        key={instanceId}
        attackKey={instanceId}
        card={card}
        // 位置由这一层负责，CardMesh 只保留它自己的悬停抬升与旋转
        position={[0, 0, 0]}
        rotationY={rotationY}
        rotationX={rotationX}
        faceDown={faceDown}
        selected={selected}
        interactive={interactive}
        scale={scale}
        stats={stats}
        emphasisedStats={emphasisedStats}
        statLayout={statLayout}
        showStats={showStats}
        holo={holo}
        unyielding={unyielding}
        ready={ready}
        dragging={dragging}
        hoverTip={hoverTip}
        flying={flying}
        attackStatuses={attackStatuses}
        onClick={onClick}
        onHoverChange={onHoverChange}
      />
    </group>
  );
}
