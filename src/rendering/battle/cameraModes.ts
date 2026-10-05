import { Vector3, type PerspectiveCamera } from 'three';

/**
 * 相机几何与预设。
 *
 * **移植自** `D:\Github\Chessboard-three.js`（MIT）的
 * `src/render/three/cameraModes.js` 与 `scene.js` 的相机段。
 * 原项目把这三件事当作数据与纯函数（而不是写死的相机位置），
 * 于是「视口变了怎么取景」有唯一一处定义：
 *
 * 1. `polarForAspect` —— 视口越窄越小，镜头越往下压；
 * 2. `fitCameraToBoard` —— 把内容的外接盒投影到视锥里，反推该退多远；
 * 3. `CAMERA_MODES` —— 几套预设角度。
 *
 * 本项目直接沿用了这套划分，只把「棋盘」换成战斗桌的尺度。
 */

/**
 * 取景用的半跨度。
 *
 * 取的是**内容**的外接半径，不是棋盘本身的半径：手牌移到盘外并抬到空中之后，
 * 内容的范围由它决定（离盘面中心约 7.2，含悬停时再抬起的余量）。
 * 只按棋盘算会把两边的牌切掉。
 */
export const TABLE_RADIUS = 7.35;

/** 静置时的极角（自正上方量起）。等价于约 46° 的仰角。 */
export const CAMERA_POLAR_ANGLE = Math.PI / 2 - (46 * Math.PI) / 180;

/** 镜头压得最平时也会留一点角度，不会真的平视。 */
const CAMERA_POLAR_MIN = 0.22;

/** 两套预设的收敛范围，避免出现「正上方」与「贴身俯视」这两种不可用的极端。 */
const CAMERA_POLAR_MAX = Math.PI / 2.05;

/**
 * 开始往下压的屏幕尺寸，以及下方的过渡宽度。
 *
 * 读的是**设备**短边而不是画布短边：画布短边会随布局变化，
 * 那会让「窗口变窄」反过来压平并缩小桌面——而窗口变窄本来就是布局在收掉
 * 桌面没用到的空间，方向正好相反。设备短边在横竖屏下是同一个数。
 */
const SMALL_SCREEN = 680;

export type CameraModeId = 'orbit' | 'top' | 'low' | 'commander';

export interface CameraMode {
  readonly id: CameraModeId;
  readonly name: string;
  /** 极角（自正上方量起，弧度）。越小越接近俯视。 */
  readonly polar: number;
  /** 距离的额外倍数，用来在同等取景下微调远近。 */
  readonly zoom: number;
}

export const CAMERA_MODES: readonly CameraMode[] = [
  { id: 'orbit', name: '标准', polar: CAMERA_POLAR_ANGLE, zoom: 1 },
  { id: 'top', name: '俯视', polar: 0.05, zoom: 0.94 },
  { id: 'low', name: '玩家视角', polar: Math.PI / 2.5, zoom: 1.06 },
  { id: 'commander', name: '指挥官', polar: Math.PI / 3.4, zoom: 1.14 },
];

export const DEFAULT_CAMERA_MODE: CameraModeId = 'orbit';

export function getCameraMode(id: CameraModeId): CameraMode {
  return CAMERA_MODES.find((mode) => mode.id === id) ?? (CAMERA_MODES[0] as CameraMode);
}

/**
 * 按视口形状与设备尺寸决定极角。
 *
 * 两件事都会把视角往下压，取更强的那个：
 *
 * - **形状**：46° 视角看一张方桌，投出来是又宽又扁的。横向画布正合适，
 *   竖向画布就浪费——为了塞下宽度只能把相机推到很远，桌子缩成一条。
 * - **尺寸**：手机不是小号桌面。390px 的屏幕上，后排会缩到前排的六成，
 *   站在后排的卡牌互相压在一起；而屏幕越小恰恰越需要读得清。
 *   压平之后每格更均匀，而且扁平的内容投影更高，实际还更大。
 *
 * @param aspect 宽 / 高
 * @param shortEdge 设备短边（CSS 像素）
 */
export function polarForAspect(aspect: number, shortEdge = Number.POSITIVE_INFINITY): number {
  const clamp = (value: number): number => Math.max(0, Math.min(1, value));
  const down = Math.max(
    clamp((1.15 - aspect) / 0.75),
    clamp((SMALL_SCREEN - shortEdge) / 400),
  );
  return CAMERA_POLAR_ANGLE * (1 - down) + CAMERA_POLAR_MIN * down;
}

/** 设备短边，横竖屏取同一个数。 */
export function viewportShortEdge(): number {
  return Math.min(window.innerWidth, window.innerHeight);
}

/** 极角的可用范围，供轨道控制钳制。 */
export function polarLimits(): { min: number; max: number } {
  return { min: CAMERA_POLAR_MIN, max: CAMERA_POLAR_MAX };
}

/**
 * 沿视线方向把相机推到「内容刚好装进视锥」，然后停在这个距离。
 *
 * 固定距离做不到：同一个数字能在 16:9 桌面上取好景，放到竖屏上就裁掉一半。
 * 把外接盒的角点投影出来、按最坏的那个缩放，就能适配任意宽高比与任意视角
 * ——包括玩家自己转过去的角度。
 *
 * 用迭代而不是解析解：透视投影下「投影坐标」与距离不是线性关系，
 * 但几次迭代就收敛，而且不必为每种内容形状推导公式。
 *
 * @returns 最终采用的距离
 */
export function fitCameraTo(
  camera: PerspectiveCamera,
  target: Vector3,
  {
    radius = TABLE_RADIUS,
    /**
     * 内容的高度，给外接盒一点余量。
     *
     * 手牌抬到空中（`HAND.lift` 1.5）之后，内容不再是一张平摊的桌子。
     * 取 2.2 够把手牌整个含进来；再往上加只是把镜头往后推、把棋盘缩小，
     * 换来的是「悬停时牌顶不会超出画面上沿」——不值得。
     */
    height = 2.2,
    margin = 1.08,
    iterations = 6,
  }: { radius?: number; height?: number; margin?: number; iterations?: number } = {},
): number {
  /*
    内容是平的，所以轮廓就是外接盒的四条竖棱的上下共 8 个角。

    **盒子要以视线目标为中心，不是以世界原点为中心。** 盘面中心在 z=0.82，
    内容相对它是正负对称的；按原点铺盒子的话，玩家这一侧（+z）会比盒子多伸出去 0.82，
    取景算出来的距离就偏小——手牌会被下沿切掉半张（P3 实机就是这样）。
  */
  const corners: Vector3[] = [];
  for (const x of [target.x - radius, target.x + radius]) {
    for (const z of [target.z - radius, target.z + radius]) {
      for (const y of [0, height]) {
        corners.push(new Vector3(x, y, z));
      }
    }
  }

  const direction = camera.position.clone().sub(target);
  let distance = direction.length();
  direction.normalize();

  for (let i = 0; i < iterations; i += 1) {
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    let worst = 0;
    for (const corner of corners) {
      const projected = corner.clone().project(camera);
      worst = Math.max(worst, Math.abs(projected.x), Math.abs(projected.y));
    }
    if (worst <= 0.0001) {
      break;
    }
    const scale = worst * margin;
    if (Math.abs(scale - 1) < 0.005) {
      break;
    }
    distance *= scale;
  }

  camera.position.copy(target).addScaledVector(direction, distance);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  return distance;
}
