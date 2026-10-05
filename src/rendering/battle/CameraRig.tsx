import { useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import type { PerspectiveCamera } from 'three';

/**
 * 相机。
 *
 * `V-WORLD-2`：倾斜透视镜头，俯视 45°–60°，能同时看到卡面与卡牌前缘厚度。
 * `V-WORLD-4`：随窗口宽高比调整，保证 16:9 与更窄的比例下双方全部区域都可见，
 * 不裁掉手牌或敌方槽位。
 *
 * 做法是**固定仰角与朝向，只按宽高比推远推近**，这样不同窗口下透视关系一致，
 * 不会出现「换个窗口卡牌看起来变形」的问题。
 */

/**
 * 目标点。与 `LAYOUT.tableCenterZ` 保持一致——内容从敌方准备区卡牌后缘
 * （z≈-4.25）延伸到玩家手牌前缘（z≈+5.9），中点约 z=+0.82。
 * 相机对准内容中点、桌面也按同一点居中，上下留白才均衡。
 */
const TARGET: [number, number, number] = [0, 0, 0.82];

/**
 * 基准仰角（度）。`V-WORLD-2` 要求落在 45°–60°。
 *
 * 取该区间**下限**不是随意选的：手牌离相机最近，仰角越高，相机越靠近手牌上方，
 * 手牌偏离视轴的角就越大。50° 时手牌已在垂直半视场（22.5°）边缘、底边被裁；
 * 46° 让相机在水平方向退得更远，手牌与敌方准备区才同时落在视场内。
 */
const ELEVATION_DEG = 46;
/** 16:9 下的基准距离：一次装下约 11 单位的进深，同时保证卡面可辨认。 */
const BASE_DISTANCE = 14.5;
/** 透视强度。取 45 而不是更窄的值，避免远处敌方卡牌被压得读不出。 */
const FOV = 45;

export function CameraRig() {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const size = useThree((state) => state.size);

  useLayoutEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const referenceAspect = 16 / 9;

    // 比 16:9 窄时按比例推远；比 16:9 宽时不推近太多，避免卡牌过小
    const narrowness = Math.max(1, referenceAspect / Math.max(aspect, 0.5));
    const distance = BASE_DISTANCE * Math.min(narrowness, 1.45);

    const elevation = (ELEVATION_DEG * Math.PI) / 180;
    const horizontal = Math.cos(elevation) * distance;
    const vertical = Math.sin(elevation) * distance;

    camera.fov = FOV;
    camera.position.set(TARGET[0], TARGET[1] + vertical, TARGET[2] + horizontal);
    camera.lookAt(TARGET[0], TARGET[1], TARGET[2]);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);

  return null;
}
