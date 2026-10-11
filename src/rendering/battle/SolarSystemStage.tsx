import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending, BackSide, BufferGeometry, Color, DoubleSide, Float32BufferAttribute,
  IcosahedronGeometry, Matrix4, MeshBasicMaterial, RingGeometry, ShaderMaterial, SphereGeometry, Vector3,
  type Group, type InstancedMesh, type Mesh,
} from 'three';
import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import type { QualityLevel } from '../table/materials';
import type { TableTheme } from '../table/themes';
import { LAYOUT } from './layout';

type Clock=Readonly<{current:number}>;
interface PlanetSpec {readonly kind:number;readonly orbit:number;readonly radius:number;readonly angle:number;readonly speed:number}
const SUN_POSITION:readonly [number,number,number]=[-16,0,-12],SUN_RADIUS=5.4;
// Display proportions, rather than real astronomical scale. The whole card board fits between Earth and Mars.
const PLANETS:readonly PlanetSpec[]=[
  {kind:0,orbit:6.9,radius:.31,angle:-.75,speed:.021},
  {kind:1,orbit:8.7,radius:.81,angle:.45,speed:.014},
  {kind:2,orbit:10.6,radius:.86,angle:-.4,speed:.011},
  {kind:3,orbit:30,radius:.46,angle:-.16,speed:.008},
  {kind:4,orbit:43,radius:2.8,angle:-1.18,speed:.0045},
  {kind:5,orbit:55,radius:2.3,angle:-.8,speed:.0035},
  {kind:6,orbit:67,radius:1.25,angle:-1.7,speed:.0027},
  {kind:7,orbit:78,radius:1.2,angle:-1.2,speed:.0022},
];
const noHit=():void=>{};
function randomAt(i:number,j=0):number{const n=Math.sin(i*127.1+j*311.7+83.9)*43758.5453;return n-Math.floor(n);}
const NOISE=`
  float hash3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
  float noise3(vec3 p){
    vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  float fbm3(vec3 p){return noise3(p)*.57+noise3(p*2.03)*.28+noise3(p*4.13)*.15;}
`;
function planetMaterial(kind:number):ShaderMaterial{
  return new ShaderMaterial({fog:false,toneMapped:false,uniforms:{uKind:{value:kind},uTime:{value:0}},
    vertexShader:'varying vec3 vLocal;void main(){vLocal=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`
      uniform float uKind,uTime;varying vec3 vLocal;
      ${NOISE}
      void main(){
        vec3 p=normalize(vLocal);float n=fbm3(p*5.2);vec3 color;
        if(uKind<.5){color=mix(vec3(.23,.23,.22),vec3(.51,.47,.40),smoothstep(.3,.72,n));}
        else if(uKind<1.5){color=mix(vec3(.54,.34,.12),vec3(.87,.69,.35),fbm3(p*3.0+vec3(uTime*.012)));}
        else if(uKind<2.5){
          float land=smoothstep(.48,.57,fbm3(p*3.8));
          color=mix(vec3(.035,.19,.53),mix(vec3(.13,.40,.20),vec3(.40,.49,.25),n),land);
          float ice=smoothstep(.83,.96,abs(p.y));color=mix(color,vec3(.76,.84,.86),ice);
          float clouds=smoothstep(.66,.79,fbm3(p*6.3+vec3(uTime*.018,0.0,0.0)));color=mix(color,vec3(.84,.88,.86),clouds*.58);
        }
        else if(uKind<3.5){color=mix(vec3(.43,.14,.08),vec3(.77,.37,.18),n);color=mix(color,vec3(.74,.66,.55),smoothstep(.88,.98,abs(p.y)));}
        else if(uKind<4.5){
          float bands=.5+.5*sin(p.y*31.0+fbm3(p*7.0)*3.8);color=mix(vec3(.57,.32,.18),vec3(.88,.76,.58),bands);
          float storm=exp(-length((p.xy-vec2(.28,-.22))*vec2(8.0,16.0)));color=mix(color,vec3(.64,.23,.13),storm*.7);
        }
        else if(uKind<5.5){color=mix(vec3(.62,.53,.32),vec3(.86,.78,.56),.5+.5*sin(p.y*26.0+fbm3(p*4.0)*1.8));}
        else if(uKind<6.5){color=mix(vec3(.16,.51,.61),vec3(.48,.78,.80),n);}
        else{color=mix(vec3(.025,.13,.49),vec3(.10,.37,.76),n);}
        // No directional light, surface normal or camera-facing brightness term.
        gl_FragColor=vec4(color,1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

function Planet({spec,geometry,clock,ring}:{readonly spec:PlanetSpec;readonly geometry:SphereGeometry;readonly clock:Clock;readonly ring:RingGeometry}){
  const root=useRef<Group>(null),body=useRef<Mesh>(null);
  const material=useMemo(()=>planetMaterial(spec.kind),[spec.kind]);
  useEffect(()=>()=>material.dispose(),[material]);
  useFrame(()=>{
    const t=clock.current,angle=spec.angle+t*spec.speed;
    root.current?.position.set(Math.cos(angle)*spec.orbit,0,Math.sin(angle)*spec.orbit);
    if(body.current)body.current.rotation.y=t*.025;
    material.uniforms['uTime']!.value=t;
  });
  return <group ref={root} position={[Math.cos(spec.angle)*spec.orbit,0,Math.sin(spec.angle)*spec.orbit]} scale={spec.radius}>
    <mesh ref={body} geometry={geometry} material={material} dispose={null} raycast={noHit}/>
    {spec.kind===5 && <mesh geometry={ring} rotation={[-Math.PI/2+.34,0,.14]} raycast={noHit}>
      <meshBasicMaterial color={0xbaa685} side={DoubleSide} transparent opacity={.65} depthWrite={false} fog={false} toneMapped={false}/>
    </mesh>}
  </group>;
}

function Sun({geometry,clock}:{readonly geometry:SphereGeometry;readonly clock:Clock}){
  const halo=useRef<Mesh>(null),body=useRef<Mesh>(null),surface=useRef<ShaderMaterial>(null),glow=useRef<ShaderMaterial>(null);
  const uniforms=useMemo(()=>({uTime:{value:0}}),[]);
  useFrame(({camera})=>{
    halo.current?.quaternion.copy(camera.quaternion);
    if(body.current)body.current.rotation.y=clock.current*.017;
    if(surface.current)surface.current.uniforms['uTime']!.value=clock.current;
    if(glow.current)glow.current.uniforms['uTime']!.value=clock.current;
  });
  return <>
    <mesh ref={body} geometry={geometry} scale={SUN_RADIUS} raycast={noHit}>
      <shaderMaterial ref={surface} uniforms={uniforms} toneMapped={false} fog={false}
        vertexShader='varying vec3 vLocal;void main(){vLocal=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}'
        fragmentShader={`
          uniform float uTime;varying vec3 vLocal;
          ${NOISE}
          void main(){
            float cells=fbm3(vLocal*9.0+vec3(uTime*.04,0.0,-uTime*.03));
            float fine=noise3(vLocal*51.0+uTime*.11);
            vec3 color=mix(vec3(1.5,.24,.035),vec3(2.7,1.35,.30),smoothstep(.25,.8,cells));
            color+=vec3(.35,.26,.08)*fine;
            gl_FragColor=vec4(color,1.0);
            #include <colorspace_fragment>
          }
        `}/>
    </mesh>
    <mesh ref={halo} raycast={noHit}>
      <planeGeometry args={[SUN_RADIUS*6,SUN_RADIUS*6]}/>
      <shaderMaterial ref={glow} uniforms={uniforms} transparent blending={AdditiveBlending} depthWrite={false} toneMapped={false} fog={false}
        vertexShader='varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}'
        fragmentShader={`
          uniform float uTime;varying vec2 vUv;
          void main(){
            vec2 p=(vUv-.5)*3.0;float radius=length(p),angle=atan(p.y,p.x);
            float corona=exp(-abs(radius-.52)*13.0)*(.25+.10*sin(angle*19.0+uTime*.19));
            float glow=exp(-radius*radius*5.7)*.24;
            gl_FragColor=vec4(vec3(1.0,.48,.12),corona+glow);
            #include <colorspace_fragment>
          }
        `}/>
    </mesh>
  </>;
}

function Stars({quality,clock,background}:{readonly quality:QualityLevel;readonly clock:Clock;readonly background:number}){
  const root=useRef<Group>(null),stars=useRef<ShaderMaterial>(null);
  const uniforms=useMemo(()=>({uTime:{value:0},uDpr:{value:1}}),[]);
  const skyUniforms=useMemo(()=>({uBase:{value:new Color(background)}}),[background]);
  const geometry=useMemo(()=>{
    const count=quality==='high'?2600:quality==='medium'?1700:850,positions:number[]=[],sizes:number[]=[],phases:number[]=[];
    for(let i=0;i<count;i++){
      const phi=Math.acos(randomAt(i,5)*2-1),theta=randomAt(i,9)*Math.PI*2,r=98+randomAt(i,13)*43;
      positions.push(r*Math.sin(phi)*Math.cos(theta),r*Math.cos(phi),r*Math.sin(phi)*Math.sin(theta));
      sizes.push(.7+randomAt(i,17)*1.6);phases.push(randomAt(i,21)*Math.PI*2);
    }
    return new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3))
      .setAttribute('aSize',new Float32BufferAttribute(sizes,1)).setAttribute('aPhase',new Float32BufferAttribute(phases,1));
  },[quality]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  useFrame(({camera,gl})=>{
    root.current?.position.copy(camera.position);
    if(stars.current){stars.current.uniforms['uTime']!.value=clock.current;stars.current.uniforms['uDpr']!.value=gl.getPixelRatio();}
  });
  return <group ref={root}>
    <mesh renderOrder={-20} frustumCulled={false} raycast={noHit}>
      <sphereGeometry args={[155,32,20]}/>
      <shaderMaterial uniforms={skyUniforms} side={BackSide} depthWrite={false} toneMapped={false} fog={false}
        vertexShader={`
          varying float vCloud,vBand;
          ${NOISE}
          void main(){
            vec3 direction=normalize(position);
            vCloud=pow(fbm3(direction*5.0),3.0);
            vBand=exp(-abs(direction.y*.7+direction.x*.22+.16)*7.0);
            gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
          }
        `}
        fragmentShader={`
          uniform vec3 uBase;varying float vCloud,vBand;
          void main(){
            gl_FragColor=vec4(uBase+vCloud*vBand*vec3(.022,.028,.049),1.0);
            #include <colorspace_fragment>
          }
        `}/>
    </mesh>
    <points geometry={geometry} frustumCulled={false} raycast={noHit}>
      <shaderMaterial ref={stars} uniforms={uniforms} transparent blending={AdditiveBlending} depthWrite={false} toneMapped={false} fog={false}
        vertexShader={`
          uniform float uTime,uDpr;attribute float aSize,aPhase;varying float vLight,vWarm;
          void main(){
            vLight=.55+.25*sin(uTime*.38+aPhase);vWarm=step(5.0,aPhase);
            gl_PointSize=aSize*uDpr;
            gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
          }
        `}
        fragmentShader={`
          varying float vLight,vWarm;
          void main(){
            float radius=length(gl_PointCoord-.5);if(radius>.5)discard;
            gl_FragColor=vec4(mix(vec3(.62,.76,1.0),vec3(1.0,.83,.63),vWarm),(1.0-smoothstep(.06,.5,radius))*vLight);
            #include <colorspace_fragment>
          }
        `}/>
    </points>
  </group>;
}

function AsteroidBelt({quality,clock}:{readonly quality:QualityLevel;readonly clock:Clock}){
  const root=useRef<Group>(null),mesh=useRef<InstancedMesh>(null);
  const count=quality==='high'?1450:quality==='medium'?850:380;
  const geometry=useMemo(()=>new IcosahedronGeometry(1,0),[]);
  const material=useMemo(()=>new MeshBasicMaterial({color:0xffffff,fog:false,toneMapped:false}),[]);
  const args=useMemo<[BufferGeometry,MeshBasicMaterial,number]>(()=>[geometry,material,count],[geometry,material,count]);
  useLayoutEffect(()=>{
    if(!mesh.current)return;const matrix=new Matrix4(),scale=new Vector3(),color=new Color();
    for(let i=0;i<count;i++){
      const angle=randomAt(i,31)*Math.PI*2,radius=33+randomAt(i,37)*3.1,size=.065+randomAt(i,41)*.20;
      matrix.makeRotationY(randomAt(i,43)*Math.PI*2);matrix.scale(scale.set(size,size*(.55+randomAt(i,47)*.5),size*(.7+randomAt(i,51)*.6)));
      matrix.setPosition(Math.cos(angle)*radius,(randomAt(i,53)-.5)*.65,Math.sin(angle)*radius);
      mesh.current.setMatrixAt(i,matrix);mesh.current.setColorAt(i,color.setHex([0x6b665a,0x8c8070,0x4f5457,0x777b7c][i%4]!));
    }
    mesh.current.instanceMatrix.needsUpdate=true;if(mesh.current.instanceColor)mesh.current.instanceColor.needsUpdate=true;mesh.current.computeBoundingSphere();
  },[args,count]);
  useFrame(()=>{if(root.current)root.current.rotation.y=clock.current*.004;});
  useEffect(()=>()=>geometry.dispose(),[geometry]);useEffect(()=>()=>material.dispose(),[material]);
  return <group ref={root}><instancedMesh ref={mesh} args={args} dispose={null} raycast={noHit}/></group>;
}

export function SolarSystemStage({theme,quality,reduceMotion}:{readonly theme:TableTheme;readonly quality:QualityLevel;readonly reduceMotion:boolean}){
  const clock=useRef(0);
  const geometry=useMemo(()=>({sphere:new SphereGeometry(1,quality==='high'?48:quality==='medium'?32:20,quality==='high'?32:quality==='medium'?24:16),
    saturn:new RingGeometry(1.28,1.95,quality==='low'?48:96)}),[quality]);
  useEffect(()=>()=>{Object.values(geometry).forEach(item=>item.dispose());},[geometry]);
  useFrame((_,delta)=>{if(!reduceMotion)clock.current+=Math.min(delta,.05)/ANIMATION_DURATION_SCALE;});
  return <>
    <Stars quality={quality} clock={clock} background={theme.background}/>
    <group position={[0,0,LAYOUT.tableCenterZ]}>
      <group position={SUN_POSITION}>
        <Sun geometry={geometry.sphere} clock={clock}/>
        {PLANETS.map(planet=><group key={planet.kind}>
          <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.02,0]} raycast={noHit}>
            <ringGeometry args={[planet.orbit-.028,planet.orbit+.028,quality==='low'?128:224]}/>
            <meshBasicMaterial color={planet.kind===2?0x43758b:planet.kind===3?0x775f55:0x405666}
              transparent opacity={.32} depthWrite={false} side={DoubleSide} fog={false} toneMapped={false}/>
          </mesh>
          <Planet spec={planet} geometry={geometry.sphere} ring={geometry.saturn} clock={clock}/>
        </group>)}
        <AsteroidBelt quality={quality} clock={clock}/>
      </group>
    </group>
  </>;
}
