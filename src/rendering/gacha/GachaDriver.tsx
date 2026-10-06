import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';

import { Timeline } from '../anim/Timeline';
import { linear } from '../anim/easings';
import { effectDirector } from '../effects/effectDirector';
import { SPEED_SCALE, useSettingsStore } from '../../state/settingsStore';
import {
  createPose,
  dueBursts,
  samplePose,
} from './choreography';
import type { CardShot, GachaChoreography } from './choreography';

/**
 * 每帧把编排层算出来的姿态写进场景，并在该撒粒子的时候撒粒子。
 *
 * **必须渲染在 `<PostEffects>` 之前**：`EffectComposer` 一挂上，
 * 声明在它之后的兄弟组件收不到 `useFrame`（`presentation/director.ts` 与
 * `EffectLabScene` 都记着这条实测），而且是**静默失效**——不报错，只是不动。
 *
 * 时间轴用 `Timeline` 的一步走完（`V-CARD-8` 定的「全工程只有一套时间轴」）：
 * `skipToEnd()` 会把 `onUpdate(1)` 补发一次，于是跳过时 `samplePose(total)`
 * 直接给出终态——「跳过 = 播完」是这条链路自带的，不需要另一套快进逻辑。
 */
export interface GachaDriverProps {
  readonly choreo: GachaChoreography;
  /**
   * 当前演出时刻。**由调用方持有**：相机驱动也要读它，
   * 驱动器自己藏一个 ref 的话，相机会永远读到 0。
   */
  readonly elapsed: { current: number };
  /** 卡片的外层 group，按下标对位。 */
  readonly targets: React.RefObject<(Group | null)[]>;
  /** 每张卡的翻面进度对象，与 `targets` 同序。 */
  readonly flipControls: readonly { current: number }[];
  /** 到位该撒粒子了。`shot` 给调用方算颜色与模板。 */
  readonly onBurst: (index: number, shot: CardShot) => void;
  /** 整段播完（含跳过）。 */
  readonly onFinished: () => void;
  /**
   * 卡面纹理是否已经预热好。
   *
   * **这是「翻出来是不是白卡」的唯一开关**：贴图是异步到的，
   * 早于它就翻面，玩家看到的是深色底板。为 false 时时间轴不推进（1.2 秒兜底放行）。
   */
  readonly ready: boolean;
}

/** 纹理预热的兜底放行时间：等太久不如先演，占位纹理至少是「有东西」。 */
const WARM_TIMEOUT = 1.2;

export function GachaDriver({
  choreo,
  elapsed,
  targets,
  flipControls,
  onBurst,
  onFinished,
  ready,
}: GachaDriverProps) {
  const timelineRef = useRef<Timeline | null>(null);
  const poseRef = useRef(createPose());
  const burstedRef = useRef(0);
  const waitedRef = useRef(0);
  /*
    `onFinished` 用 ref 转一手：它每次渲染都是新函数，
    直接进依赖会让整段时间轴在父组件每次重渲染时重建。
  */
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const timeline = new Timeline(() => {
      onFinishedRef.current();
    });
    timeline.add({
      duration: choreo.total,
      easing: linear,
      onUpdate: (t) => {
        const seconds = t * choreo.total;
        elapsed.current = seconds;
        for (let index = 0; index < choreo.shots.length; index += 1) {
          const pose = samplePose(choreo, index, seconds, poseRef.current);
          const group = targets.current?.[index];
          if (!group) {
            continue;
          }
          group.visible = pose.visible;
          group.position.set(pose.position[0], pose.position[1], pose.position[2]);
          group.rotation.y = pose.rotationY;
          group.scale.setScalar(pose.scale);
          const control = flipControls[index];
          if (control) {
            control.current = pose.flip;
          }
        }
      },
    });
    timelineRef.current = timeline;
    return () => {
      timelineRef.current = null;
    };
  }, [choreo, elapsed, targets, flipControls]);
  useFrame((_, delta) => {
    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }
    const speed = useSettingsStore.getState().presentationSpeed;

    if (speed === 'skip') {
      // 跳过不用「乘一个很小的系数」实现：那样还要花 5% 的时间，
      // 而且残留的粒子会在舞台上继续飞。显式补完 + 清干净。
      timeline.skipToEnd();
      effectDirector.skipAll();
    } else {
      if (!ready) {
        waitedRef.current += delta;
        if (waitedRef.current < WARM_TIMEOUT) {
          return;
        }
      }
      /*
        **除以** `SPEED_SCALE`，不是乘：它是「时长倍数」，
        乘上去会让快速档反而更慢（`presentation/director.ts` 记过这个坑）。
      */
      timeline.update(Math.min(delta, 0.05) / SPEED_SCALE[speed]);
    }

    const now = elapsed.current;
    for (const index of dueBursts(choreo, burstedRef.current, now)) {
      const shot = choreo.shots[index];
      if (shot) {
        onBurst(index, shot);
      }
    }
    burstedRef.current = now;
  });

  return null;
}
