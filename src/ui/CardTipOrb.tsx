import { useEffect, useRef } from 'react';

function rarityHsl(color: string): { h: number; s: number; l: number } {
  const hex = color.replace('#', '');
  const value = parseInt(hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex, 16);
  if (!Number.isFinite(value)) return { h: 43, s: .75, l: .55 };
  const r = ((value >> 16) & 255) / 255, g = ((value >> 8) & 255) / 255, b = (value & 255) / 255;
  const high = Math.max(r, g, b), low = Math.min(r, g, b), delta = high - low;
  const l = (high + low) / 2;
  if (delta === 0) return { h: 43, s: .12, l };
  const h = high === r ? ((g - b) / delta + (g < b ? 6 : 0)) * 60
    : high === g ? ((b - r) / delta + 2) * 60 : ((r - g) / delta + 4) * 60;
  return { h, s: delta / (1 - Math.abs(2 * l - 1)), l };
}

/** Local decorative motion stays visible independently of the scene's weather/static setting. */
export function CardTipOrb({ color }: { readonly color: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const base = rarityHsl(color);
    let frame = 0, last = 0, age = 0;
    const update = (now: number): void => {
      const element = ref.current;
      if (!element) return;
      if (!document.hidden) age += last ? Math.min(.05, (now - last) / 1000) : 0;
      last = now;
      const saturation = Math.max(.14, Math.min(.95, base.s));
      const light = Math.max(.42, Math.min(.65, base.l));
      const a = `hsl(${base.h + 28 * Math.sin(age * 1.8)} ${saturation * 100}% ${(light + .09 * Math.sin(age * 2.1)) * 100}%)`;
      const b = `hsl(${base.h - 32 * Math.cos(age * 1.5)} ${saturation * 88}% ${(light + .14) * 100}%)`;
      const c = `hsl(${base.h + 18 * Math.cos(age * 2)} ${saturation * 100}% ${Math.max(.18, light - .2) * 100}%)`;
      element.style.setProperty('--orb-a', a);
      element.style.setProperty('--orb-b', b);
      element.style.setProperty('--orb-c', c);
      element.style.setProperty('--orb-phase', `${age * 75}deg`);
      element.style.setProperty('--orb-highlight-x', `${50 + 24 * Math.cos(age * 1.25)}%`);
      element.style.setProperty('--orb-highlight-y', `${50 + 24 * Math.sin(age * 1.25)}%`);
      element.style.transform = `scale(${.97 + .055 * Math.sin(age * 2.1)})`;
      element.style.opacity = `${.91 + .09 * Math.sin(age * 2.1)}`;
      element.style.boxShadow = `inset -4px -5px 8px #09091799, inset 2px 2px 5px #fff5, 0 0 ${11 + 4 * Math.sin(age * 2.1)}px ${a}`;
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [color]);
  return <span ref={ref} className="cardtip__orb" />;
}
