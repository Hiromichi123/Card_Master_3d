import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { Group } from 'three';

import { cardById } from '../../data';
import { Timeline } from '../anim/Timeline';
import { FLYING_CARD_LIFT } from '../anim/combatMotion';
import { easeOutCubic } from '../anim/easings';
import { CardMesh } from '../cards/CardMesh';
import type { ProxyCard } from '../presentation/displayState';
import { PROXY_EXIT_SECONDS } from '../presentation/constants';
import { slotPosition } from './placements';

/**
 * 离场代理。
 *
 * 规则上已经死掉的卡，在它的离场演出播完之前仍要留在画面上——
 * 否则弹体会追向一个已经空掉的槽位（PLAN 第 4.1 节，`V-FX-3`）。
 *
 * **它的寿命由演出导演决定**，不是等这个组件自己的动画跑完：
 * 导演在 `CardDied` 之后接了一个普通的等待步骤，跳过会被补发、取消会整批清掉。
 * 这里的动画只是让它看起来是在消散，播不完就被卸载也无所谓。
 *
 * 必须用一个父级 `<group>` 把它包住：`CardMesh` 的 `useFrame` 每帧会自己写
 * 它那一层的 position/rotation（悬停抬升、翻面），从外面动画不了它本身。
 * 父级变换与它自己的局部变换是叠加的，正好。
 */
export function DepartingCard({ proxy }: { proxy: ProxyCard }) {
  const groupRef = useRef<Group>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const progress = useRef(0);

  const card = cardById.get(proxy.definitionId);
  const flyingLift = card?.rawTraits.includes('飞行') ? FLYING_CARD_LIFT : 0;
  const base = useMemo(
    () => slotPosition(proxy.side, 'battle', proxy.slotIndex),
    [proxy.side, proxy.slotIndex],
  );

  useEffect(() => {
    const timeline = new Timeline();
    timeline.add({
      // 比导演给的寿命短一点：留出被卸载的余量，避免最后一帧还在动就被抽走
      duration: PROXY_EXIT_SECONDS * 0.7,
      easing: easeOutCubic,
      onUpdate: (t) => {
        progress.current = t;
      },
    });
    timelineRef.current = timeline;
    return () => {
      timelineRef.current = null;
    };
  }, []);

  useFrame((_, delta) => {
    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }
    timeline.update(Math.min(delta, 0.05) / ANIMATION_DURATION_SCALE);

    const group = groupRef.current;
    if (!group) {
      return;
    }
    const t = progress.current;
    // 缩小 + 上浮 + 侧翻，读起来是「这张牌散掉了」而不是「凭空消失」
    const scale = 1 - t;
    group.scale.setScalar(Math.max(scale, 0.001));
    group.position.set(base[0], base[1] + flyingLift + t * 0.32, base[2]);
    group.rotation.z = t * 0.6;
  });

  if (!card) {
    return null;
  }

  return (
    <group ref={groupRef} position={[base[0], base[1] + flyingLift, base[2]]}>
      <CardMesh
        card={card}
        position={[0, 0, 0]}
        rotationX={-Math.PI / 2}
        stats={proxy.stats}
        interactive={false}
      />
    </group>
  );
}
