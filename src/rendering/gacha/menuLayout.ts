/** Port of card_maker/scenes/gacha/gacha_menu.py, in its 2880 × 1800 design space. */
export const GACHA_MENU_WIDTH = 2880;
export const GACHA_MENU_HEIGHT = 1800;
export const DASHBOARD_STEP = 140;

export interface PreviewRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Keep the legacy order: horizontal (<4), semicircle (4–7), outer then inner fan (>7). */
export function showcaseRects(count: number): PreviewRect[] {
  if (count <= 0) return [];
  const x = Math.trunc(GACHA_MENU_WIDTH * 0.45) + (count < 4 ? Math.trunc(GACHA_MENU_WIDTH * -0.1) : 0);
  const y = Math.trunc(GACHA_MENU_HEIGHT * 0.30) + (count < 4 ? Math.trunc(GACHA_MENU_HEIGHT * -0.1) : 0);
  const width = Math.trunc(GACHA_MENU_WIDTH * 0.4);
  const height = Math.trunc(GACHA_MENU_HEIGHT * 0.6);
  if (count < 4) {
    const cardWidth = 360;
    const cardHeight = 540;
    const spacing = Math.trunc(cardWidth * 0.3);
    const total = count * cardWidth + (count - 1) * spacing;
    const start = x + Math.floor((width - total) / 2);
    return Array.from({ length: count }, (_, index) => ({
      x: start + index * (cardWidth + spacing), y: y + Math.floor((height - cardHeight) / 2),
      width: cardWidth, height: cardHeight,
    }));
  }
  const centerX = x + Math.floor(width / 2);
  const centerY = y + Math.floor(height / 2) + Math.trunc(300 * 0.28);
  const fan = (n: number, radius: number): PreviewRect[] => Array.from({ length: n }, (_, index) => {
    const angle = (n > 1 ? -90 + 180 * index / (n - 1) : 0) * Math.PI / 180;
    return { x: Math.trunc(centerX + radius * Math.sin(angle) - 150),
      y: Math.trunc(centerY - radius * Math.cos(angle) - 225), width: 300, height: 450 };
  });
  if (count <= 7) return fan(count, 600);
  const inner = Math.trunc(count * 0.3);
  return [...fan(count - inner, Math.trunc(300 * 2 * 1.15)), ...fan(inner, 300)];
}

/** Both layout and card sizes use one scale so changing aspect ratio never stretches cards. */
export function menuFit(width: number, height: number): number {
  return Math.max(0, Math.min(width / GACHA_MENU_WIDTH, height / GACHA_MENU_HEIGHT));
}

export function dashboardSelection(offset: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.round(offset / DASHBOARD_STEP)));
}
