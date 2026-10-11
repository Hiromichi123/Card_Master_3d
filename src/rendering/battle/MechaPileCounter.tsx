import { useEffect, useMemo } from 'react';
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';
import { numberCanvasFont } from '../text/numberFont';
import type { PileView } from './placements';

const noHit = (): void => {};
/** Georgia text replaces the old seven-segment stencil; colors and board placement stay shared. */
function numberLabel(pile: PileView): { texture: CanvasTexture; aspect: number } {
  const remaining = String(Math.max(0, Math.trunc(pile.count)));
  const total = String(Math.max(0, Math.trunc(pile.totalCount ?? pile.count)));
  const parts = pile.kind === 'deck'
    ? [{text: remaining, color: '#70ed9e'}, {text: `/${total}`, color: '#f4d368'}]
    : [{text: remaining, color: '#f37872'}];
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建牌堆数字贴图');
  ctx.font = numberCanvasFont(192);
  const text = parts.map(part => part.text).join(''), metrics = ctx.measureText(text);
  const ascent = Math.ceil(metrics.actualBoundingBoxAscent || 160), descent = Math.ceil(metrics.actualBoundingBoxDescent || 35);
  const padding = 14;
  canvas.width = Math.ceil(metrics.width) + padding * 2;
  canvas.height = ascent + descent + padding * 2;
  ctx.font = numberCanvasFont(192);ctx.textAlign = 'left';ctx.textBaseline = 'alphabetic';
  let x = padding;
  for (const part of parts) {
    ctx.fillStyle = part.color;ctx.fillText(part.text, x, padding + ascent);x += ctx.measureText(part.text).width;
  }
  const texture = new CanvasTexture(canvas);texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;texture.magFilter = LinearFilter;
  return {texture, aspect: canvas.width / canvas.height};
}

export function MechaPileCounter({pile}: {readonly pile: PileView}) {
  const label = useMemo(() => numberLabel(pile), [pile.count, pile.totalCount, pile.kind]);
  useEffect(() => () => label.texture.dispose(), [label]);
  const height = .43, width = Math.min(1.04, label.aspect * height);
  const direction = pile.side === 'player' ? 1 : -1;
  return <group position={[0,.028,direction*.98]} rotation={[-Math.PI/2,0,0]}>
    <mesh raycast={noHit} renderOrder={1}>
      <planeGeometry args={[width,height]}/>
      <meshBasicMaterial map={label.texture} transparent depthWrite={false} toneMapped={false} fog={false}/>
    </mesh>
  </group>;
}
