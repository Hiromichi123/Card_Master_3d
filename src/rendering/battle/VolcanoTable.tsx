import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  CircleGeometry, Color, CylinderGeometry, Euler, ExtrudeGeometry, IcosahedronGeometry,
  Matrix4, Path, Quaternion, ShaderMaterial, Shape, ShapeGeometry, UniformsLib, UniformsUtils, Vector3,
  type BufferGeometry, type InstancedMesh, type Material, type PointLight,
} from 'three';
import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import { buildMaterial, type QualityLevel } from '../table/materials';
import type { TableTheme } from '../table/themes';
import { WeatherLayer } from '../table/weather';
import {
  BATTLE_CARD_SCALE, CARD_SIZE, LAYOUT, PILE_CARD_SCALE, PREP_CARD_SCALE, buildSlots,
} from './layout';

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];
type Clock = Readonly<{ current: number }>;
interface Props { readonly theme: TableTheme; readonly quality: QualityLevel; readonly reduceMotion: boolean }
interface Instance { readonly position: Vec3; readonly scale: Vec3; readonly rotation?: Vec3; readonly shade?: number }
const noHit = (): void => {};
const OUTER_RADIUS = 8.8, DECK_RADIUS = 8.05, TERRAIN_RADIUS = 32, BEDROCK_TOP = -13;
const SQRT3 = Math.sqrt(3);

function randomAt(a: number, b = 0): number {
  const value = Math.sin(a * 127.1 + b * 311.7 + 19.3) * 43758.5453;
  return value - Math.floor(value);
}
function outline(radius: number): Vec2[] {
  return Array.from({ length: 6 }, (_, i) => [Math.cos(i * Math.PI / 3) * radius, Math.sin(i * Math.PI / 3) * radius] as const);
}
function polygon(points: readonly Vec2[]): Shape {
  const shape = new Shape();
  points.forEach(([x,y], i) => { if (i === 0) shape.moveTo(x,y); else shape.lineTo(x,y); });
  shape.closePath(); return shape;
}
function hole(points: readonly Vec2[]): Path {
  const path = new Path();
  [...points].reverse().forEach(([x,y], i) => { if (i === 0) path.moveTo(x,y); else path.lineTo(x,y); });
  path.closePath(); return path;
}
function hexRing(outer: number, inner: number): Shape {
  const shape = polygon(outline(outer)); shape.holes.push(hole(outline(inner))); return shape;
}
function extrude(shape: Shape, thickness: number, top: number, bevel: number): ExtrudeGeometry {
  const geometry = new ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: bevel > 0, bevelSize: bevel,
    bevelThickness: bevel, bevelSegments: 2, curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, top - thickness - bevel, 0);
  // Frame material remains the original volcanic brushed metal; UVs span the full hexagon.
  const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  for (let i = 0; i < positions.count; i++) uv.setXY(i, positions.getX(i) / (OUTER_RADIUS * 2) + .5, positions.getZ(i) / (OUTER_RADIUS * 2) + .5);
  uv.needsUpdate = true;
  return geometry;
}

const LAVA_VERTEX = `
  varying vec2 vLocal;
  #include <fog_pars_vertex>
  void main() {
    vLocal = position.xy;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const NOISE = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0)),f.x),f.y);
  }
  float fbm(vec2 p) { return noise(p)*0.57+noise(p*2.03)*0.28+noise(p*4.11)*0.15; }
`;
function lavaMaterial(strength: number): ShaderMaterial {
  return new ShaderMaterial({
    fog: true, toneMapped: false, uniforms: UniformsUtils.merge([UniformsLib.fog, { uTime: { value: 0 }, uStrength: { value: strength } }]),
    vertexShader: LAVA_VERTEX,
    fragmentShader: `
      uniform float uTime, uStrength; varying vec2 vLocal;
      #include <fog_pars_fragment>
      ${NOISE}
      void main() {
        vec2 p = vLocal;
        float t = uTime;
        vec2 flow = vec2(t*0.21, -t*0.12);
        float warp = fbm(p*0.58+flow);
        float molten = fbm(p*1.62+vec2(warp*2.4,warp)-flow);
        float vein = 1.0-smoothstep(0.018,0.095,abs(sin(p.x*1.13+p.y*2.4+warp*6.8-t*0.65)));
        float heat = smoothstep(0.27,0.8,molten);
        vec3 color = mix(vec3(0.46,0.022,0.004),vec3(2.8,0.47,0.025),heat);
        color = mix(color,vec3(4.5,1.68,0.28),vein*(0.4+heat*0.6));
        float crust = smoothstep(0.68,0.84,fbm(p*3.7+flow*0.32));
        color = mix(color,vec3(0.11,0.022,0.007),crust*0.87);
        gl_FragColor = vec4(color*uStrength,1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

/** Decorative transforms and shades are deterministic and never consume battle randomness. */
function RockBatch({ geometry, material, instances, shadow = false }: {
  readonly geometry: BufferGeometry; readonly material: Material; readonly instances: readonly Instance[]; readonly shadow?: boolean;
}) {
  const mesh = useRef<InstancedMesh>(null);
  const args = useMemo<[BufferGeometry, Material, number]>(() => [geometry, material, instances.length], [geometry, material, instances.length]);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const matrix = new Matrix4(), position = new Vector3(), scale = new Vector3(), quaternion = new Quaternion(), euler = new Euler(), color = new Color();
    instances.forEach((instance, i) => {
      const angles: Vec3 = instance.rotation ?? [0,0,0];
      position.set(...instance.position); scale.set(...instance.scale); euler.set(...angles);
      quaternion.setFromEuler(euler); matrix.compose(position,quaternion,scale);
      mesh.current!.setMatrixAt(i,matrix);
      if (instance.shade !== undefined) mesh.current!.setColorAt(i,color.setHex(instance.shade));
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [instances,args]);
  return <instancedMesh ref={mesh} args={args} dispose={null} castShadow={shadow} receiveShadow raycast={noHit} />;
}

function BasaltField({ quality, geometry, material }: { readonly quality: QualityLevel; readonly geometry: BufferGeometry; readonly material: Material }) {
  const instances = useMemo(() => {
    const radius = quality === 'low' ? 1.9 : quality === 'medium' ? 1.5 : 1.25;
    const extent = Math.ceil(TERRAIN_RADIUS / (radius * 1.5));
    const shades = [0x17181b,0x25262a,0x323337,0x3d3e42,0x47484c,0x505156];
    const columns: Instance[] = [];
    for (let q=-extent;q<=extent;q++) for (let r=-extent;r<=extent;r++) {
      const x=radius*1.5*q, z=radius*SQRT3*(r+q*.5), distance=Math.hypot(x,z);
      if (distance < 9.3 + radius || distance > TERRAIN_RADIUS - radius) continue;
      const rolling=Math.sin(x*.18)*Math.cos(z*.21)*1.6;
      const top=-5.8+rolling+(randomAt(q,r)-.5)*4.0;
      const height=top-BEDROCK_TOP;
      columns.push({position:[x,BEDROCK_TOP+height*.5,z],scale:[radius*.975,height,radius*.975],shade:shades[Math.floor(randomAt(q+47,r-83)*shades.length)]!});
    }
    return columns;
  },[quality]);
  return <RockBatch geometry={geometry} material={material} instances={instances} />;
}

function rubbleInstances(quality: QualityLevel): Instance[] {
  const slots=buildSlots();
  const wanted=quality==='high'?120:quality==='medium'?80:42;
  const rocks:Instance[]=[];
  for(let i=0;i<1800 && rocks.length<wanted;i++) {
    const x=(randomAt(i,7)-.5)*15.8, z=(randomAt(i,13)-.5)*13.5;
    const size=.12+randomAt(i,21)*.22;
    if (Math.abs(z)+size>7.8*SQRT3/2 || Math.abs(x)+Math.abs(z)/SQRT3+size>7.8) continue;
    if (Math.abs(z)<.65 || (Math.abs(z)>5.35 && Math.abs(x)<5.15)) continue;
    if ([-2.775,-.925,.925,2.775].some(gap=>Math.abs(x-gap)<.25+size && Math.abs(z)<3.25)) continue;
    if(slots.some(slot=>{
      const cardScale=slot.zone==='battle'?BATTLE_CARD_SCALE:PREP_CARD_SCALE;
      return Math.abs(x-slot.position[0])<CARD_SIZE.width*cardScale*.5+size+.14
        && Math.abs(z-(slot.position[2]-LAYOUT.tableCenterZ))<CARD_SIZE.height*cardScale*.5+size+.14;
    })) continue;
    if(Math.abs(Math.abs(x)-4.72)<CARD_SIZE.width*PILE_CARD_SCALE*.5+size+.22 && Math.abs(Math.abs(z)-4)<CARD_SIZE.height*PILE_CARD_SCALE*.5+size+.22) continue;
    rocks.push({position:[x,.02+size*.26,z],scale:[size,size*(.28+randomAt(i,38)*.38),size*(.65+randomAt(i,42)*.6)],
      rotation:[randomAt(i,54)*.5,randomAt(i,61)*Math.PI,randomAt(i,72)*.5],shade:[0x242529,0x303136,0x3b3c40][i%3]!});
  }
  return rocks;
}

function LavaLight({ clock, x }: { readonly clock: Clock; readonly x: number }) {
  const light=useRef<PointLight>(null);
  useFrame(()=>{if(light.current)light.current.intensity=17+Math.sin(clock.current*1.8+x)*2.4;});
  return <pointLight ref={light} color={0xff701c} intensity={17} position={[x,.65,0]} distance={8} decay={2} />;
}

/** A recessed molten river between intact basalt card lanes, carried by a giant central column. */
export function VolcanoTable({ theme, quality, reduceMotion }: Props) {
  const clock=useRef(0);
  const materials=useMemo(() => ({
    frame:buildMaterial(theme.mat.frame,{quality}),
    crust:buildMaterial(theme.mat.dark,{quality}),
    basalt:buildMaterial({kind:'stone',color:0xffffff,roughness:.96,metalness:.02,envMapIntensity:.2},{quality}),
    support:buildMaterial({kind:'stone',color:0x292a2e,roughness:.95,metalness:.02,envMapIntensity:.2},{quality}),
    bedrock:buildMaterial({kind:'stone',color:0x151619,roughness:1,envMapIntensity:.14},{quality}),
    lava:lavaMaterial(1.1), deepLava:lavaMaterial(.46),
  }),[theme,quality]);
  const geometry=useMemo(() => {
    const crust=polygon(outline(DECK_RADIUS));
    const river:Vec2[]=[[-7.5,-.15],[-6.3,-.34],[-4.8,-.26],[-3.1,-.44],[-1.5,-.3],[0,-.4],[1.7,-.27],[3.3,-.43],[5.1,-.29],[6.6,-.36],[7.5,-.14],
      [7.5,.13],[6.4,.31],[4.8,.4],[3.2,.27],[1.4,.42],[-.2,.3],[-1.9,.43],[-3.6,.28],[-5.2,.41],[-6.6,.28],[-7.5,.12]];
    crust.holes.push(hole(river));
    for(const x of [-2.775,-.925,.925,2.775]) for(const side of [-1,1]) {
      // Distinct holes leave narrow stone bridges at the main river, with no overlapping triangulation.
      const branch:Vec2[]=[[x-.065,.59],[x-.09,1.2],[x-.055,1.9],[x-.075,2.7],[x-.03,3.03],
        [x+.035,3.03],[x+.075,2.7],[x+.055,1.9],[x+.09,1.2],[x+.065,.59]];
      const points=branch.map(([a,b])=>[a,b*side] as const);
      // Branch outline is clockwise for +Z, counterclockwise for -Z.
      crust.holes.push(hole(side>0?[...points].reverse():points));
    }
    return {
      crust:extrude(crust,.27,-.012,.014),
      frame:extrude(hexRing(OUTER_RADIUS,DECK_RADIUS+.055),.48,.035,.035),
      rim:new ShapeGeometry(hexRing(DECK_RADIUS+.028,DECK_RADIUS-.026)),
      lava:new ShapeGeometry(polygon(outline(DECK_RADIUS+.04))),
      field:new CircleGeometry(TERRAIN_RADIUS,64),
      column:new CylinderGeometry(1,1,1,6,1,false,Math.PI/6),
      rubble:new IcosahedronGeometry(1,0),
      bedrock:new CylinderGeometry(TERRAIN_RADIUS+.4,TERRAIN_RADIUS+1.2,1.7,quality==='low'?36:64),
    };
  },[quality]);
  const rubble=useMemo(()=>rubbleInstances(quality),[quality]);
  useEffect(()=>()=>{Object.values(materials).forEach(material=>material.dispose());},[materials]);
  useEffect(()=>()=>{Object.values(geometry).forEach(item=>item.dispose());},[geometry]);
  useFrame((_,delta)=>{
    if(!reduceMotion)clock.current+=Math.min(delta,.05)/ANIMATION_DURATION_SCALE;
    materials.lava.uniforms['uTime']!.value=clock.current;
    materials.deepLava.uniforms['uTime']!.value=clock.current;
  });
  return <group position={[0,0,LAYOUT.tableCenterZ]}>
    {/* Closed foundation fills the underside and gaps even from low orbit camera angles. */}
    <mesh geometry={geometry.bedrock} material={materials.bedrock} dispose={null} position={[0,BEDROCK_TOP-.85,0]} receiveShadow raycast={noHit} />
    <mesh geometry={geometry.field} material={materials.deepLava} dispose={null} rotation={[-Math.PI/2,0,0]} position={[0,BEDROCK_TOP+.035,0]} raycast={noHit} />
    <BasaltField quality={quality} geometry={geometry.column} material={materials.basalt} />
    <mesh geometry={geometry.column} material={materials.support} dispose={null} scale={[9.15,12.695,9.15]} position={[0,-6.6525,0]} receiveShadow castShadow raycast={noHit} />
    {[-2.6,-6.2,-9.8].map(y=><mesh key={y} geometry={geometry.column} material={materials.support} dispose={null}
      scale={[9.2,.12,9.2]} position={[0,y,0]} receiveShadow raycast={noHit} />)}
    <mesh geometry={geometry.lava} material={materials.lava} dispose={null} rotation={[-Math.PI/2,0,0]} position={[0,-.075,0]} raycast={noHit} />
    <mesh geometry={geometry.crust} material={materials.crust} dispose={null} receiveShadow castShadow raycast={noHit} />
    <mesh geometry={geometry.frame} material={materials.frame} dispose={null} receiveShadow castShadow raycast={noHit} />
    <mesh geometry={geometry.rim} material={materials.lava} dispose={null} rotation={[-Math.PI/2,0,0]} position={[0,.014,0]} raycast={noHit} />
    <RockBatch geometry={geometry.rubble} material={materials.basalt} instances={rubble} shadow />
    {(quality==='low'?[0]:quality==='medium'?[-3,3]:[-3.8,0,3.8]).map(x=><LavaLight key={x} clock={clock} x={x} />)}
    <group scale={[1.4,1,1.4]}><WeatherLayer themeId="volcano" quality={quality} reducedMotion={reduceMotion} /></group>
  </group>;
}
