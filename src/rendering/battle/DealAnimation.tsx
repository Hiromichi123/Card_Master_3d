import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Vector3, type Group } from 'three';

import { Timeline } from '../anim/Timeline';
import { easeOutCubic } from '../anim/easings';
import { arcPosition } from '../anim/motion';
import { CARD_BACK_URL } from '../../data/assets';
import { useManagedTexture } from '../../services/useManagedTexture';
import { getCardFaceGeometry } from '../cards/cardGeometry';
import type { SideId } from '../../domain/cards/types';
import { BOARD_CENTER_Z, PILE_CARD_SCALE, pilePosition } from './layout';

/**
 * 开局发牌。
 *
 * 从桌面中央的牌堆往两边各发几张到各自的牌堆上。
 *
 * **是纯装饰，不与真实卡牌一一对应**（这一点是明确的）：真实的抽牌早就由引擎算完了，
 * 这里只是补一段「牌从哪儿来」的观感——没有它，开局的牌是凭空出现在手牌区的。
 * 牌面朝下，所以也不需要知道发的是哪几张。
 *
 * 与其它演出一样只做表现：它不碰任何规则状态，播不完就被卸载也没有副作用。
 */

const PLATES_PER_SIDE = 5;
/** 每张之间错开的时间。 */
const STAGGER = 0.07;
const FLIGHT = 0.42;
/** 整个发牌过程的总时长。 */
const TOTAL = FLIGHT + STAGGER * (PLATES_PER_SIDE - 1) + 0.35;

/** 牌堆的厚度感：中央那摞画几张。 */
const CENTER_STACK = 6;
const PLATE_THICKNESS = 0.024;

interface Flight {
  readonly side: SideId;
  readonly index: number;
  /** 这一张的起步时刻。 */
  readonly delay: number;
}

function DealPlate({
  flight,
  texture,
  onUpdate,
}: {
  flight: Flight;
  texture: ReturnType<typeof useManagedTexture>;
  onUpdate: (group: Group | null, progress: number) => void;
}) {
  const groupRef = useRef<Group>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const progress = useRef(0);

  useEffect(() => {
    const timeline = new Timeline();
    if (flight.delay > 0) {
      timeline.wait(flight.delay);
    }
    timeline.add({
      duration: FLIGHT,
      easing: easeOutCubic,
      onUpdate: (t) => {
        progress.current = t;
      },
    });
    timelineRef.current = timeline;
    return () => {
      timelineRef.current = null;
    };
  }, [flight.delay]);

  useFrame((_, delta) => {
    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }
    timeline.update(Math.min(delta, 0.05) / ANIMATION_DURATION_SCALE);
    onUpdate(groupRef.current, progress.current);
  });

  const geometry = useMemo(() => getCardFaceGeometry(), []);

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
        <meshStandardMaterial map={texture} roughness={0.62} metalness={0.05} />
      </mesh>
    </group>
  );
}

export function DealAnimation({ onDone }: { onDone: () => void }) {
  const backTexture = useManagedTexture(CARD_BACK_URL);
  const [finished, setFinished] = useState(false);
  const elapsed = useRef(0);
  // 复用同一组向量，避免每帧给每张牌都新建对象
  const from = useRef(new Vector3());
  const to = useRef(new Vector3());
  const out = useRef(new Vector3());

  const flights = useMemo<Flight[]>(() => {
    const list: Flight[] = [];
    for (const side of ['player', 'enemy'] as const) {
      for (let i = 0; i < PLATES_PER_SIDE; i += 1) {
        // 两边交替发，像真的在轮流给双方发牌
        list.push({ side, index: i, delay: i * STAGGER * 2 + (side === 'enemy' ? STAGGER : 0) });
      }
    }
    return list;
  }, []);

  useFrame((_, delta) => {
    if (finished) {
      return;
    }
    elapsed.current += Math.min(delta, 0.05) / ANIMATION_DURATION_SCALE;
    if (elapsed.current >= TOTAL) {
      setFinished(true);
      onDone();
    }
  });

  if (finished || !backTexture) {
    return null;
  }

  return (
    <group>
      {/* 中央的大牌堆：发牌的源头 */}
      <group position={[0, 0, BOARD_CENTER_Z]} scale={PILE_CARD_SCALE}>
        {Array.from({ length: CENTER_STACK }, (_, i) => (
          <mesh
            key={i}
            geometry={getCardFaceGeometry()}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, PLATE_THICKNESS / 2 + i * PLATE_THICKNESS, 0]}
          >
            <meshStandardMaterial map={backTexture} roughness={0.62} metalness={0.05} />
          </mesh>
        ))}
      </group>

      {flights.map((flight) => {
        const target = pilePosition(flight.side, 'deck');
        return (
          <DealPlate
            key={`${flight.side}-${flight.index}`}
            flight={flight}
            texture={backTexture}
            onUpdate={(group, t) => {
              if (!group) {
                return;
              }
              from.current.set(0, 0.6 + flight.index * PLATE_THICKNESS, BOARD_CENTER_Z);
              to.current.set(target[0], 0.02, target[2]);
              // 抛物线，飞过去的时候是拱起来的
              arcPosition(from.current, to.current, 1.1, t, out.current);
              group.position.copy(out.current);
              group.scale.setScalar(PILE_CARD_SCALE);
              group.rotation.z = (1 - t) * 0.8 * (flight.side === 'player' ? 1 : -1);
            }}
          />
        );
      })}
    </group>
  );
}
