import { useEffect, useMemo } from 'react';
import { CircleGeometry, MeshStandardMaterial } from 'three';

import { LAYOUT } from './layout';
import type { TableTheme } from '../table/themes';

/**
 * 棋盘之外的地面：一张**很大的圆桌**。
 *
 * **移植自** `D:\Github\Chessboard-three.js`（MIT）的 `scene.js`：
 *
 * > A large dark disc under the board. Without something for the board's own
 * > shadow to fall on, it reads as floating in a void rather than sitting on a
 * > table, and the shadow map has nothing to draw into.
 *
 * 三件事一起才构成「棋盘外那圈柔和背景」：
 *
 * 1. **圆盘要远大于棋盘**。原项目的棋盘半径 10.3、圆盘半径 46——约 4.5 倍。
 *    圆盘边缘因此落在画面之外，只有中间一段进入视野。
 * 2. **雾把远端吃掉**。圆盘远端离相机很远，被雾混向背景色，
 *    于是边缘是**渐隐**的，看不到硬边。这一圈渐隐就是「模糊背景」的观感来源。
 * 3. **它接阴影**。棋盘自己的投影要落在这张桌面上，否则整块板看着像浮在虚空里。
 *
 * 之前这里是一块方形平板：边缘是直角、又近在画面内，读起来是「一块板」而不是
 * 「一张桌子」。换成大圆盘 + 按本场景尺度重设的雾之后，围边才会化开。
 */

/** 圆盘半径。按原项目的比例（棋盘 10.3 : 圆盘 46 ≈ 4.5 倍）换算到本项目的棋盘半径 5.9。 */
const GROUND_RADIUS = 26;

/** 圆盘相对棋盘顶面的下沉量。 */
const GROUND_DROP = 0.62;

export interface SceneGroundProps {
  readonly theme: TableTheme;
}

export function SceneGround({ theme }: SceneGroundProps) {
  const geometry = useMemo(() => new CircleGeometry(GROUND_RADIUS, 64), []);

  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        color: theme.table.color,
        roughness: theme.table.roughness,
        metalness: 0,
      }),
    [theme],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return (
    <mesh
      geometry={geometry}
      material={material}
      rotation={[-Math.PI / 2, 0, 0]}
      // z 跟台面走：桌面布局不是以世界原点为中心的（`LAYOUT.tableCenterZ`），
      // 圆盘若留在 z=0，围边就会一边宽一边窄。
      position={[0, -GROUND_DROP, LAYOUT.tableCenterZ]}
      receiveShadow
    />
  );
}
