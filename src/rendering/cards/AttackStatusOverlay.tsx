import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { AdditiveBlending, DoubleSide, NormalBlending, ShaderMaterial } from 'three';
import type { AttackStatusKind } from '../../domain/cards/types';
import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import { CARD_DIMENSIONS, CARD_FACE_OFFSET } from './cardGeometry';
import { BURN_CRACK_GLSL, FRACTURE_GLSL, STATUS_NOISE_GLSL, burnCrackSegments, fractureUniforms } from './statusPatterns';

const VERTEX=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const FRAGMENT=`varying vec2 vUv;uniform float uTime;
${STATUS_NOISE_GLSL}${FRACTURE_GLSL}${BURN_CRACK_GLSL}
void main(){vec2 p=vUv-.5;
float mask=(1.-smoothstep(.465,.5,abs(p.x)))*(1.-smoothstep(.47,.5,abs(p.y)));
vec2 flow=p*7.+vec2(uTime*.17,-uTime*.13);
float fog=fbm(flow);vec3 color;float alpha;
#ifdef FROST
  float frost=smoothstep(.27,.73,fbm(p*16.));float crack=fractureEdge(vUv);
  color=mix(vec3(.54,.73,.81),vec3(.94,.98,1.),frost);
  // 70% of the original pre-reduction white-ice opacity (.18 + .30 + .14).
  alpha=.126+frost*.21+crack*.098;
#elif defined(BURN)
  vec4 seam=burnCracks(vUv,uTime);color=seam.rgb;alpha=seam.a;
#elif defined(POISON)
  vec2 warp=vec2(fbm(flow+2.7),fbm(flow-4.1));
  float curls=fbm(flow+warp*2.8),detail=fbm(flow*3.1-warp*1.4);
  color=mix(vec3(.015,.085,.021),vec3(.19,.51,.065),curls*.72+detail*.28);
  alpha=.12+smoothstep(.22,.78,curls)*(.28+detail*.14);
#elif defined(BLEED)
  float drips=0.;
  for(int i=0;i<9;i++){
    float x=hash(vec2(float(i),3.))-.5;
    float y=.5-fract(uTime*(.10+hash(vec2(float(i),2.))*.10)+hash(vec2(float(i),4.)));
    vec2 q=(p-vec2(x,y))*vec2(90.,14.);drips+=exp(-dot(q,q))*1.5;
  }
  color=mix(vec3(.23,.002,.017),vec3(.61,.018,.035),min(1.,drips));alpha=.25+fog*.16+min(1.,drips)*.48;
#else
  color=mix(vec3(.065,.001,.008),vec3(.21,.006,.018),fog);alpha=.35+fog*.19;
#endif
gl_FragColor=vec4(color,alpha*mask);}`;
const PARTICLE_VERTEX=`attribute float aSeed;uniform float uTime,uPixelRatio;varying float vLife;varying float vSeed;
void main(){vec3 p=position;
#ifdef EMBER
  float flight=fract(aSeed+uTime*(.42+aSeed*.30));p.z=.04+flight*.43;
  p.xy+=vec2(sin(uTime*.8+aSeed*23.),cos(uTime*.7+aSeed*31.))*.025*flight;
  vLife=sin(flight*3.14159);float pixelSize=19.;
#else
  float fall=fract(aSeed+uTime*.26);p.z=.30*(1.-fall);
  p.xy+=vec2(sin(uTime+aSeed*23.),cos(uTime*.7+aSeed*31.))*.035;
  vLife=.72;float pixelSize=24.5;
#endif
vSeed=aSeed;vec4 view=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*view;
gl_PointSize=clamp(pixelSize/max(1.,-view.z),1.,3.)*uPixelRatio;}`;
const PARTICLE_FRAGMENT=`varying float vLife,vSeed;
void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;
#ifdef EMBER
  vec3 color=mix(vec3(1.2,.055,.008),vec3(1.4,.80,.11),vSeed);
#else
  vec3 color=vec3(.87,.95,1.);
#endif
gl_FragColor=vec4(color,(1.-smoothstep(.05,.5,d))*vLife*.73);}`;

function StatusLayer({kind,index}:{kind:AttackStatusKind;index:number}) {
  const assets=useMemo(()=>{
    const cracks=burnCrackSegments();
    const material=new ShaderMaterial({vertexShader:VERTEX,fragmentShader:FRAGMENT,
      defines:{[kind.toUpperCase()]:''},uniforms:{uTime:{value:0},uReveal:{value:kind==='burn'?0:1},uCracks:{value:cracks.segments},
        uCrackCount:{value:cracks.count},uCells:{value:fractureUniforms()}},transparent:true,depthWrite:false,
      side:DoubleSide,blending:kind==='burn'?AdditiveBlending:NormalBlending,toneMapped:false});
    const ember=kind==='burn',count=ember?42:21;
    const particles=kind==='frost'||ember?new ShaderMaterial({vertexShader:PARTICLE_VERTEX,fragmentShader:PARTICLE_FRAGMENT,
      defines:ember?{EMBER:''}:{},uniforms:{uTime:{value:0},uPixelRatio:{value:1}},transparent:true,depthWrite:false,
      blending:ember?AdditiveBlending:NormalBlending,toneMapped:false}):null;
    const positions=new Float32Array(count*3),seeds=new Float32Array(count);
    for(let i=0;i<count;i++){
      if(ember){const seam=cracks.segments[i*7%cracks.count]!,t=(i*13%41)/41;
        positions[i*3]=(seam.x+(seam.z-seam.x)*t)*CARD_DIMENSIONS.width;
        positions[i*3+1]=(seam.y+(seam.w-seam.y)*t)*CARD_DIMENSIONS.width;
      }else{positions[i*3]=(Math.random()-.5)*CARD_DIMENSIONS.width*.94;
        positions[i*3+1]=(Math.random()-.5)*CARD_DIMENSIONS.height*.94;}
      seeds[i]=(i+.5)/count;
    }
    return {material,particles,positions,seeds};
  },[kind]);
  useFrame(({gl},delta)=>{
    const step=Math.min(delta,.05)/ANIMATION_DURATION_SCALE;
    assets.material.uniforms['uTime']!.value+=step;
    if(kind==='burn'){
      assets.material.uniforms['uReveal']!.value=Math.min(1,assets.material.uniforms['uReveal']!.value+step/.18);
    }
    if(assets.particles){assets.particles.uniforms['uTime']!.value+=step;assets.particles.uniforms['uPixelRatio']!.value=gl.getPixelRatio();}
  });
  useEffect(()=>()=>{assets.material.dispose();assets.particles?.dispose();},[assets]);
  return <group position={[0,0,CARD_FACE_OFFSET+.012+index*.002]}>
    <mesh material={assets.material} raycast={()=>{}} renderOrder={10+index}>
      <planeGeometry args={[CARD_DIMENSIONS.width,CARD_DIMENSIONS.height]}/>
    </mesh>
    {assets.particles&&<points material={assets.particles} raycast={()=>{}} renderOrder={17} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[assets.positions,3]}/>
        <bufferAttribute attach="attributes-aSeed" args={[assets.seeds,1]}/>
      </bufferGeometry>
    </points>}
  </group>;
}

export function AttackStatusOverlay({statuses}:{statuses:readonly AttackStatusKind[]}) {
  return <>{statuses.map((kind,index)=><StatusLayer key={kind} kind={kind} index={index}/>)}</>;
}
