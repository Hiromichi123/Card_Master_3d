import {
  BufferAttribute,
  ExtrudeGeometry,
  Shape,
  ShapeGeometry,
  type BufferGeometry,
} from 'three';

/**
 * 卡牌几何。
 *
 * 为什么不用 `RoundedBox`：drei 的 RoundedBox 把圆角施加在**所有** 12 条棱上，
 * 而卡牌需要的是「面内四个角圆角、厚度边保持薄」。厚度只有 0.024，
 * 圆角半径 0.07 会超过厚度的一半，几何直接坏掉。
 *
 * 这里的做法是把圆角矩形当作截面**挤出**：
 * - `ExtrudeGeometry` 给轮廓与厚度（侧面材质 = 卡牌边缘色）；
 * - `ShapeGeometry` 给正反面贴图，并手工重算 UV。
 *
 * 两者共用同一个圆角轮廓，所以面片与轮廓完全吻合，不会出现「矩形贴图盖住圆角」的破绽。
 */

const CARD_WIDTH = 1;
const CARD_HEIGHT = 1.5;
const CARD_THICKNESS = 0.024;
const CARD_RADIUS = 0.07;

/** 构造圆角矩形截面，中心在原点。 */
function buildRoundedRect(width: number, height: number, radius: number): Shape {
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width / 2, height / 2);

  const shape = new Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

/**
 * 把 UV 从「等于坐标值」重算成 0–1。
 *
 * three 的 `ShapeGeometry` 与 `ExtrudeGeometry` 默认都用**顶点坐标**当 UV，
 * 对贴图来说完全不可用。卡面是 1×1.5，UV 也就跑到 0–1.5 去，
 * 纹理默认是 clamp，超出部分拉出边缘像素——表现是贴图只画出一个角，
 * 其余部分是边缘色（P3 的牌堆就是这样：卡背只显出四分之一，
 * 另外四分之一是黑的、一半是白的）。
 *
 * **正面片与卡体都要重算。** 一开始只处理了正面片，卡体（挤出几何）漏掉了，
 * 于是同一张卡背贴在正面片上是对的、贴在牌堆顶上那一面就是错位的。
 */
function remapPlanarUv<T extends BufferGeometry>(
  geometry: T,
  width: number,
  height: number,
): T {
  const position = geometry.getAttribute('position');
  const uv = new Float32Array(position.count * 2);

  for (let i = 0; i < position.count; i += 1) {
    uv[i * 2] = (position.getX(i) + width / 2) / width;
    uv[i * 2 + 1] = (position.getY(i) + height / 2) / height;
  }

  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  return geometry;
}

let bodyGeometry: ExtrudeGeometry | null = null;
let faceGeometry: ShapeGeometry | null = null;

/** 卡牌轮廓（含厚度）。整个应用共用一份，不为每张卡各建一套。 */
export function getCardBodyGeometry(): ExtrudeGeometry {
  if (!bodyGeometry) {
    const shape = buildRoundedRect(CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS);
    bodyGeometry = new ExtrudeGeometry(shape, {
      depth: CARD_THICKNESS,
      bevelEnabled: false,
      curveSegments: 6,
    });
    // 挤出方向是 +Z，从 0 到 depth；平移成以中心为原点
    bodyGeometry.translate(0, 0, -CARD_THICKNESS / 2);
    // 正反面（materialIndex 0）要贴图，UV 必须重算；侧面走边缘色材质，UV 无所谓
    remapPlanarUv(bodyGeometry, CARD_WIDTH, CARD_HEIGHT);
    bodyGeometry.computeVertexNormals();
  }
  return bodyGeometry;
}

/**
 * 卡面片（无厚度），与轮廓完全同形。
 *
 * 比轮廓略小一点（`INSET`），这样贴图边缘不会与侧面材质抢像素，
 * 斜视角下不会看到一圈发丝级的接缝。
 */
const FACE_INSET = 0.004;

export function getCardFaceGeometry(): ShapeGeometry {
  if (!faceGeometry) {
    const shape = buildRoundedRect(
      CARD_WIDTH - FACE_INSET * 2,
      CARD_HEIGHT - FACE_INSET * 2,
      CARD_RADIUS - FACE_INSET,
    );
    const geometry = new ShapeGeometry(shape, 6);
    faceGeometry = remapPlanarUv(
      geometry,
      CARD_WIDTH - FACE_INSET * 2,
      CARD_HEIGHT - FACE_INSET * 2,
    );
  }
  return faceGeometry;
}

/** 卡面片相对卡体中心的 z 偏移（略高于表面，避免 z-fighting）。 */
export const CARD_FACE_OFFSET = CARD_THICKNESS / 2 + 0.0012;

/** 供外部（如命中点计算）使用的尺寸。 */
export const CARD_DIMENSIONS = {
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
  thickness: CARD_THICKNESS,
  radius: CARD_RADIUS,
} as const;
