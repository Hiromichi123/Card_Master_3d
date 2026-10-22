import { useEffect, useMemo } from 'react';
import { CanvasTexture, ExtrudeGeometry, MeshStandardMaterial, Shape, SRGBColorSpace } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildMaterial, type QualityLevel } from '../table/materials';
import type { TableTheme } from '../table/themes';
import { abyssVitalsShape } from '../abyss/abyssVitalsShape';
import { BATTLE_CARD_SCALE, BOARD_CENTER_Z, buildSlots, CARD_SIZE, PILE_CARD_SCALE, PREP_CARD_SCALE, pilePosition } from './layout';

export const STANDARD_VITALS = { x: -5.30, z: 2.55, width: .19, length: 3.7, channelWidth: .11 } as const;
const noHit = (): void => {};

function rectangle(width: number, depth: number, radius: number, x = 0, z = 0): Shape {
  const shape = new Shape(), left = x - width / 2, right = x + width / 2, bottom = -z - depth / 2, top = -z + depth / 2;
  shape.moveTo(left + radius, bottom); shape.lineTo(right - radius, bottom);
  shape.quadraticCurveTo(right, bottom, right, bottom + radius); shape.lineTo(right, top - radius);
  shape.quadraticCurveTo(right, top, right - radius, top); shape.lineTo(left + radius, top);
  shape.quadraticCurveTo(left, top, left, top - radius); shape.lineTo(left, bottom + radius);
  shape.quadraticCurveTo(left, bottom, left + radius, bottom); shape.closePath();
  return shape;
}
function plate(shape: Shape, depth: number, top = 0) {
  const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 });
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, top - depth, 0);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!, uv = geometry.getAttribute('uv'), position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) uv.setXY(i, (position.getX(i) - bounds.min.x) / Math.max(.001, bounds.max.x - bounds.min.x), (position.getZ(i) - bounds.min.z) / Math.max(.001, bounds.max.z - bounds.min.z));
  uv.needsUpdate = true;
  return geometry;
}
function corkTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建软木纹理');
  ctx.fillStyle = '#b99361'; ctx.fillRect(0, 0, 192, 512);
  let seed = 31209;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  const colors = ['#82603e', '#c9a878', '#ad824f', '#ddbd8d', '#947044'];
  for (let i = 0; i < 9500; i++) {
    ctx.fillStyle = colors[Math.floor(random() * colors.length)]!;
    ctx.globalAlpha = .2 + random() * .5;
    ctx.fillRect(random() * 192, random() * 512, 1 + random() * 3, 1 + random() * 5);
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; return texture;
}

/** Original light/dark chessboard materials, arranged as one mat with inset card pads. */
export function StandardTable({ theme, quality }: { readonly theme: TableTheme; readonly quality: QualityLevel }) {
  const resources = useMemo(() => {
    // Expand each side by half a battle-card width; preserve the actual card layout.
    const expansion = CARD_SIZE.width * BATTLE_CARD_SCALE;
    const matWidth = 11.3 + expansion, matDepth = 11.8 + expansion;
    const mat = rectangle(matWidth, matDepth, .18);
    const pads = buildSlots().map(slot => {
      const scale = slot.zone === 'battle' ? BATTLE_CARD_SCALE : PREP_CARD_SCALE;
      return { x: slot.position[0], z: slot.position[2] - BOARD_CENTER_Z, width: CARD_SIZE.width * scale * .93, depth: CARD_SIZE.height * scale * .93 };
    });
    for (const side of ['player', 'enemy'] as const) for (const kind of ['deck', 'discard'] as const) {
      const position = pilePosition(side, kind);
      pads.push({ x: position[0], z: position[2] - BOARD_CENTER_Z, width: CARD_SIZE.width * PILE_CARD_SCALE * .93, depth: CARD_SIZE.height * PILE_CARD_SCALE * .93 });
    }
    const seams: ExtrudeGeometry[] = [];
    const blackParts = pads.map(pad => {
      const shape = rectangle(pad.width, pad.depth, .055, pad.x, pad.z);
      const boundary = rectangle(pad.width + .05, pad.depth + .05, .07, pad.x, pad.z);
      mat.holes.push(rectangle(pad.width + .05, pad.depth + .05, .07, pad.x, pad.z));
      boundary.holes.push(shape);
      seams.push(plate(boundary, .10, -.020));
      return plate(shape, .05, -.002);
    });
    for (const side of [-1, 1]) mat.holes.push(rectangle(.48, 4.12, .12, STANDARD_VITALS.x, side * STANDARD_VITALS.z));
    const white = plate(mat, .20, -.085);
    const seam = mergeGeometries(seams); seams.forEach(part => part.dispose());
    if (!seam) throw new Error('无法创建嵌垫交界');
    const black = mergeGeometries(blackParts); blackParts.forEach(part => part.dispose());
    if (!black) throw new Error('无法创建标准盘面嵌垫');
    const rimWidth = .68; // Double the outer wooden rim width; keep the playable opening unchanged.
    const outer = rectangle(matWidth + rimWidth * 2, matDepth + rimWidth * 2, .28); outer.holes.push(rectangle(matWidth, matDepth, .18));
    const frame = plate(outer, 1.12, .44);
    const corkShape = rectangle(.48, 4.12, .12);
    corkShape.holes.push(abyssVitalsShape(STANDARD_VITALS.width, STANDARD_VITALS.length));
    const cork = plate(corkShape, .07, -.001);
    const channel = plate(abyssVitalsShape(STANDARD_VITALS.width, STANDARD_VITALS.length), .016, -.022);
    const texture = corkTexture();
    return { white, black, seam, frame, cork, channel, texture,
      seamMaterial: new MeshStandardMaterial({ color: '#24170f', roughness: .93, metalness: 0 }),
      whiteMaterial: buildMaterial({ ...theme.mat.dark, color: 0x70553e, light: 0x806347, dark: 0x57402e, roughness: .52, clearcoat: .20, clearcoatRoughness: .42, envMapIntensity: .45 }, { quality, textureScale: 1 }),
      blackMaterial: buildMaterial({ ...theme.mat.light, roughness: .35, clearcoat: .38, clearcoatRoughness: .28, envMapIntensity: .65 }, { quality, textureScale: 1 }),
      frameMaterial: buildMaterial({ ...theme.mat.frame, roughness: .44, clearcoat: .28, clearcoatRoughness: .34 }, { quality }),
      corkMaterial: new MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 }),
      channelMaterial: new MeshStandardMaterial({ color: '#30291e', roughness: 1, metalness: 0 }),
    };
  }, [theme, quality]);
  useEffect(() => () => { Object.values(resources).forEach(resource => resource.dispose()); }, [resources]);
  return <group position={[0, 0, BOARD_CENTER_Z]}>
    <mesh geometry={resources.white} material={resources.whiteMaterial} receiveShadow raycast={noHit} />
    <mesh geometry={resources.black} material={resources.blackMaterial} receiveShadow raycast={noHit} />
    <mesh geometry={resources.seam} material={resources.seamMaterial} receiveShadow raycast={noHit} />
    <mesh geometry={resources.frame} material={resources.frameMaterial} receiveShadow castShadow raycast={noHit} />
    {[-1, 1].map(side => <group key={side} position={[STANDARD_VITALS.x, 0, side * STANDARD_VITALS.z]}>
      <mesh geometry={resources.cork} material={resources.corkMaterial} receiveShadow raycast={noHit} />
      <mesh geometry={resources.channel} material={resources.channelMaterial} raycast={noHit} />
      {Array.from({ length: 11 }, (_, index) => <mesh key={index} position={[.16, .003, -STANDARD_VITALS.length / 2 + index * STANDARD_VITALS.length / 10]} raycast={noHit}>
        <boxGeometry args={[index % 5 === 0 ? .09 : .045, .006, .013]} /><meshBasicMaterial color="#51412d" />
      </mesh>)}
    </group>)}
  </group>;
}
