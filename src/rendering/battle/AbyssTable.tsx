import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending, BackSide, BoxGeometry, Color, DataTexture, DoubleSide, Euler, IcosahedronGeometry,
  LineBasicMaterial, Matrix4, MeshBasicMaterial, Quaternion, RGBAFormat, ShaderMaterial, SphereGeometry,
  UniformsLib, UniformsUtils, Vector3, type BufferGeometry, type Group, type InstancedMesh, type Material, type PointLight,
} from 'three';
import { backgroundUrl } from '../../data/assets';
import { useManagedTexture } from '../../services/useManagedTexture';
import { ABYSS_LIGHTNING_INTERVAL_MS, abyssFlashIntensity } from '../../scenes/abyssPresentation';
import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import { buildMaterial } from '../table/materials';
import type { TableTheme } from '../table/themes';
import {
  abyssFragments, arenaRandom, makeAbyssDeck, makeAbyssFunnel, makeAbyssLightning, makeAbyssRift,
  makeAbyssRim, makeAbyssRunes, makeAbyssSouls, makeAbyssTrim, type AbyssFragment,
} from '../abyss/abyssArenaGeometry';
import {
  ABYSS_FUNNEL_FRAGMENT, ABYSS_RIFT_FRAGMENT, ABYSS_SKY_FRAGMENT, ABYSS_SOUL_FRAGMENT,
  ABYSS_SOUL_VERTEX, ABYSS_SURFACE_VERTEX,
} from '../abyss/abyssArenaShaders';
import { LAYOUT } from './layout';

const noHit = (): void => {};
type ArenaClock = Readonly<{ current: number }>;

function shader(fragmentShader: string, fallback: DataTexture, transparent: boolean, sky = false): ShaderMaterial {
  return new ShaderMaterial({ vertexShader: ABYSS_SURFACE_VERTEX, fragmentShader, transparent,
    side: sky ? BackSide : DoubleSide, depthWrite: !transparent, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uHasBackground: { value: 0 }, uBackground: { value: fallback } },
  });
}

function FragmentField({ geometry, material, fragments, clock }: {
  readonly geometry: BufferGeometry; readonly material: Material; readonly fragments: readonly AbyssFragment[]; readonly clock: ArenaClock;
}) {
  const mesh = useRef<InstancedMesh>(null);
  const previousTime = useRef(-1);
  const scratch = useMemo(() => ({ matrix: new Matrix4(), position: new Vector3(), scale: new Vector3(),
    rotation: new Euler(), quaternion: new Quaternion(), color: new Color() }), []);
  const args = useMemo<[BufferGeometry, Material, number]>(() => [geometry, material, fragments.length], [geometry, material, fragments.length]);
  const write = (fragment: AbyssFragment, index: number, time = 0) => {
    const { matrix, position, scale, rotation, quaternion } = scratch;
    const moving = index >= 56 && index % 9 === 0;
    position.set(...fragment.position);
    if (moving) position.y += Math.sin(time*.17+index)*.4;
    scale.set(...fragment.scale); rotation.set(...fragment.rotation);
    if (moving) { rotation.y += time*.008*(index%2?1:-1); rotation.z += Math.sin(time*.08+index)*.025; }
    quaternion.setFromEuler(rotation); matrix.compose(position,quaternion,scale); mesh.current?.setMatrixAt(index,matrix);
  };
  useLayoutEffect(() => {
    if (!mesh.current) return;
    previousTime.current = -1;
    fragments.forEach((fragment,index) => { write(fragment,index); mesh.current!.setColorAt(index,scratch.color.setHex(fragment.shade)); });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [args, fragments, scratch]);
  useFrame(() => {
    if (!mesh.current || previousTime.current === clock.current) return;
    previousTime.current = clock.current;
    for (let i=63;i<fragments.length;i+=9) write(fragments[i]!,i,clock.current);
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={args} dispose={null} castShadow receiveShadow frustumCulled={false} raycast={noHit} />;
}

/** The table surface stays at y=0; the chasm, funnels and ruins extend beneath the playable rows. */
export function AbyssTable({ theme, reduceMotion }: { readonly theme: TableTheme; readonly reduceMotion: boolean }) {
  const background = useManagedTexture(backgroundUrl('bg/activity_abyss_bg2'));
  const elapsed = useRef(0);
  const clock = useRef(0);
  const boltGroups = useRef<(Group | null)[]>([]);
  const flashLight = useRef<PointLight>(null);
  const resources = useMemo(() => {
    const fallback = new DataTexture(new Uint8Array([18,8,32,255]),1,1,RGBAFormat); fallback.needsUpdate = true;
    const funnel = shader(ABYSS_FUNNEL_FRAGMENT,fallback,true);
    const sky = shader(ABYSS_SKY_FRAGMENT,fallback,false,true);
    const rift = shader(ABYSS_RIFT_FRAGMENT,fallback,false);
    rift.fog = true; rift.uniforms = { ...UniformsUtils.clone(UniformsLib.fog), ...rift.uniforms };
    const souls = new ShaderMaterial({ vertexShader: ABYSS_SOUL_VERTEX, fragmentShader: ABYSS_SOUL_FRAGMENT,
      transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } } });
    const stone = buildMaterial(theme.mat.light,{quality:'high'});
    const rock = buildMaterial(theme.mat.dark,{quality:'high'});
    rock.flatShading = true;
    const metal = buildMaterial(theme.mat.frame,{quality:'high'});
    const rune = new LineBasicMaterial({color:new Color(3,1.7,4.6),transparent:true,opacity:.55,toneMapped:false});
    const trim = new MeshBasicMaterial({color:0x6b498f,transparent:true,opacity:.75,toneMapped:false});
    const core = new MeshBasicMaterial({color:new Color(3.1,2.05,3.8),transparent:true,opacity:0,toneMapped:false,depthWrite:false});
    const halo = new MeshBasicMaterial({color:0x8d5fe4,transparent:true,opacity:0,blending:AdditiveBlending,toneMapped:false,depthWrite:false});
    const geometries = {
      deck:makeAbyssDeck(),rim:makeAbyssRim(),trim:makeAbyssTrim(),rift:makeAbyssRift(),
      funnel:makeAbyssFunnel(),sky:new SphereGeometry(140,96,64),runes:makeAbyssRunes(),souls:makeAbyssSouls(),
      rock:new IcosahedronGeometry(1,1),box:new BoxGeometry(1,1,1),bolts:Array.from({length:6},(_,i)=>makeAbyssLightning(i)),
      boltHalos:Array.from({length:6},(_,i)=>makeAbyssLightning(i,3.4)),
    };
    return { fallback, shaders:{funnel,sky,rift,souls}, materials:{stone,rock,metal,rune,trim,core,halo}, geometries, fragments:abyssFragments() };
  }, [theme]);
  useEffect(() => () => {
    resources.fallback.dispose(); Object.values(resources.shaders).forEach(material=>material.dispose());
    Object.values(resources.materials).forEach(material=>material.dispose());
    const {bolts,boltHalos,...geometries}=resources.geometries; Object.values(geometries).forEach(geometry=>geometry.dispose());
    bolts.forEach(geometry=>geometry.dispose()); boltHalos.forEach(geometry=>geometry.dispose());
  }, [resources]);
  useEffect(() => {
    for (const material of [resources.shaders.sky,resources.shaders.funnel]) {
      material.uniforms.uBackground!.value=background??resources.fallback;
      material.uniforms.uHasBackground!.value=background?1:0;
    }
  }, [background,resources]);
  useFrame(({gl},delta) => {
    if (!reduceMotion && !document.hidden) elapsed.current += Math.min(delta,.1);
    clock.current=elapsed.current/ANIMATION_DURATION_SCALE;
    const milliseconds=elapsed.current*1000;
    const flash=reduceMotion||document.hidden?0:abyssFlashIntensity(milliseconds%ABYSS_LIGHTNING_INTERVAL_MS-3500);
    for (const material of [resources.shaders.sky,resources.shaders.funnel,resources.shaders.rift]) {
      material.uniforms.uTime!.value=clock.current;material.uniforms.uFlash!.value=flash;
    }
    resources.shaders.souls.uniforms.uTime!.value=clock.current;
    resources.shaders.souls.uniforms.uPixelRatio!.value=gl.getPixelRatio();
    resources.materials.rune.opacity=.48+Math.sin(clock.current*.48)*.12;
    resources.materials.core.opacity=flash*.95;resources.materials.halo.opacity=flash*.16;
    const selected=Math.floor(milliseconds/ABYSS_LIGHTNING_INTERVAL_MS)%6;
    boltGroups.current.forEach((group,index)=>{if(group)group.visible=flash>.004&&index===selected;});
    if(flashLight.current){
      const angle=selected/6*Math.PI*2+.25;
      flashLight.current.position.set(Math.cos(angle)*22,7,Math.sin(angle)*22);
      flashLight.current.intensity=flash*38;
    }
  });
  const {geometries:g,materials:m,shaders:s}=resources;
  return <group position={[0,0,LAYOUT.tableCenterZ]} dispose={null}>
    <mesh geometry={g.sky} material={s.sky} renderOrder={-50} frustumCulled={false} raycast={noHit} />
    <mesh geometry={g.funnel} material={s.funnel} renderOrder={-30} raycast={noHit} />
    <mesh geometry={g.funnel} material={s.funnel} scale={[.74,.84,.74]} position={[0,-5.4,0]} rotation={[0,.74,0]} renderOrder={-29} raycast={noHit} />
    <mesh geometry={g.deck} material={m.stone} castShadow receiveShadow raycast={noHit} />
    <mesh geometry={g.rim} material={m.metal} castShadow receiveShadow raycast={noHit} />
    <mesh geometry={g.trim} material={m.trim} raycast={noHit} />
    <mesh geometry={g.rift} material={s.rift} raycast={noHit} />
    <lineSegments geometry={g.runes} material={m.rune} raycast={noHit} />
    <FragmentField geometry={g.rock} material={m.rock} fragments={resources.fragments} clock={clock} />
    {/* Buried portal ruins are below the card plane and cannot cover the players' rows. */}
    {Array.from({length:4},(_,index)=>{
      const angle=index*Math.PI/2+.42,radius=26+index*2;
      return <group key={index} position={[Math.cos(angle)*radius,-9.5-index*.5,Math.sin(angle)*radius]} rotation={[0,-angle-Math.PI/2,0]}>
        {[-1,1].map(side=><mesh key={side} geometry={g.box} material={m.rock} position={[side*3.6,-1,0]}
          scale={[1.45,13+side*.8,2.15]} rotation={[0,0,side*.035]} castShadow receiveShadow raycast={noHit} />)}
        <mesh geometry={g.box} material={m.metal} position={[0,5.1,0]} scale={[9,1.7,2.4]} castShadow receiveShadow raycast={noHit} />
        <mesh geometry={g.box} material={m.trim} position={[0,4.4,1.23]} scale={[6.2,.045,.015]} raycast={noHit} />
        {Array.from({length:5},(_,rune)=><mesh key={rune} geometry={g.box} material={m.trim}
          position={[-2.2+rune*1.1,5.05,1.23]} scale={[.065,.48+arenaRandom(rune,index)*.2,.02]} rotation={[0,0,.35]} raycast={noHit} />)}
      </group>;
    })}
    {g.bolts.map((geometry,index)=><group key={index} ref={group=>{boltGroups.current[index]=group;}} visible={false}>
      <mesh geometry={geometry} material={m.core} raycast={noHit} />
      <mesh geometry={g.boltHalos[index]!} material={m.halo} raycast={noHit} />
    </group>)}
    <points geometry={g.souls} material={s.souls} frustumCulled={false} raycast={noHit} />
    <pointLight ref={flashLight} color={0xd8baff} intensity={0} distance={65} decay={2} />
    <pointLight position={[-5,-1.3,0]} color={0x945cff} intensity={12} distance={13} decay={2} />
    <pointLight position={[5,-1.3,0]} color={0xb967ec} intensity={10} distance={13} decay={2} />
  </group>;
}
