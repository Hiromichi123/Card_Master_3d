import { useFrame } from '@react-three/fiber';

import type { BattleSession } from '../presentation/session';

/**
 * 每帧驱动演出导演。
 *
 * 它必须挂在 `<PostEffects>` **之前**：`EffectComposer` 一旦挂载，
 * 声明在它之后的兄弟组件的 `useFrame` 订阅不会被注册——组件挂载了、画面正常、
 * 控制台零报错，但回调一次都不触发（P1 验证记录第 3.18 节有对照实验）。
 * 这里静默失效的表现就是「点了结束回合，画面永远停在原地」。
 *
 * 返回 `null` 是刻意为之：它没有画面，只借 Canvas 的帧循环。
 * `PerfSampler` 已经证明了这个位置上返回 null 的组件能正常收到 `useFrame`。
 */
export function PresentationDriver({ session }: { session: BattleSession }) {
  useFrame((_, delta) => {
    session.tick(delta);
  });
  return null;
}
