import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, Color, type Group, type ShaderMaterial } from 'three';
import type { CardDefinition } from '../domain/cards/types';
import { useRarityIndex } from '../state/useRarityIndex';

export interface AbyssUpgradePresentation {
  readonly id: string;
  readonly targetId: string;
  readonly from: CardDefinition['rarity'];
  readonly to: CardDefinition['rarity'];
  readonly revision: number;
  readonly phase: 'saving' | 'waiting' | 'playing';
}
const vertex = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragment = `varying vec2 vUv;uniform float progress;uniform vec3 fromColor;uniform vec3 toColor;
void main(){
  float t=clamp(progress,0.,1.);vec2 p=vUv-.5;
  float edge=min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y));
  float rim=1.-smoothstep(.025,.09,edge);
  float wave=exp(-abs(length(p*vec2(1.,.67))-t*.7)*35.);
  float core=exp(-length(p*vec2(1.,.67))*8.)*.3;
  float life=pow(max(0.,sin(t*3.14159265)),.6);
  vec3 color=mix(fromColor,toColor,smoothstep(.08,.9,t));
  gl_FragColor=vec4(color*(1.7+wave*.5),life*(rim*.85+wave*.42+core));
}`;

/** Unscaled two-second bloom: a frame sweep and rising motes, interpolating the saved rarities. */
export function AbyssUpgradeGlow({ upgrade }: { readonly upgrade: AbyssUpgradePresentation }) {
  const rarity = useRarityIndex(), face = useRef<ShaderMaterial>(null), particles = useRef<Group>(null), elapsed = useRef(0);
  const uniforms = useMemo(() => ({ progress: { value: 0 }, fromColor: { value: new Color(rarity.colorOf(upgrade.from)) },
    toColor: { value: new Color(rarity.colorOf(upgrade.to)) } }), [rarity, upgrade.from, upgrade.to]);
  useFrame((_, delta) => {
    if (!document.hidden) elapsed.current += Math.min(.1, delta);
    const t = Math.min(1, elapsed.current / 2);
    if (face.current) face.current.uniforms['progress']!.value = t;
    particles.current?.children.forEach((mesh, index) => {
      const angle = index / 24 * Math.PI * 2, pulse = (t * 1.7 + index * .137) % 1;
      mesh.position.set(Math.cos(angle) * (.52 + pulse * .22), .06 + pulse * .7, Math.sin(angle) * (.79 + pulse * .22));
      mesh.scale.setScalar(Math.sin(Math.PI * pulse) * Math.sin(Math.PI * t) * .035);
    });
  });
  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .06, 0]} renderOrder={5} raycast={() => {}}>
      <planeGeometry args={[1.18, 1.78]} />
      <shaderMaterial ref={face} uniforms={uniforms} vertexShader={vertex} fragmentShader={fragment} transparent depthWrite={false}
        blending={AdditiveBlending} toneMapped={false} />
    </mesh>
    <group ref={particles}>{Array.from({ length: 24 }, (_, index) => <mesh key={index} scale={0} raycast={() => {}}>
      <octahedronGeometry args={[1, 0]} /><meshBasicMaterial color={rarity.colorOf(index < 12 ? upgrade.from : upgrade.to)} toneMapped={false} />
    </mesh>)}</group>
  </group>;
}
