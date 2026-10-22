import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, Matrix4, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, Vector3, type InstancedMesh } from 'three';
import { cloudBuildingLayout, type PalaceIsland, type CloudBuilding } from './cloudPalaceLayout';
import { buildCloudPalace, buildCloudGate, type PalacePart } from './cloudPalaceGeometry';
const noHit = (): void => {};
function PalaceBatch({ kind, records, clock }: { readonly kind: 'hall' | 'tower' | 'gate'; readonly records: readonly CloudBuilding[]; readonly clock: Readonly<{ current: number }> }) {
  const meshes = useRef<Record<string, InstancedMesh>>({}), last = useRef(-1);
  const geometry = useMemo(() => kind === 'gate' ? buildCloudGate() : buildCloudPalace(kind === 'tower'), [kind]);
  const materials = useMemo(() => ({
    stone: new MeshStandardMaterial({ color: '#e0d8bb', roughness: .85 }),
    wall: new MeshStandardMaterial({ color: '#a3332c', roughness: .72 }),
    roof: new MeshStandardMaterial({ color: '#dca633', roughness: .6, metalness: .18 }),
    wood: new MeshStandardMaterial({ color: '#352622', roughness: .88 }),
  }), []);
  const sign = useMemo(() => {
    if (kind !== 'gate') return null;
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 160;
    const context = canvas.getContext('2d');
    if (context) { context.font = 'bold 112px SimSun, "Songti SC", serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = '#f6d77f'; context.fillText('南天门', 256, 84); }
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
    const geometry = new PlaneGeometry(1.1, .35); geometry.translate(0, 3, .345);
    return { geometry, material: new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }), texture };
  }, [kind]);
  useEffect(() => () => { sign?.geometry.dispose(); sign?.material.dispose(); sign?.texture.dispose(); }, [sign]);
  const matrix = useMemo(() => new Matrix4(), []), scale = useMemo(() => new Vector3(), []);
  const update = () => {
    const t = clock.current;
    records.forEach((record, i) => {
      const cluster = record.cluster;
      const dx = cluster === undefined ? 0 : Math.sin(t * .09 + cluster) * 2.1;
      const dy = cluster === undefined ? 0 : Math.sin(t * .16 + cluster * 1.7) * .35;
      const dz = cluster === undefined ? 0 : Math.cos(t * .07 + cluster) * 1.4;
      matrix.makeRotationY(record.yaw); matrix.scale(scale.setScalar(record.scale));
      matrix.setPosition(record.x + dx, record.y + dy, record.z + dz);
      for (const mesh of Object.values(meshes.current)) mesh?.setMatrixAt(i, matrix);
    });
    for (const mesh of Object.values(meshes.current)) if (mesh) mesh.instanceMatrix.needsUpdate = true;
    last.current = t;
  };
  useLayoutEffect(update, [records, geometry, matrix]);
  useFrame(() => { if (clock.current !== last.current) update(); });
  useEffect(() => () => { Object.values(geometry).forEach(g => g.dispose()); Object.values(materials).forEach(m => m.dispose()); }, [geometry, materials]);
  return <>{(Object.keys(geometry) as PalacePart[]).map(part => <instancedMesh key={part} ref={mesh => { if (mesh) meshes.current[part] = mesh; }}
    args={[geometry[part], materials[part], records.length]} frustumCulled={false} dispose={null} raycast={noHit} receiveShadow />)}
    {sign && <instancedMesh ref={mesh => { if (mesh) meshes.current.sign = mesh; }} args={[sign.geometry, sign.material, records.length]}
      frustumCulled={false} dispose={null} raycast={noHit} />}</>;
}
/** Palaces are outside all card lanes; distant buildings share their host cloud's motion. */
export function CloudPalaces({ islands, clock }: { readonly islands: readonly PalaceIsland[]; readonly clock: Readonly<{ current: number }> }) {
  const records = useMemo(() => cloudBuildingLayout(islands), [islands]);
  return <><PalaceBatch kind="hall" records={records.halls} clock={clock} /><PalaceBatch kind="tower" records={records.towers} clock={clock} />
    <PalaceBatch kind="gate" records={records.gates} clock={clock} /></>;
}
