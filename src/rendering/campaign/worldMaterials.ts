import { DoubleSide, MeshStandardMaterial, NormalBlending, ShaderMaterial, Vector2 } from 'three';
import { WORLD_EXPANSION, WORLD_SCALE } from './worldGeometry';
import { SEA_WAVE_HEIGHT } from './worldLayout';
import { mainlandPoint } from './worldPlacement';
import { DEMON_SITES } from './demonLayout';

export interface WorldClock { value: number }
const noise = `
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
float fbm(vec2 p){return noise2(p)*.57+noise2(p*2.03+4.1)*.28+noise2(p*4.11-2.7)*.15;}`;

/** A scene-local clock prevents environment motion from changing ability uniforms. */
export function flowMaterial(clock: WorldClock, mode: 0 | 1 | 2, sea=false): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {uTime: clock, uMode: {value: mode},uMapScale:{value:WORLD_SCALE},uMapExpansion:{value:WORLD_EXPANSION},
      uPitCenter:{value:new Vector2(...DEMON_SITES['2-4'].center)}},
    side: DoubleSide,
    transparent: mode === 0,
    depthWrite: mode !== 0,
    vertexShader: `uniform float uTime;uniform float uMode;uniform float uMapScale;uniform float uMapExpansion;varying vec2 vMap;
      ${sea?'attribute float aShore;varying float vShore;':''}
      void main(){${sea?'vShore=aShore;':''}vMap=(modelMatrix*vec4(position,1.0)).xz/(uMapScale*uMapExpansion);vec3 p=position;
        if(uMode<.5)p.y+=sin(p.x*3.0+uTime*.6)*cos(p.z*2.4-uTime*.4)*${SEA_WAVE_HEIGHT};
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
    fragmentShader: `uniform float uTime;uniform float uMode;uniform vec2 uPitCenter;varying vec2 vMap;${sea?'varying float vShore;':''}${noise}
      void main(){${sea?'if(vShore>.32)discard;':''}vec3 color;float alpha=1.0;
        if(uMode<.5){
          float n=fbm(vMap*2.3+vec2(uTime*.06,-uTime*.04));
          float wave=pow(.5+.5*sin(vMap.x*8.0+vMap.y*3.0+n*8.0-uTime*.6),10.0);
          color=mix(vec3(.045,.16,.20),vec3(.16,.35,.36),n);
          float foam=${sea?'smoothstep(-.28,-.08,vShore)*(1.0-smoothstep(.03,.22,vShore))*(.4+.6*n)':'0.0'};
          color+=vec3(.22,.34,.32)*wave*.32;
          color=mix(color,vec3(.48,.57,.53),foam*.38);alpha=.97;
        }else if(uMode<1.5){
          float n=fbm(vMap*4.0+vec2(uTime*.1,uTime*.07));
          float crust=smoothstep(.51,.7,n);
          color=mix(vec3(2.4,.48,.04),vec3(.21,.08,.055),crust);
          color+=vec3(.7,.19,.015)*pow(1.0-n,3.0)*(1.0+.12*sin(uTime*.8));
        }else{
          vec2 delta=vMap-uPitCenter;
          float d=length(delta),a=atan(delta.y,delta.x),n=fbm(vMap*3.0+uTime*.045);
          float vein=pow(.5+.5*sin(a*5.0-d*15.0+n*2.5-uTime*.8),8.0);
          color=mix(vec3(.015,.008,.025),vec3(.29,.12,.47),smoothstep(.1,.95,d)*n)+vec3(.45,.12,.72)*vein*smoothstep(.15,.6,d);
        }
        gl_FragColor=vec4(color,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Soft billboards with three moving noise layers; opaque overlaps hide the sealed regions. */
export function cloudMaterial(clock: WorldClock): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {uTime: clock}, transparent: true, depthWrite: false, side: DoubleSide, blending: NormalBlending,
    vertexShader: `attribute float aSeed;attribute float aOpacity;attribute vec3 aTint;
      uniform float uTime;varying vec2 vUv;varying float vSeed;varying float vOpacity;varying vec3 vTint;
      void main(){vUv=uv;vSeed=aSeed;vOpacity=aOpacity;vTint=aTint;
        vec4 center=instanceMatrix*vec4(0,0,0,1);
        center.x+=sin(uTime*.055+aSeed)*.14;center.z+=cos(uTime*.045+aSeed)*.1;
        vec4 view=modelViewMatrix*center;
        vec2 size=vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));
        size*=vec2(length(modelMatrix[0].xyz),length(modelMatrix[1].xyz));
        view.xy+=position.xy*size;
        gl_Position=projectionMatrix*view;}`,
    fragmentShader: `uniform float uTime;varying vec2 vUv;varying float vSeed;varying float vOpacity;varying vec3 vTint;${noise}
      void main(){vec2 p=(vUv-.5)*2.0;
        float n=fbm(vUv*4.7+vSeed+vec2(uTime*.018,-uTime*.012));
        float body=1.0-smoothstep(.2,.96,length(p)+(.5-n)*.22);
        float alpha=body*vOpacity*(.72+.28*n);
        if(alpha<.012)discard;
        vec3 tint=vTint*(.82+.2*n+.11*vUv.y);
        gl_FragColor=vec4(tint,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function sparkMaterial(clock: WorldClock): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {uTime: clock}, transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: `attribute vec3 color;attribute float aSeed;attribute float aKind;
      uniform float uTime;varying vec3 vColor;varying float vAlpha;
      void main(){float cycle=fract(aSeed+uTime*(aKind>.5?.05:.09));vec3 p=position;
        p.y+=cycle*(aKind>.5?1.0:.9);p.x+=sin(uTime*.3+aSeed*21.0)*.06;
        vec4 view=modelViewMatrix*vec4(p,1);vColor=color;vAlpha=sin(cycle*3.14159)*.65;
        gl_PointSize=clamp(500.0/max(1.0,-view.z),1.2,7.0);gl_Position=projectionMatrix*view;}`,
    fragmentShader: `varying vec3 vColor;varying float vAlpha;
      void main(){float d=length(gl_PointCoord-.5)*2.0;float a=(1.0-smoothstep(.1,1.0,d))*vAlpha;
        if(a<.01)discard;gl_FragColor=vec4(vColor,a);
        #include <colorspace_fragment>
      }`,
  });
}

/** Close-range relief grain and warm lava fissures are shaded on the physical surface. */
export function groundMaterial(clock:WorldClock):MeshStandardMaterial {
  const material=new MeshStandardMaterial({vertexColors:true,roughness:.91});
  material.onBeforeCompile=shader=>{
    shader.uniforms['uLandscapeTime']=clock;shader.uniforms['uLandscapeExpansion']={value:WORLD_EXPANSION};shader.uniforms['uLandscapeScale']={value:WORLD_SCALE};
    shader.uniforms['uVolcanoCenter']={value:new Vector2(...mainlandPoint('human',-7.75,4.05))};
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vLandscape;uniform float uLandscapeScale;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvLandscape=(modelMatrix*vec4(transformed,1.0)).xyz/uLandscapeScale;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform float uLandscapeTime;uniform float uLandscapeExpansion;uniform vec2 uVolcanoCenter;varying vec3 vLandscape;
      float landHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float landNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(landHash(i),landHash(i+vec2(1,0)),f.x),mix(landHash(i+vec2(0,1)),landHash(i+vec2(1)),f.x),f.y);}`)
      .replace('#include <color_fragment>',`#include <color_fragment>
        float grain=landNoise(vLandscape.xz*90.0)*.08+landNoise(vLandscape.xz*19.0)*.11;
        diffuseColor.rgb*=.89+grain;
        float strata=sin(vLandscape.y*24.0+landNoise(vLandscape.xz*4.0)*5.0)*.035;
        diffuseColor.rgb*=1.0+strata;`)
      .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
        float hotZone=1.0-smoothstep(2.05,3.25,length(vLandscape.xz/uLandscapeExpansion-uVolcanoCenter));
        float fissure=1.0-smoothstep(.012,.037,abs(landNoise(vLandscape.xz*5.5)-.5));
        float broken=smoothstep(.34,.7,landNoise(vLandscape.xz*1.8));
        totalEmissiveRadiance+=vec3(1.6,.27,.025)*fissure*broken*hotZone*(.85+.15*sin(uLandscapeTime*.8+vLandscape.x));`);
  };
  material.customProgramCacheKey=()=> 'campaign-continuous-terrain-detail-v3';return material;
}

export function grassMaterial(clock:WorldClock):MeshStandardMaterial {
  const material=new MeshStandardMaterial({color:'#ffffff',roughness:.96,side:DoubleSide});
  material.onBeforeCompile=shader=>{
    shader.uniforms['uMeadowTime']=clock;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float uMeadowTime;')
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        #ifdef USE_INSTANCING
          float phase=uMeadowTime*.7+instanceMatrix[3].x*.75+instanceMatrix[3].z*.43;
          transformed.x+=sin(phase)*position.y*position.y*.85;
          transformed.z+=cos(phase*.77)*position.y*position.y*.42;
        #endif`);
  };
  material.customProgramCacheKey=()=> 'campaign-meadow-wind-v1';return material;
}
