import { useEffect,useMemo } from 'react';
import { DoubleSide,MeshStandardMaterial,ShaderMaterial,Vector2 } from 'three';
import type { DemonGeometry } from './demonGeometry';
import { DEMON_SITES } from './demonLayout';
import { WORLD_EXPANSION } from './worldGeometry';
import type { WorldClock } from './worldMaterials';

const noHit=():void=>{};
function lightMaterial(clock:WorldClock):ShaderMaterial {
  return new ShaderMaterial({
    uniforms:{uTime:clock},transparent:true,depthWrite:false,side:DoubleSide,vertexColors:true,
    vertexShader:`attribute float aKind;varying vec3 vTint;varying vec2 vUv;varying float vKind;
      void main(){vTint=color;vUv=uv;vKind=aKind;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`uniform float uTime;varying vec3 vTint;varying vec2 vUv;varying float vKind;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      void main(){vec3 tint=vTint;float alpha=1.0;
        if(vKind>.5&&vKind<1.5){
          float horizon=.21+.035*sin(vUv.x*22.0)+.018*sin(vUv.x*53.0);
          float sky=smoothstep(horizon,horizon+.025,vUv.y);
          vec3 sunset=mix(vec3(1.75,.45,.12),vec3(.025,.09,.14),smoothstep(.24,.85,vUv.y));
          float sun=1.0-smoothstep(.055,.095,length((vUv-vec2(.66,.29))*vec2(.46,1.0)));
          tint=mix(vec3(.08,.045,.065),sunset,sky)+vec3(1.9,1.1,.38)*sun;
          float dust=step(.995,hash(floor(vUv*vec2(95.0,175.0))))*(.5+.5*sin(uTime*.8+vUv.y*31.0));
          tint+=vec3(.85,.4,.14)*dust;
        }else if(vKind>2.5){
          vec2 p=(vUv-.5)*2.0;float n=.77+.23*sin(p.x*8.0+sin(p.y*7.0)+uTime*.15);
          alpha=(1.0-smoothstep(.25,1.0,length(p)))*.34*n;
          tint*=.8;
        }else if(vKind>1.5){
          alpha=.55+.2*sin(vUv.y*28.0-uTime*.7);tint*=1.9;
        }else tint*=1.45+.12*sin(uTime*.9);
        gl_FragColor=vec4(tint,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
function abyssMaterial(clock:WorldClock):ShaderMaterial {
  const center=DEMON_SITES['2-4'].center;
  return new ShaderMaterial({
    uniforms:{uTime:clock,uCenter:{value:new Vector2(center[0]*WORLD_EXPANSION,center[1]*WORLD_EXPANSION)}},
    side:DoubleSide,vertexColors:true,
    vertexShader:`varying vec2 vMap;varying vec3 vTint;
      void main(){vMap=position.xz;vTint=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`uniform float uTime;uniform vec2 uCenter;varying vec2 vMap;varying vec3 vTint;
      void main(){vec2 p=vMap-uCenter;float a=atan(p.y,p.x),r=length(p);
        float swirl=.5+.5*sin(a*5.0-r*6.8+uTime*.7);
        vec3 tint=vTint*(.65+1.2*pow(swirl,3.0));gl_FragColor=vec4(tint,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Geometry ownership stays with useWorldBuild; only these scene-local materials are disposed here. */
export function DemonLandmarks({geometry,clock}:{readonly geometry:DemonGeometry;readonly clock:WorldClock}){
  const materials=useMemo(()=>({
    stone:new MeshStandardMaterial({vertexColors:true,roughness:.94,flatShading:true}),
    trim:new MeshStandardMaterial({vertexColors:true,roughness:.55,metalness:.42}),
    glow:lightMaterial(clock),abyss:abyssMaterial(clock),
  }),[clock]);
  useEffect(()=>()=>{for(const material of Object.values(materials))material.dispose();},[materials]);
  return <group dispose={null}>
    <mesh geometry={geometry.stone} material={materials.stone} castShadow receiveShadow raycast={noHit}/>
    <mesh geometry={geometry.trim} material={materials.trim} receiveShadow raycast={noHit}/>
    <mesh geometry={geometry.glow} material={materials.glow} raycast={noHit}/>
    <mesh geometry={geometry.abyss} material={materials.abyss} raycast={noHit}/>
  </group>;
}
