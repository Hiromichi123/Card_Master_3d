import { useEffect, useMemo } from 'react';
import { BufferGeometry, Color, Float32BufferAttribute, Shape, ShapeGeometry } from 'three';
import type { PileView } from './placements';

const noHit = (): void => {};
const DIGITS: Readonly<Record<string, readonly number[]>> = {
  '0': [0,1,2,3,4,5], '1': [1,2], '2': [0,1,6,4,3], '3': [0,1,2,3,6],
  '4': [5,6,1,2], '5': [0,5,6,2,3], '6': [0,5,4,3,2,6],
  '7': [0,1,2], '8': [0,1,2,3,4,5,6], '9': [0,1,2,3,5,6],
};
const GREEN = new Color('#70ed9e'), YELLOW = new Color('#f4d368'), RED = new Color('#f37872');

function polygon(points: readonly (readonly [number, number])[]): Shape {
  const shape = new Shape();
  points.forEach(([x,y], i) => { if (i === 0) shape.moveTo(x,y); else shape.lineTo(x,y); });
  shape.closePath(); return shape;
}
function segment(index: number): Shape {
  const horizontal = index === 0 || index === 3 || index === 6;
  const cx = horizontal ? .31 : index === 1 || index === 2 ? .56 : .06;
  const cy = index === 0 ? .94 : index === 3 ? .06 : index === 6 ? .5 : index === 1 || index === 5 ? .72 : .28;
  const length = horizontal ? .46 : .31;
  const t = .09, b = .045;
  const points: [number, number][] = [
    [-length/2,0], [-length/2+b,-t/2], [length/2-b,-t/2], [length/2,0],
    [length/2-b,t/2], [-length/2+b,t/2],
  ];
  return polygon(points.map(([x,y]) => horizontal ? [cx+x,cy+y] as const : [cx+y,cy+x] as const));
}

/** A local vector stencil, with squared chamfered ends; no bitmap or remote font dependency. */
function numberGeometry(pile: PileView): { geometry: BufferGeometry; width: number } {
  const deck = pile.kind === 'deck';
  const remaining = String(Math.max(0, Math.trunc(pile.count)));
  const text = deck ? `${remaining}/${Math.max(0, Math.trunc(pile.totalCount ?? pile.count))}` : remaining;
  const width = text.length * .74 - .12;
  const vertices: number[] = [], colors: number[] = [];
  [...text].forEach((char, charIndex) => {
    const color = deck ? charIndex < remaining.length ? GREEN : YELLOW : RED;
    const shapes = char === '/'
      ? [polygon([[.08,.08],[.18,.06],[.55,.91],[.45,.94]])]
      : (DIGITS[char] ?? DIGITS['0']!).map(segment);
    for (const shape of shapes) {
      const indexed = new ShapeGeometry(shape);
      const piece = indexed.toNonIndexed();
      const positions = piece.getAttribute('position');
      for (let i=0;i<positions.count;i++) {
        vertices.push(positions.getX(i)+charIndex*.74-width/2, positions.getY(i)-.5, 0);
        colors.push(color.r,color.g,color.b);
      }
      piece.dispose();
      if (piece !== indexed) indexed.dispose();
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices,3));
  geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();
  return { geometry, width };
}

export function MechaPileCounter({ pile }: { readonly pile: PileView }) {
  const label = useMemo(() => numberGeometry(pile), [pile.count, pile.totalCount, pile.kind]);
  useEffect(() => () => label.geometry.dispose(), [label]);
  const scaleX = Math.min(.68, 2.08 / Math.max(.1,label.width));
  const direction = pile.side === 'player' ? 1 : -1;
  return <group position={[0,.028,direction*.98]} rotation={[-Math.PI/2,0,0]}>
    <mesh geometry={label.geometry} dispose={null} scale={[scaleX * .5,.43,1]} raycast={noHit} renderOrder={1}>
      <meshBasicMaterial vertexColors toneMapped={false} fog={false} />
    </mesh>
  </group>;
}
