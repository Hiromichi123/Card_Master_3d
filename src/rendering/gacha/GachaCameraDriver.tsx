import { useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

import { damp } from '../anim/motion';
import { createCameraPose, sampleCamera, MENU_CAMERA_DISTANCE } from './choreography';
import type { GachaChoreography } from './choreography';

/**
 * 相机跟随编排层的关键帧。
 *
 * **第一帧直接落位，之后才阻尼**：阻尼跟随要半秒才收敛，开场那半秒相机
 * 会从初始位置慢慢飘过去，而那时正是卡片往下落的时刻——缓慢推镜叠在落卡上，
 * 看起来像卡没对准。
 *
 * 镜头震动在**这里自己算**，不读 `EffectRecipe.cameraShake`：
 * 那个字段全仓库没有消费者（`templates.ts` 里十几处赋值都没人读），
 * 给它补一套订阅是另一件事。这里的震源就是编排层已知的爆点时刻，
 * 用 `sin/cos(now)` 这种**确定性**伪随机，同一时刻幅度可复现——
 * 用例与截图对比才有意义。
 */
export interface GachaCameraDriverProps {
  readonly choreo: GachaChoreography;
  /** 当前演出时刻（驱动器写在同一个对象上）。 */
  readonly elapsed: () => number;
  /** 是否允许震动（设置里关掉、或系统降级动效时不震）。 */
  readonly shake: boolean;
  readonly mode?: 'select' | 'reveal' | 'result' | undefined;
  readonly instant?: boolean | undefined;
  readonly menuDistance?: number | undefined;
}

/** 震动强度：高稀有的爆点更猛。 */
const SHAKE_HIGH = 0.035;
const SHAKE_LOW = 0.012;
/** 一次震动持续多久。 */
const SHAKE_TIME = 0.45;

/** `elapsed` 时刻的震动幅度（取当前所有未衰减完的爆点里最强的那个）。 */
export function shakeAmplitudeAt(choreo: GachaChoreography, elapsed: number): number {
  let amplitude = 0;
  for (const shot of choreo.shots) {
    const since = elapsed - shot.burstAt;
    if (since < 0 || since > SHAKE_TIME) {
      continue;
    }
    const falloff = 1 - since / SHAKE_TIME;
    const peak = shot.high ? SHAKE_HIGH : SHAKE_LOW;
    amplitude = Math.max(amplitude, peak * falloff * falloff);
  }
  return amplitude;
}

export function GachaCameraDriver({ choreo, elapsed, shake, mode = 'reveal', instant = false, menuDistance = MENU_CAMERA_DISTANCE }: GachaCameraDriverProps) {
  const camera = useThree((state) => state.camera);
  useLayoutEffect(() => {
    camera.far = Math.max(80, menuDistance * 2.5);
    camera.updateProjectionMatrix();
  }, [camera, menuDistance]);
  const desired = useRef(createCameraPose());
  const current = useRef(createCameraPose());
  const snapped = useRef(false);

  useFrame((_, delta) => {
    const now = elapsed();
    sampleCamera(choreo, now, desired.current);
    if (mode === 'select') {
      desired.current.position[0] = 0; desired.current.position[1] = 0; desired.current.position[2] = menuDistance;
      desired.current.target[0] = desired.current.target[1] = desired.current.target[2] = 0;
    }


    if (!snapped.current || mode === 'select' || instant || now <= choreo.revealStart) {
      snapped.current = true;
      for (let axis = 0; axis < 3; axis += 1) {
        current.current.position[axis] = desired.current.position[axis] ?? 0;
        current.current.target[axis] = desired.current.target[axis] ?? 0;
      }
    } else {
      // 位置跟得紧一点、注视点松一点：注视点抖会立刻晕
      for (let axis = 0; axis < 3; axis += 1) {
        current.current.position[axis] = damp(
          current.current.position[axis] ?? 0,
          desired.current.position[axis] ?? 0,
          6,
          delta,
        );
        current.current.target[axis] = damp(
          current.current.target[axis] ?? 0,
          desired.current.target[axis] ?? 0,
          3.5,
          delta,
        );
      }
    }

    const amplitude = shake ? shakeAmplitudeAt(choreo, now) : 0;
    // 两个不成整数倍的频率，避免合成出一条明显的往返轨迹
    const offsetX = Math.sin(now * 47.3) * amplitude;
    const offsetY = Math.cos(now * 61.7) * amplitude * 0.7;

    camera.position.set(
      (current.current.position[0] ?? 0) + offsetX,
      (current.current.position[1] ?? 0) + offsetY,
      current.current.position[2] ?? 0,
    );
    camera.lookAt(
      current.current.target[0] ?? 0,
      current.current.target[1] ?? 0,
      current.current.target[2] ?? 0,
    );
  });

  return null;
}
