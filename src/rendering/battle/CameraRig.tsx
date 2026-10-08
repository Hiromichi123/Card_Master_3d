import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Spherical, Vector3, type PerspectiveCamera } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

import { useSettingsStore } from '../../state/settingsStore';
import {
  fitCameraTo,
  getCameraMode,
  polarForAspect,
  polarLimits,
  viewportShortEdge,
} from './cameraModes';
import { LAYOUT } from './layout';

/**
 * 相机。
 *
 * **移植自** `D:\Github\Chessboard-three.js`（MIT）的 `scene.js` 相机段。
 *
 * 三条规则来自原项目，它们解决的是同一类问题——「换个视口就取不好景」：
 *
 * 1. **距离是算出来的，不是调出来的。** `fitCameraTo` 把内容外接盒的 8 个角
 *    投影到视锥里，按最坏的那个反推该退多远。固定距离在 16:9 上合适、
 *    在窄屏上就裁掉一半。
 * 2. **窄屏与竖屏把镜头往下压。** 46° 看一张方桌会投出又宽又扁的形状，
 *    横向画布正合适，竖向就浪费。角度按视口形状与设备短边插值。
 * 3. **用户转过的方位角要留住。** 重新取景只改仰角与距离，不把镜头拽回正面
 *    ——玩家转到侧后方看牌面时窗口一变就被掰回去，是很烦的事。
 *
 * 与原先的实现相比，这里是**用计算替换了手调的常数**（旧的 `BASE_DISTANCE`、
 * `ELEVATION_DEG`）。之前为了让手牌不被裁掉，我把仰角从 50° 降到 46°，
 * 那是在绕开固定距离的限制；现在取景由外接盒决定，角度只负责观感。
 */

/** 视线目标：桌面中心。与 `LAYOUT.tableCenterZ` 一致，不另起一个常量。 */
const TARGET = new Vector3(0, 0, LAYOUT.tableCenterZ);

export function CameraRig({ interactionLocked = false }: { interactionLocked?: boolean | undefined } = {}) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const size = useThree((state) => state.size);
  const controlsRef = useRef<OrbitControlsImpl>(null);

  const modeId = useSettingsStore((state) => state.cameraModeId);
  /**
   * 上一次取景定下的距离，轨道的缩放范围以它为基准。
   *
   * 用 state 而不是 ref：轨道控制的 `minDistance` / `maxDistance` 是渲染期读取的，
   * 而取景发生在 layout effect 里。用 ref 的话首次渲染读到的还是 0，
   * 两个边界会退回兜底值——实测把算出来的 12.38 顶到 13.2，
   * 取景白算了。
   */
  const [fitted, setFitted] = useState(0);

  const refit = useCallback(
    (keepAzimuth: boolean) => {
      const aspect = size.width / Math.max(1, size.height);
      const mode = getCameraMode(modeId);

      // 标准模式下角度随视口自适应；其余模式是用户明确选的固定角度
      const polar =
        modeId === 'orbit' ? polarForAspect(aspect, viewportShortEdge()) : mode.polar;

      const spherical = new Spherical();
      if (keepAzimuth) {
        // 保留用户转到的方位角，只替换仰角
        spherical.setFromVector3(camera.position.clone().sub(TARGET));
      } else {
        spherical.theta = 0;
      }
      spherical.phi = polar;
      spherical.radius = 1; // 真正的距离由 fit 决定

      // Spherical 没有 toVector3，得让向量自己去取
      const unit = new Vector3().setFromSpherical(spherical).normalize();

      // 先摆一个方向，让 fit 沿它推进
      camera.position.copy(TARGET).add(unit);
      camera.lookAt(TARGET);

      const distance = fitCameraTo(camera, TARGET) * mode.zoom;
      camera.position.copy(TARGET).addScaledVector(unit, distance);
      camera.lookAt(TARGET);
      camera.updateProjectionMatrix();

      setFitted(distance);
      // 轨道控制自己的球坐标是从相机位置反推的，改完位置必须让它同步，
      // 否则下一帧 update() 会拿旧角度把相机拽回去
      controlsRef.current?.update();
    },
    [camera, modeId, size.width, size.height],
  );

  // 尺寸变化时重新取景，保留用户转过的方位角
  useLayoutEffect(() => {
    refit(true);
  }, [refit]);

  // 切换模式时回到该模式的正视角，而不是留在用户转到的角度
  const previousMode = useRef(modeId);
  useEffect(() => {
    if (previousMode.current !== modeId) {
      previousMode.current = modeId;
      refit(false);
    }
  }, [modeId, refit]);

  const limits = polarLimits();
  // 兜底 24 只在第一次取景完成前生效
  const orbitDistance = fitted || 24;

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={!interactionLocked}
      target={TARGET}
      // 不允许平移：一平移取景就废了，而且玩家没有需要平移的理由
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.55}
      zoomSpeed={0.7}
      minPolarAngle={limits.min}
      maxPolarAngle={limits.max}
      // 缩放以取景距离为基准，避免转到「贴在卡面上」或「退到看不见」
      minDistance={orbitDistance * 0.55}
      maxDistance={orbitDistance * 1.7}
    />
  );
}
