import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DoubleSide, ShaderMaterial } from 'three';
import { CARD_DIMENSIONS, CARD_FACE_OFFSET } from './cardGeometry';
import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import { useSettingsStore } from '../../state/settingsStore';

const vertex = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
const fragment = `varying vec2 vUv;uniform float uAge,uTime,uPuppet;uniform vec3 uColor;
void main(){vec2 p=vUv-.5;
float mask=(1.-smoothstep(.46,.5,abs(p.x)))*(1.-smoothstep(.47,.5,abs(p.y)));
float edge=smoothstep(.2,.48,max(abs(p.x),abs(p.y)));
float flow=.5+.5*sin(p.y*19.+sin(p.x*12.-uTime*.8)+uTime*1.1);
float pulse=.5+.5*sin(uTime*1.5);
float reveal=1.-exp(-uAge*12.);float flash=exp(-uAge*3.7);
float threads=pow(.5+.5*sin(p.x*45.+sin(p.y*10.)+uTime*.3),24.)*uPuppet;
float alpha=(.13+edge*.17+flow*.055+pulse*.025+threads*.10+flash*.43)*mask*reveal;
gl_FragColor=vec4(mix(uColor,uColor+vec3(.12),edge+flash*.3),alpha);}`;

function ControlLayer({ kind, index }: { readonly kind:'charm'|'puppet'; readonly index:number }) {
  const still = useSettingsStore(state => state.reduceMotion);
  const material = useMemo(() => new ShaderMaterial({ vertexShader:vertex, fragmentShader:fragment,
    uniforms:{ uAge:{value:0},uTime:{value:0},uPuppet:{value:kind==='puppet'?1:0},
      uColor:{value:new Color(kind==='charm'?'#ed72bb':'#ed962e')} }, transparent:true,
    depthWrite:false, side:DoubleSide, toneMapped:false }),[kind]);
  useFrame((_,delta) => {
    const step=Math.min(delta,.05)/ANIMATION_DURATION_SCALE;
    material.uniforms['uAge']!.value+=step;
    if(!still)material.uniforms['uTime']!.value+=step;
  });
  useEffect(()=>()=>material.dispose(),[material]);
  return <mesh position={[0,0,CARD_FACE_OFFSET+.009+index*.002]} material={material} renderOrder={20+index} raycast={()=>{}}>
    <planeGeometry args={[CARD_DIMENSIONS.width,CARD_DIMENSIONS.height]} />
  </mesh>;
}
export function ControlStatusOverlay({ charmed, puppeted }: { readonly charmed:boolean; readonly puppeted:boolean }) {
  return <>{charmed&&<ControlLayer kind="charm" index={0}/>} {puppeted&&<ControlLayer kind="puppet" index={1}/>}</>;
}
