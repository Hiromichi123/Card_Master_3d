/** Matches chapter numbering; native Canvas uses the installed face without CSS-font loading. */
export const NUMBER_FONT_FAMILY = 'Georgia, "Times New Roman", serif';
export function numberCanvasFont(size: number, weight = 700): string {
  return `${weight} ${size}px ${NUMBER_FONT_FAMILY}`;
}
