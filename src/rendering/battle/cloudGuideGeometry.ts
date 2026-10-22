import { BufferGeometry, Float32BufferAttribute, Path } from 'three';
import { buildSlots, LAYOUT } from './layout';
/** Flat gold inlay: open card corners, ruyi cloud curls, perimeter scrolls and deployment arrows. */
export function cloudGuideGeometry(): BufferGeometry {
  const vertices: number[] = [];
  const stroke = (points: readonly { x: number; y: number }[], width = .025) => {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!, length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < .00001) continue;
      const x = -(b.y - a.y) / length * width / 2, z = (b.x - a.x) / length * width / 2;
      vertices.push(a.x + x, -.008, a.y + z, b.x + x, -.008, b.y + z, a.x - x, -.008, a.y - z,
        a.x - x, -.008, a.y - z, b.x + x, -.008, b.y + z, b.x - x, -.008, b.y - z);
    }
  };
  const line = (x1: number, z1: number, x2: number, z2: number, width = .025) => stroke([{ x: x1, y: z1 }, { x: x2, y: z2 }], width);
  for (const slot of buildSlots().filter(s => s.zone === 'battle')) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = slot.position[0] + sx * .86, z = slot.position[2] - LAYOUT.tableCenterZ + sz * 1.19;
    line(x - sx * .26, z, x, z); line(x, z, x, z - sz * .26);
    const hook = new Path(); hook.moveTo(x - sx * .34, z); hook.quadraticCurveTo(x - sx * .45, z + sz * .12, x - sx * .32, z + sz * .14);
    stroke(hook.getPoints(10), .018);
  }
  const cloud = new Path(); cloud.moveTo(-.92, -.10);
  cloud.bezierCurveTo(-.65, -.10, -.75, .32, -.48, .30);
  cloud.bezierCurveTo(-.60, .64, -.08, .73, .06, .40);
  cloud.bezierCurveTo(.32, .65, .69, .45, .49, .23);
  cloud.bezierCurveTo(.88, .25, .96, -.13, .58, -.16);
  cloud.bezierCurveTo(.32, -.22, .05, -.08, .25, .12);
  cloud.bezierCurveTo(.36, .24, .57, .10, .41, -.02);
  const motif = cloud.getPoints(48);
  for (const sx of [-1, 1]) {
    for (const x of [1.55, 3.5]) stroke(motif.map(p => ({ x: sx * (x + p.x * .68), y: p.y * .45 - .10 })), .032);
    line(sx * .55, -.20, sx * 5.0, -.20, .017);
    line(sx * .85, -.29, sx * 4.65, -.29, .013);
    for (const sz of [-1, 1]) {
      for (const z of [1.0, 4.9]) stroke(motif.map(p => ({ x: sx * (6.35 + p.y * .65), y: sz * (z + p.x * .55) })), .026);
      if (sx === 1) for (const x of [-3.7, -1.85, 0, 1.85, 3.7]) {
        stroke([{ x: x - .12, y: sz * 3.18 }, { x, y: sz * 3.04 }, { x: x + .12, y: sz * 3.18 }], .023);
      }
    }
  }
  const medallion = new Path(); medallion.absarc(0, 0, .37, 0, Math.PI * 2);
  stroke(medallion.getPoints(56), .023);
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals(); geometry.computeBoundingBox(); return geometry;
}
