import { CLOUD_SURFACE_Y, CLOUD_BODY_TOP } from './cloudSurfaceLayout';
import { cloudGuideGeometry } from './cloudGuideGeometry';
import { applyCloudShadows } from './cloudShadowMaterial';
import { CloudPalaces } from './CloudPalaces';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BackSide, CanvasTexture, Color, InstancedMesh, Matrix4, MeshStandardMaterial, ShaderMaterial, Shape, ShapeGeometry, SphereGeometry, SRGBColorSpace, UniformsLib, UniformsUtils, Vector2 } from 'three';
import type { TableTheme } from '../table/themes';
import type { QualityLevel } from '../table/materials';
import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import { LAYOUT } from './layout';

const noHit = (): void => {};
const random = (i: number, salt = 0): number => { const n = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return n - Math.floor(n); };
const SKY_VERTEX = `varying vec3 vDirection; void main(){vDirection=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const SKY_FRAGMENT = `uniform vec2 uResolution;varying vec3 vDirection;
void main(){
  vec2 screen=gl_FragCoord.xy/max(uResolution,vec2(1.));
  float sky=smoothstep(.40,.96,screen.y);
  vec3 color=mix(vec3(.95,.98,1.),vec3(.28,.56,.88),sky*.85);
  float haze=sin(vDirection.x*17.+vDirection.z*9.)*.5+.5;
  color=mix(color,vec3(1.),haze*.035*(1.-sky));
  vec2 sun=(screen-vec2(.18,.82))*vec2(uResolution.x/uResolution.y,1.);
  float halo=exp(-dot(sun,sun)*23.);
  float disc=exp(-dot(sun,sun)*3000.);
  float rays=exp(-abs(sun.x)*75.)*exp(-abs(sun.y)*7.)+exp(-abs(sun.y)*100.)*exp(-abs(sun.x)*10.);
  color=mix(color,vec3(1.,.94,.78),halo*.48);color+=vec3(1.,.91,.7)*(disc*.35+rays*.07);
  gl_FragColor=vec4(color,1.);
  #include <colorspace_fragment>
}`;
const CLOUD_VERTEX = `uniform bool uFlat; varying vec3 vNormal;varying vec3 vView;varying vec3 vCloudWorld;
#include <common>
#include <fog_pars_vertex>
void main(){vec4 local=vec4(position,1.);vec3 n=normal;
  #ifdef USE_INSTANCING
    local=instanceMatrix*local;n=mat3(instanceMatrix)*normal;
  #endif
  if(uFlat)local.y=min(local.y,${CLOUD_BODY_TOP});
  vCloudWorld=(modelMatrix*local).xyz;
  vec4 mvPosition=modelViewMatrix*local;vView=-mvPosition.xyz;vNormal=normalize(normalMatrix*n);
  gl_Position=projectionMatrix*mvPosition;
  #include <fog_vertex>
}`;
const CLOUD_FRAGMENT = `varying vec3 vNormal;varying vec3 vView;varying vec3 vCloudWorld;uniform vec2 uBoardCenter;
#include <common>
#include <fog_pars_fragment>
void main(){
  // Cloud decoration may drift in front of the camera, but must not paint over the board.
  vec3 ray=vCloudWorld-cameraPosition;
  if(cameraPosition.y>0.0 && abs(ray.y)>.0001){
    float t=(${CLOUD_SURFACE_Y}-cameraPosition.y)/ray.y;
    vec2 board=((cameraPosition+ray*t).xz-uBoardCenter)/vec2(8.05,7.15);
    if(t>1.0 && dot(board,board)<1.0)discard;
  }
  vec3 n=normalize(vNormal);float facing=max(0.,dot(n,normalize(vView)));
  float alpha=smoothstep(.015,.36,facing)*.9;
  vec3 color=mix(vec3(.79,.87,.94),vec3(1.),clamp(n.y*.35+.65,0.,1.));
  gl_FragColor=vec4(color,alpha);
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;
function cloudOutline(): Shape {
  const points = Array.from({ length: 24 }, (_, i) => { const a = i / 24 * Math.PI * 2, r = 1 + Math.sin(i * 2.6) * .048; return [Math.cos(a) * 8.1 * r, Math.sin(a) * 7.2 * r] as const; });
  const shape = new Shape(), last = points[23]!, first = points[0]!;
  shape.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
  points.forEach((p, i) => { const next = points[(i + 1) % points.length]!; shape.quadraticCurveTo(p[0], p[1], (p[0] + next[0]) / 2, (p[1] + next[1]) / 2); });
  shape.closePath(); return shape;
}
function cloudTexture(): CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f1f7fb'; ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 65; i++) { const x = random(i, 9) * 512, y = random(i, 17) * 512, r = 30 + random(i, 21) * 105;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r); gradient.addColorStop(0, '#ffffffa8'); gradient.addColorStop(1, '#ffffff00');
      ctx.fillStyle = gradient; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; return texture;
}
/** The flat summit belongs to the cloud itself: no separate tabletop, rim or tiled board. */
export function CloudTopTable({ theme, quality, reduceMotion }: { readonly theme: TableTheme; readonly quality: QualityLevel; readonly reduceMotion: boolean }) {
  const { gl, size } = useThree();
  const elapsed = useRef(0), base = useRef<InstancedMesh>(null), drift = useRef<InstancedMesh>(null);
  const count = quality === 'low' ? 12 : quality === 'high' ? 30 : 20;
  const built = useMemo(() => {
    const texture = cloudTexture(), top = new ShapeGeometry(cloudOutline(), 8); top.rotateX(-Math.PI / 2); top.translate(0, CLOUD_SURFACE_Y, 0);
    const p = top.getAttribute('position'), uv = top.getAttribute('uv');
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 17 + .5, p.getZ(i) / 15 + .5); uv.needsUpdate = true;
    const topMaterial = new MeshStandardMaterial({ color: 0xffffff, map: texture, roughness: .98, metalness: 0 });
    topMaterial.polygonOffset = true; topMaterial.polygonOffsetFactor = -2; topMaterial.polygonOffsetUnits = -2;
    const shadowTime = applyCloudShadows(topMaterial);
    return { texture, top, guides: cloudGuideGeometry(), shadowTime, sphere: new SphereGeometry(1, quality === 'low' ? 12 : 20, quality === 'low' ? 8 : 14), dome: new SphereGeometry(88, 32, 20),
      topMaterial,
      baseMaterial: new ShaderMaterial({ uniforms: UniformsUtils.merge([UniformsLib.fog, { uFlat: { value: true }, uBoardCenter: { value: new Vector2(0, LAYOUT.tableCenterZ) } }]), vertexShader: CLOUD_VERTEX, fragmentShader: CLOUD_FRAGMENT, transparent: true, depthWrite: false, fog: true }),
      driftMaterial: new ShaderMaterial({ uniforms: UniformsUtils.merge([UniformsLib.fog, { uFlat: { value: false }, uBoardCenter: { value: new Vector2(0, LAYOUT.tableCenterZ) } }]), vertexShader: CLOUD_VERTEX, fragmentShader: CLOUD_FRAGMENT, transparent: true, depthWrite: false, fog: true }),
      skyMaterial: new ShaderMaterial({ uniforms: { uResolution: { value: new Vector2(1, 1) } }, vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: BackSide, depthWrite: false, toneMapped: false }) };
  }, [quality]);
  const matrix = useMemo(() => new Matrix4(), []);
  const baseRecords = useMemo(() => Array.from({ length: 70 }, (_, i) => {
    const a = i / 70 * Math.PI * 2, r = i < 46 ? .89 + random(i, 18) * .15 : Math.sqrt(random(i, 4)) * .75;
    return { x: Math.cos(a) * 7.5 * r, z: Math.sin(a) * 6.8 * r, y: -.95 - random(i, 22) * .8,
      sx: 1.25 + random(i, 2) * 1.4, sy: .95 + random(i, 5) * .5, sz: 1.05 + random(i, 8) * 1.3 };
  }), []);
  const records = useMemo(() => Array.from({ length: count * 5 }, (_, i) => {
    const cluster = Math.floor(i / 5), a = cluster / count * Math.PI * 2 + random(cluster, 5) * .3, radius = 18 + random(cluster, 2) * 44;
    return { cluster, x: Math.cos(a) * radius + (i % 5 - 2) * 1.5, z: Math.sin(a) * radius, y: -4 + random(cluster, 12) * 7,
      sx: 2.3 + random(i, 15) * 2.5, sy: .7 + random(i, 20), sz: 1.7 + random(i, 14) * 1.9 };
  }), [count]);
  const palaceIslands = useMemo(() => records.filter((_, i) => i % 5 === 2), [records]);
  useLayoutEffect(() => {
    baseRecords.forEach((p, i) => { matrix.makeScale(p.sx, p.sy, p.sz); matrix.setPosition(p.x, p.y, p.z); base.current?.setMatrixAt(i, matrix); });
    if (base.current) base.current.instanceMatrix.needsUpdate = true;
  }, [baseRecords, matrix, built]);
  useLayoutEffect(() => { gl.getDrawingBufferSize(built.skyMaterial.uniforms.uResolution!.value as Vector2); }, [gl, size.width, size.height, built]);
  useFrame((_, delta) => {
    if (!reduceMotion) elapsed.current += Math.min(delta, .05) / ANIMATION_DURATION_SCALE;
    const t = elapsed.current;
    built.shadowTime.value = t;
    records.forEach((p, i) => { matrix.makeScale(p.sx, p.sy, p.sz); matrix.setPosition(p.x + Math.sin(t * .09 + p.cluster) * 2.1,
      p.y + Math.sin(t * .16 + p.cluster * 1.7) * .35, p.z + Math.cos(t * .07 + p.cluster) * 1.4); drift.current?.setMatrixAt(i, matrix); });
    if (drift.current) drift.current.instanceMatrix.needsUpdate = true;
  });
  useEffect(() => () => { built.texture.dispose(); built.top.dispose(); built.guides.dispose(); built.sphere.dispose(); built.dome.dispose(); built.topMaterial.dispose(); built.baseMaterial.dispose(); built.driftMaterial.dispose(); built.skyMaterial.dispose(); }, [built]);
  const gold = useMemo(() => new Color(theme.mat.inlay), [theme]);
  return <>
    <mesh geometry={built.dome} material={built.skyMaterial} renderOrder={-1000} raycast={noHit} dispose={null}/>
    <hemisphereLight args={[0xf5fbff, 0xc4d6e9, .65]}/>
    <directionalLight color={0xffedc8} intensity={.6} position={[-25, 16, -45]}/>
    <group position={[0, 0, LAYOUT.tableCenterZ]}>
      <CloudPalaces islands={palaceIslands} clock={elapsed} />
      <instancedMesh ref={base} args={[built.sphere, built.baseMaterial, baseRecords.length]} frustumCulled={false} raycast={noHit} dispose={null}/>
      <mesh geometry={built.top} material={built.topMaterial} receiveShadow raycast={noHit} dispose={null}/>
      <instancedMesh ref={drift} args={[built.sphere, built.driftMaterial, records.length]} frustumCulled={false} raycast={noHit} dispose={null}/>
      <mesh geometry={built.guides} position={[0, .012, 0]} renderOrder={10} raycast={noHit} dispose={null}><meshBasicMaterial color={gold} toneMapped={false} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1}/></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .004, 0]} renderOrder={10} raycast={noHit}><ringGeometry args={[.27, .29, 48]}/><meshBasicMaterial color={gold} toneMapped={false} transparent depthWrite={false}/></mesh>
    </group>
  </>;
}
