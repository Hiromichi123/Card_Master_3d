import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
export type PalacePart = 'stone' | 'wall' | 'roof' | 'wood';
/** Closed yellow-tile roof: hipped slopes, curling corners and raised ridge ends. */
export function palaceRoof(width: number, depth: number, rise: number): BufferGeometry {
  const nx = 16, nz = 12, stride = nz + 1, layer = (nx + 1) * stride;
  const positions: number[] = [], indices: number[] = [];
  const roofHeight = (x: number, z: number) => {
    const hip = Math.max(Math.abs(x), Math.max(0, (Math.abs(z) - .35) / .65));
    const curl = .20 * (Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(z), 4)) + .16 * Math.pow(Math.abs(x * z), 4);
    return rise * (1 - hip) + curl;
  };
  for (let side = 0; side < 2; side++) for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    const x = i / nx * 2 - 1, z = j / nz * 2 - 1;
    positions.push(x * width / 2, roofHeight(x, z) - side * .075, z * depth / 2);
  }
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const a = i * stride + j, b = a + stride, c = b + 1, d = a + 1;
    indices.push(a, d, b, d, c, b, a + layer, b + layer, d + layer, d + layer, b + layer, c + layer);
  }
  const edge = (a: number, b: number) => indices.push(a, b, a + layer, b, b + layer, a + layer);
  for (let i = 0; i < nx; i++) { edge(i * stride, (i + 1) * stride); edge((i + 1) * stride + nz, i * stride + nz); }
  for (let j = 0; j < nz; j++) { edge(j + 1, j); edge(nx * stride + j, nx * stride + j + 1); }
  // Low-profile tile ribs follow the curved slopes and catch light without textures.
  for (let row = 1; row < 12; row++) {
    const z = row / 12 * 2 - 1, start = positions.length / 3;
    for (let i = 0; i <= nx; i++) {
      const x = i / nx * 2 - 1;
      for (const rib of [-1, 0, 1]) {
        const rz = z + rib * .012;
        positions.push(x * width / 2, roofHeight(x, rz) + (rib === 0 ? .03 : .006), rz * depth / 2);
      }
    }
    for (let i = 0; i < nx; i++) {
      const a = start + i * 3, b = a + 3;
      indices.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
    }
  }
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox(); return geometry;
}
export function buildCloudPalace(tower: boolean): Record<PalacePart, BufferGeometry> {
  const parts: Record<PalacePart, BufferGeometry[]> = { stone: [], wall: [], roof: [], wood: [] };
  const add = (part: PalacePart, geometry: BufferGeometry, x: number, y: number, z: number) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone(); geometry.dispose();
    flat.deleteAttribute('uv'); flat.translate(x, y, z); parts[part].push(flat);
  };
  const box = (part: PalacePart, w: number, h: number, d: number, x: number, y: number, z: number) => add(part, new BoxGeometry(w, h, d), x, y, z);
  const levels = tower ? 3 : 1;
  box('stone', tower ? 2.2 : 4.1, .18, tower ? 2.2 : 2.9, 0, .09, 0);
  box('stone', tower ? 1.95 : 3.8, .16, tower ? 1.95 : 2.6, 0, .26, 0);
  for (let level = 0; level < levels; level++) {
    const scale = tower ? 1 - level * .13 : 1, width = (tower ? 1.4 : 3.1) * scale, depth = (tower ? 1.4 : 1.8) * scale;
    const bottom = .34 + level * 1.37, height = tower ? .86 : 1.5, top = bottom + height;
    box('wall', width, height, depth, 0, bottom + height / 2, 0);
    box('wood', width + .12, .10, depth + .12, 0, top, 0);
    for (const x of [-.44, 0, .44]) {
      const wx = x * width;
      box('wood', width * .20, height * .56, .035, wx, bottom + height * .52, depth / 2 + .018);
      for (const k of [-1, 0, 1]) box('roof', .024, height * .5, .025, wx + k * width * .052, bottom + height * .52, depth / 2 + .045);
      box('roof', width * .20, .025, .025, wx, bottom + height * .52, depth / 2 + .045);
    }
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      add('wall', new CylinderGeometry(.065 * scale, .08 * scale, height + .08, 8), x * (width / 2 + .13), bottom + height / 2, z * (depth / 2 + .12));
      box('roof', .15 * scale, .09, .16 * scale, x * (width / 2 + .13), top - .08, z * (depth / 2 + .12));
    }
    add('roof', palaceRoof(width + .85 * scale, depth + .85 * scale, tower ? .55 : .75), 0, top + .06, 0);
    // Tiled ridgeline and gilded upturned tips are actual geometry, not a flat decal.
    const ridge = new CylinderGeometry(.055, .055, depth * .65, 8); ridge.rotateX(Math.PI / 2);
    add('roof', ridge, 0, top + (tower ? .65 : .85), 0);
    for (const z of [-1, 1]) add('roof', new CylinderGeometry(.015, .05, .20, 6), 0, top + (tower ? .77 : .97), z * depth * .36);
    box('stone', width + .45, .08, depth + .45, 0, bottom, 0);
  }
  if (!tower) {
    box('wood', .6, 1.2, .07, 0, .94, .98);
    for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
      const x = side * (1.65 - i * .32);
      box('stone', .045, .3, .045, x, .48, 1.25);
    }
    box('stone', 3.5, .055, .07, 0, .64, 1.25);
    box('stone', 1.4, .10, .4, 0, .05, 1.52);
  }
  return Object.fromEntries(Object.entries(parts).map(([key, fragments]) => {
    const merged = mergeGeometries(fragments)!; fragments.forEach(g => g.dispose()); merged.computeBoundingBox(); return [key, merged];
  })) as Record<PalacePart, BufferGeometry>;
}

/** Open three-bay ceremonial gate: red columns, layered yellow roofs and a dark signboard. */
export function buildCloudGate(): Record<PalacePart, BufferGeometry> {
  const parts: Record<PalacePart, BufferGeometry[]> = { stone: [], wall: [], roof: [], wood: [] };
  const add = (part: PalacePart, geometry: BufferGeometry, x: number, y: number, z: number) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone(); geometry.dispose(); flat.deleteAttribute('uv'); flat.translate(x, y, z); parts[part].push(flat);
  };
  const box = (part: PalacePart, w: number, h: number, d: number, x: number, y: number, z: number) => add(part, new BoxGeometry(w, h, d), x, y, z);
  box('stone', 4.7, .18, 1.7, 0, .09, 0);
  box('stone', 4.4, .12, 1.45, 0, .24, 0);
  for (const x of [-1.85, -.9, .9, 1.85]) {
    const height = Math.abs(x) < 1 ? 2.85 : 2.2;
    box('stone', .37, .24, .4, x, .42, 0);
    add('wall', new CylinderGeometry(.11, .14, height, 10), x, height / 2 + .4, 0);
    box('roof', .27, .11, .34, x, height + .28, 0);
  }
  box('wall', 2.7, .24, .42, 0, 2.98, 0);
  box('wood', 2.65, .10, .49, 0, 3.12, 0);
  add('roof', palaceRoof(3.05, 1.6, .65), 0, 3.2, 0);
  add('roof', palaceRoof(2.55, 1.35, .5), 0, 2.7, 0);
  for (const x of [-1.48, 1.48]) {
    box('wall', 1.1, .18, .35, x, 2.28, 0);
    add('roof', palaceRoof(1.65, 1.2, .35), x, 2.40, 0);
  }
  box('wood', 1.28, .43, .09, 0, 3.0, .29);
  for (const x of [-.7, .7]) box('roof', .045, .5, .08, x, 3, .32);
  for (const y of [2.75, 3.25]) box('roof', 1.44, .045, .08, 0, y, .32);
  return Object.fromEntries(Object.entries(parts).map(([part, fragments]) => {
    const geometry = mergeGeometries(fragments)!; fragments.forEach(g => g.dispose()); geometry.computeBoundingBox(); return [part, geometry];
  })) as Record<PalacePart, BufferGeometry>;
}
