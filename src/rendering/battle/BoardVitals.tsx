import { useEffect, useMemo } from 'react';
import { ExtrudeGeometry, MeshStandardMaterial, Shape } from 'three';
import { abyssVitalsShape } from '../abyss/abyssVitalsShape';
import { AbyssVitals, LiquidChannel } from './AbyssVitals';
import { STANDARD_VITALS } from './StandardTable';
import { BOARD_CENTER_Z } from './layout';
import { BOARD_VITALS_THEMES, type VitalsTheme } from './boardVitalsThemes';

const noHit = (): void => {};
function outline(width: number, length: number, angular: boolean) {
  if (!angular) return abyssVitalsShape(width, length);
  const x = width / 2, z = length / 2, cut = Math.min(.13, width * .25), shape = new Shape();
  shape.moveTo(-x + cut, -z); shape.lineTo(x - cut, -z); shape.lineTo(x, -z + cut);
  shape.lineTo(x, z - cut); shape.lineTo(x - cut, z); shape.lineTo(-x + cut, z);
  shape.lineTo(-x, z - cut); shape.lineTo(-x, -z + cut); shape.closePath();
  return shape;
}
function solid(shape: Shape, depth: number) {
  const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 14 });
  geometry.rotateX(-Math.PI / 2); return geometry;
}
function ThemedChannels({ theme, playerHp, enemyHp, playerMaxHp, enemyMaxHp }: {
  readonly theme: VitalsTheme; readonly playerHp: number; readonly enemyHp: number;
  readonly playerMaxHp: number; readonly enemyMaxHp: number;
}) {
  const { layout, style } = theme;
  const resources = useMemo(() => {
    const angular = ['mecha', 'volcano', 'solar'].includes(style);
    const shell = outline(layout.width + .18, layout.length + .25, angular);
    shell.holes.push(abyssVitalsShape(layout.channelWidth + .07, layout.length));
    const trim = outline(layout.width + .19, layout.length + .26, angular);
    trim.holes.push(outline(layout.width + .14, layout.length + .21, angular));
    return {
      shell: solid(shell, .055), trim: solid(trim, .012),
      bed: solid(abyssVitalsShape(layout.channelWidth + .06, layout.length), .015),
      frameMaterial: new MeshStandardMaterial({ color: theme.frame, metalness: theme.metalness, roughness: theme.roughness }),
      bedMaterial: new MeshStandardMaterial({ color: theme.bed, roughness: .95, metalness: 0 }),
      trimMaterial: new MeshStandardMaterial({ color: theme.trim, emissive: theme.trim, emissiveIntensity: style === 'solar' || style === 'mecha' ? .25 : .08, roughness: .5, metalness: .28 }),
    };
  }, [theme, layout, style]);
  useEffect(() => () => { Object.values(resources).forEach(resource => resource.dispose()); }, [resources]);
  return <group position={[0, theme.elevation ?? .035, BOARD_CENTER_Z]}>
    {([false, true] as const).map(enemy => {
      const direction = enemy ? -1 : 1;
      return <group key={String(enemy)}>
        <group position={[layout.x, 0, direction * layout.z]}>
          <mesh geometry={resources.shell} material={resources.frameMaterial} raycast={noHit} />
          <mesh geometry={resources.trim} material={resources.trimMaterial} position={[0, .056, 0]} raycast={noHit} />
          <mesh geometry={resources.bed} material={resources.bedMaterial} position={[0, .015, 0]} raycast={noHit} />
          <group position={[0, .065, -direction * (layout.length / 2 + .02)]}>
            {style === 'mecha' && <>
              {[-1, 1].map(x => <mesh key={x} position={[x * .17, 0, 0]} material={resources.trimMaterial} raycast={noHit}><boxGeometry args={[.055, .045, .3]} /></mesh>)}
              <mesh material={resources.frameMaterial} raycast={noHit}><boxGeometry args={[.24, .045, .1]} /></mesh>
            </>}
            {style === 'volcano' && [-1, 1].map(x => <mesh key={x} position={[x * .14, .025, 0]} rotation={[.3, x * .4, x * .3]} material={resources.frameMaterial} raycast={noHit}><dodecahedronGeometry args={[.14, 0]} /></mesh>)}
            {style === 'temple' && <>
              <mesh rotation={[-Math.PI / 2, 0, 0]} material={resources.trimMaterial} raycast={noHit}><torusGeometry args={[.16, .025, 6, 18]} /></mesh>
              <mesh position={[0, .02, 0]} material={resources.frameMaterial} raycast={noHit}><cylinderGeometry args={[.1, .12, .045, 12]} /></mesh>
            </>}
            {style === 'solar' && <>
              <mesh rotation={[-Math.PI / 2, .25, .45]} material={resources.trimMaterial} raycast={noHit}><torusGeometry args={[.23, .014, 5, 26]} /></mesh>
              <mesh position={[0, .045, 0]} material={resources.trimMaterial} raycast={noHit}><sphereGeometry args={[.075, 12, 8]} /></mesh>
            </>}
            {style === 'harvest' && [-1, 1].map(x => <group key={x} position={[x * .12, 0, 0]} rotation={[0, x * .5, -.3 * x]}>
              <mesh scale={[.5, .3, 1.4]} material={resources.trimMaterial} raycast={noHit}><sphereGeometry args={[.105, 8, 6]} /></mesh>
              <mesh position={[0, -.02, .12]} material={resources.frameMaterial} raycast={noHit}><boxGeometry args={[.025, .025, .24]} /></mesh>
            </group>)}
            {style === 'icefield' && [-1, 0, 1].map(x => <mesh key={x} position={[x * .12, .06, 0]} rotation={[x * .2, 0, x * -.22]} material={resources.trimMaterial} raycast={noHit}><coneGeometry args={[.065, .23 - Math.abs(x) * .06, 5]} /></mesh>)}
            {style === 'cloud' && [-1, 0, 1].map(x => <mesh key={x} position={[x * .12, 0, 0]} scale={[1.15, .5, .8]} material={resources.frameMaterial} raycast={noHit}><sphereGeometry args={[x === 0 ? .16 : .11, 12, 8]} /></mesh>)}
          </group>
        </group>
        <group position={[0, .052, 0]}>
          <LiquidChannel hp={enemy ? enemyHp : playerHp} maxHp={enemy ? enemyMaxHp : playerMaxHp} enemy={enemy} layout={layout}
            palette={enemy ? theme.enemy : theme.friendly} labelColor={enemy ? (style === 'cloud' || style === 'temple' || style === 'icefield' ? '#9e2435' : '#ff9c94') : style === 'cloud' || style === 'temple' || style === 'icefield' ? '#176251' : '#b4f2ce'} />
        </group>
      </group>;
    })}
  </group>;
}
/** All combat HP belongs to the tabletop; presentation state keeps it in sync with hit cues. */
export function BoardVitals({ themeId, ...hp }: { readonly themeId: string;
  readonly playerHp: number; readonly enemyHp: number; readonly playerMaxHp: number; readonly enemyMaxHp: number;
}) {
  if (themeId === 'abyss') return <AbyssVitals {...hp} />;
  const theme = BOARD_VITALS_THEMES[themeId];
  if (theme) return <ThemedChannels theme={theme} {...hp} />;
  return <AbyssVitals {...hp} layout={STANDARD_VITALS} />;
}
