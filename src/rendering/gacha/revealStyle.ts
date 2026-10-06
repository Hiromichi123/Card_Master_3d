import { backdropSize, frameDistance, MENU_CAMERA_DISTANCE, TEN_COLUMNS, CARD_ASPECT } from './choreography';

/** High-rarity reveal: a white rim settles back to its rarity color, as in the 2D version. */
export function revealEdgeHighlight(age: number): number {
  if (age < 0) return 0;
  if (age < 0.6) {
    const t = age / 0.6;
    return 1 - 0.5 * t * t * (3 - 2 * t);
  }
  return 0.5 * Math.max(0, 1 - (age - 0.6) / 1.8);
}

/** The card fronts settle at z=0, just above the board illustration. */
export const GACHA_BOARD_Z = -0.08;

/** Screen-shaped board including its beveled frame; image cropping is handled by UVs. */
export function framedBackdropSize(viewWidth: number, viewHeight: number, _imageAspect: number): readonly [number, number] {
  const width = viewWidth * 1.45;
  const height = viewHeight * 1.45;
  const rim = Math.min(0.14, height * 0.035);
  return [width - rim * 2.24, height - rim * 2.24];
}

/** Keep the board footprint independent of paid-card scale so resizing cards does not resize the menu. */
export function sceneBoardDistance(aspect: number): number {
  const referenceScale = 0.82;
  return Math.max(MENU_CAMERA_DISTANCE * 1.65,
    frameDistance(referenceScale * (1 + (TEN_COLUMNS - 1) * 1.16), referenceScale * CARD_ASPECT * 2.25, 42, aspect) * 2.6);
}

/** Crop the illustration 20% inward, leaving room for menu parallax with the frame outside. */
export function menuBoardCameraDistance(aspect: number, _imageAspect = 1.6): number {
  const reference = sceneBoardDistance(aspect) - GACHA_BOARD_Z;
  const [viewWidth, viewHeight] = backdropSize(reference, 42, aspect);
  const [width, height] = framedBackdropSize(viewWidth, viewHeight, _imageAspect);
  const rim = Math.min(0.14, viewHeight * 1.45 * 0.035);
  const visibleHeight = Math.min((width - rim * 0.24) / aspect, height - rim * 0.24);
  return visibleHeight * 0.8 / (2 * Math.tan(21 * Math.PI / 180)) + GACHA_BOARD_Z + rim * 0.72;
}

/** Cover-style centered cropping keeps the illustration unstretched at every screen ratio. */
export function backdropTextureRepeat(boardAspect: number, imageAspect: number): readonly [number, number] {
  const image = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1.6;
  return [Math.min(1, boardAspect / image), Math.min(1, image / boardAspect)];
}
