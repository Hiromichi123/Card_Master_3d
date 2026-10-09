import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, Fog, Matrix4,
  PMREMGenerator, type AmbientLight, type DirectionalLight, type Group,
  type InstancedMesh, type MeshPhysicalMaterial, type PointLight, type ShaderMaterial,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { buildMaterial, type QualityLevel } from '../table/materials';
import { getTableTheme } from '../table/themes';
import { noise, type LoginMotion } from './motion';

const VERTEX_UV = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;

/** Renderer-local PMREM: login and the hub can overlap without stealing/discarding environments. */
export function LoginLighting({ motion, shadows, shadowMapSize }: {
  readonly motion: LoginMotion; readonly shadows: boolean; readonly shadowMapSize: number;
}) {
  const { gl, scene } = useThree();
  const key = useRef<DirectionalLight>(null);
  const fill = useRef<DirectionalLight>(null);
  const ambient = useRef<AmbientLight>(null);
  const sun = useRef<PointLight>(null);
  useEffect(() => {
    const previous = scene.environment;
    const room = new RoomEnvironment();
    const generator = new PMREMGenerator(gl);
    const target = generator.fromScene(room, .045);
    scene.environment = target.texture;
    room.dispose();
    generator.dispose();
    return () => {
      if (scene.environment === target.texture) scene.environment = previous;
      target.dispose();
    };
  }, [gl, scene]);
  useFrame(() => {
    const amount = motion.current.brightness;
    const origin = motion.current.origin;
    scene.environmentIntensity = amount * .4;
    if (key.current) {
      key.current.intensity = amount * 1.65;
      key.current.position.set(-28, 34, origin + 12);
      key.current.target.position.set(0, 0, origin - 28);
      key.current.target.updateMatrixWorld();
    }
    if (fill.current) {
      fill.current.intensity = amount * .48;
      fill.current.position.set(16, 20, origin - 25);
      fill.current.target.position.set(0, 4, origin - 22);
      fill.current.target.updateMatrixWorld();
    }
    if (ambient.current) ambient.current.intensity = amount * .07;
    if (sun.current) {
      sun.current.intensity = amount * 1050;
      sun.current.position.set(0, 10, origin - 80);
    }
  });
  return <>
    <ambientLight ref={ambient} intensity={0} color="#c4cada" />
    <directionalLight ref={key} intensity={0} color="#ffe4b4" position={[-28, 34, 12]}
      castShadow={shadows} shadow-mapSize-width={shadowMapSize} shadow-mapSize-height={shadowMapSize}
      shadow-camera-left={-42} shadow-camera-right={42} shadow-camera-top={62} shadow-camera-bottom={-62}
      shadow-camera-near={1} shadow-camera-far={190} shadow-normalBias={.018} shadow-bias={-.00012} shadow-radius={3} />
    <directionalLight ref={fill} intensity={0} color="#bed4ff" position={[16, 12, -28]} />
    <pointLight ref={sun} intensity={0} color="#ffcb7c" position={[0, 13, -68]} distance={150} decay={2} />
  </>;
}

const BOARD_RADIUS = 180;
const BOARD_CENTER_Z = -64;

function TileField({ material, parity }: {
  readonly material: MeshPhysicalMaterial; readonly parity: number;
}) {
  const mesh = useRef<InstancedMesh>(null);
  const positions = useMemo(() => {
    const result: [number, number][] = [];
    for (let row = 0; row < 44; row++) {
      for (let col = 0; col < 44; col++) {
        const x = (col - 21.5) * 8;
        const z = (row - 21.5) * 8;
        // Entire square stays inside the disk, leaving a circular timber rim.
        if ((row + col) % 2 === parity && Math.hypot(x, z) + Math.SQRT2 * 4 < BOARD_RADIUS - 10) result.push([x, z]);
      }
    }
    return result;
  }, [parity]);
  useLayoutEffect(() => {
    const field = mesh.current;
    if (!field) return;
    const matrix = new Matrix4();
    positions.forEach(([x, z], index) => {
      matrix.makeTranslation(x, -.2, z);
      field.setMatrixAt(index, matrix);
    });
    field.instanceMatrix.needsUpdate = true;
    field.computeBoundingSphere();
  }, [material, positions]);
  return <instancedMesh ref={mesh} args={[undefined, material, positions.length]} receiveShadow>
    <boxGeometry args={[7.982, .38, 7.982]} />
  </instancedMesh>;
}

/** Two shallow cloudy layers blend the circular edge into the surrounding grey-black void. */
function BoardRimMist({ motion }: { readonly motion: LoginMotion }) {
  const lower = useRef<ShaderMaterial>(null);
  const upper = useRef<ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uAmount: { value: 0 } }), []);
  useFrame(() => {
    for (const shader of [lower.current, upper.current]) {
      if (shader?.uniforms.uTime) shader.uniforms.uTime.value = motion.current.still ? 0 : motion.current.elapsed * .07;
      if (shader?.uniforms.uAmount) shader.uniforms.uAmount.value = motion.current.brightness;
    }
  });
  return <>{[.08, 1.6].map((height, index) => <mesh key={height} position={[0, height, 0]} rotation={[-Math.PI / 2, 0, 0]}>
    <ringGeometry args={[143, 390, 96, 3]} />
    <shaderMaterial ref={index === 0 ? lower : upper} uniforms={uniforms} transparent depthWrite={false}
      toneMapped={false}
      vertexShader={/* glsl */ `
        varying vec2 vPosition;
        void main() { vPosition=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
      `}
      fragmentShader={/* glsl */ `
        varying vec2 vPosition; uniform float uTime; uniform float uAmount;
        float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float noise(vec2 p) {
          vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
        }
        void main() {
          float cloud=noise(vPosition*.036+vec2(uTime,-uTime*.4));
          cloud=cloud*.65+noise(vPosition*.081-vec2(uTime*.7,uTime))*.35;
          float edge=smoothstep(147.,190.,length(vPosition)+(cloud-.5)*20.);
          float alpha=edge*(.48+.35*cloud)*uAmount;
          gl_FragColor=vec4(mix(vec3(.045,.047,.05),vec3(.105,.11,.116),cloud),alpha);
        }
      `} />
  </mesh>)}</>;
}

/** A genuinely circular, oversized standard wooden board; no rectangular rails or exposed ends. */
export function ProcessionBoard({ motion, quality }: { readonly motion: LoginMotion; readonly quality: QualityLevel }) {
  const root = useRef<Group>(null);
  const theme = getTableTheme('tournament');
  const materials = useMemo(() => ({
    light: buildMaterial({ ...theme.mat.light, tint: 0x77736d, clearcoat: .16, clearcoatRoughness: .3 }, { quality }),
    dark: buildMaterial({ ...theme.mat.dark, tint: 0x686660, clearcoat: .18, clearcoatRoughness: .28 }, { quality }),
    frame: buildMaterial({ ...theme.mat.frame, tint: 0x77716a }, { quality, textureScale: 4 }),
  }), [quality, theme]);
  useEffect(() => () => { Object.values(materials).forEach((material) => material.dispose()); }, [materials]);
  useFrame(() => {
    if (!root.current) return;
    root.current.visible = motion.current.brightness > .0001;
    // Complete paired rows recycle only in the fog while nearby tiles remain fixed in world space.
    root.current.position.z = Math.floor(motion.current.origin / 16) * 16 + BOARD_CENTER_Z;
  });
  return <group ref={root} visible={false}>
    <mesh position={[0, -2.65, 0]} receiveShadow material={materials.frame}>
      <cylinderGeometry args={[BOARD_RADIUS, BOARD_RADIUS, 5.2, quality === 'low' ? 64 : 128]} />
    </mesh>
    <TileField material={materials.light} parity={0} />
    <TileField material={materials.dark} parity={1} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .002, 0]} material={materials.frame} receiveShadow>
      <ringGeometry args={[BOARD_RADIUS - 14, BOARD_RADIUS, 128]} />
    </mesh>
    <BoardRimMist motion={motion} />
  </group>;
}

export function LoginStars({ motion, count }: { readonly motion: LoginMotion; readonly count: number }) {
  const shader = useRef<ShaderMaterial>(null);
  const group = useRef<Group>(null);
  const geometry = useMemo(() => {
    const points: number[] = []; const phases: number[] = []; const sizes: number[] = [];
    for (let i = 0; i < count; i++) {
      const angle = noise(i + 1) * Math.PI * 2;
      const y = noise(i + 209) * 2 - 1;
      const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
      points.push(Math.cos(angle) * horizontal * 340, y * 340, Math.sin(angle) * horizontal * 340);
      phases.push(noise(i + 431) * Math.PI * 2); sizes.push(.6 + noise(i + 916) * 2.1);
    }
    const result = new BufferGeometry();
    result.setAttribute('position', new Float32BufferAttribute(points, 3));
    result.setAttribute('aPhase', new Float32BufferAttribute(phases, 1));
    result.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
    return result;
  }, [count]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uFade: { value: 1 } }), []);
  useFrame(({ camera }) => {
    // Translation follows the camera; the sky has no visible parallax during the dive.
    group.current?.position.copy(camera.position);
    const actual = shader.current?.uniforms;
    if (actual?.uTime) actual.uTime.value = motion.current.still ? 0 : motion.current.elapsed;
    if (actual?.uFade) actual.uFade.value = 1 - motion.current.brightness * .47;
  });
  return <group ref={group}><points geometry={geometry} frustumCulled={false}>
    <shaderMaterial ref={shader} uniforms={uniforms} transparent depthWrite={false}
      blending={AdditiveBlending} toneMapped={false}
      vertexShader={/* glsl */ `
        attribute float aPhase; attribute float aSize;
        uniform float uTime; varying float vLight;
        void main() {
          vLight=.34+.66*pow(.5+.5*sin(uTime*(.45+aSize*.18)+aPhase),2.0);
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
          gl_PointSize=aSize*(.86+vLight*.3);
        }
      `}
      fragmentShader={/* glsl */ `
        uniform float uFade; varying float vLight;
        void main() {
          vec2 p=gl_PointCoord-.5; float r=length(p);
          float core=exp(-r*r*25.0); float alpha=core*vLight*uFade;
          if(alpha<.02) discard;
          gl_FragColor=vec4(mix(vec3(.6,.73,1.),vec3(1.,.88,.68),vLight),alpha);
        }
      `} />
  </points></group>;
}

/** Analytic soft bloom/cross rays, so the horizon light remains graceful even with Bloom disabled. */
export function HorizonLight({ motion }: { readonly motion: LoginMotion }) {
  const root = useRef<Group>(null);
  const shader = useRef<ShaderMaterial>(null);
  const reflection = useRef<ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uAmount: { value: 0 }, uTime: { value: 0 } }), []);
  useFrame(() => {
    if (root.current) root.current.position.z = motion.current.origin;
    for (const material of [shader.current, reflection.current]) {
      const actual = material?.uniforms;
      if (actual?.uAmount) actual.uAmount.value = motion.current.brightness;
      if (actual?.uTime) actual.uTime.value = motion.current.still ? 0 : motion.current.elapsed;
    }
  });
  return <group ref={root}>
    <mesh position={[0, 4.6, -205]}>
      <planeGeometry args={[240, 145]} />
      <shaderMaterial ref={shader} uniforms={uniforms} vertexShader={VERTEX_UV}
        transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false}
        fragmentShader={/* glsl */ `
          varying vec2 vUv; uniform float uAmount; uniform float uTime;
          void main() {
            vec2 p=vUv-.5;
            float glow=exp(-dot(p,p)*22.0)*.48;
            float halo=exp(-dot(p,p)*170.0)*.62;
            float horizontal=exp(-p.y*p.y*7500.0)*exp(-p.x*p.x*12.0)*1.25;
            float vertical=exp(-p.x*p.x*7800.0)*exp(-p.y*p.y*40.0)*1.1;
            float core=exp(-dot(p,p)*9000.0);
            float pulse=.96+.04*sin(uTime*.6);
            float amount=(glow+halo+horizontal+vertical+core)*uAmount*pulse;
            gl_FragColor=vec4(mix(vec3(1.,.58,.22),vec3(1.,.91,.68),clamp(core+horizontal+vertical,0.,1.)),clamp(amount,0.,1.));
          }
        `} />
    </mesh>
    <mesh position={[0, .018, -91]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[13, 140]} />
      <shaderMaterial ref={reflection} uniforms={uniforms} vertexShader={VERTEX_UV}
        transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false}
        fragmentShader={/* glsl */ `
          varying vec2 vUv; uniform float uAmount; uniform float uTime;
          void main() {
            float longitudinal=pow(sin(vUv.y*3.1415926),1.8);
            float width=mix(.08,.35,vUv.y);
            float streak=exp(-pow((vUv.x-.5)/width,2.0)*7.0);
            float ripple=.7+.3*sin(vUv.y*180.0+uTime*.16);
            gl_FragColor=vec4(1.,.63,.26,longitudinal*streak*ripple*.23*uAmount);
          }
        `} />
    </mesh>
  </group>;
}

export function CorridorDust({ motion, count }: { readonly motion: LoginMotion; readonly count: number }) {
  const shader = useRef<ShaderMaterial>(null);
  const geometry = useMemo(() => {
    const positions: number[] = []; const sizes: number[] = [];
    for (let i = 0; i < count; i++) {
      positions.push((i % 2 ? 1 : -1) * (5 + noise(i + 341) * 17), .5 + noise(i + 871) * 21, -noise(i + 28) * 140);
      sizes.push(.9 + noise(i + 712) * 1.5);
    }
    const result = new BufferGeometry();
    result.setAttribute('position', new Float32BufferAttribute(positions, 3));
    result.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
    return result;
  }, [count]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const uniforms = useMemo(() => ({ uTravel: { value: 0 }, uOrigin: { value: 0 }, uAmount: { value: 0 }, uTime: { value: 0 } }), []);
  useFrame(() => {
    const actual = shader.current?.uniforms;
    if (actual?.uTravel) actual.uTravel.value = motion.current.travel;
    if (actual?.uOrigin) actual.uOrigin.value = motion.current.origin;
    if (actual?.uAmount) actual.uAmount.value = motion.current.brightness;
    if (actual?.uTime) actual.uTime.value = motion.current.still ? 0 : motion.current.elapsed;
  });
  return <points geometry={geometry} frustumCulled={false}>
    <shaderMaterial ref={shader} uniforms={uniforms} transparent depthWrite={false}
      blending={AdditiveBlending} toneMapped={false}
      vertexShader={/* glsl */ `
        attribute float aSize; uniform float uTravel; uniform float uOrigin; uniform float uTime; varying float vFade;
        void main() {
          vec3 p=position; p.z=mod(p.z+uTravel+140.,140.)-115.;
          p.y+=sin(uTime*.2+p.x)*.45;
          vFade=smoothstep(-110.,-65.,p.z)*(1.-smoothstep(4.,22.,p.z));
          p.z+=uOrigin;
          vec4 view=modelViewMatrix*vec4(p,1.);
          gl_Position=projectionMatrix*view;
          gl_PointSize=clamp(aSize*25./max(8.,-view.z),.8,3.5);
        }
      `}
      fragmentShader={/* glsl */ `
        varying float vFade; uniform float uAmount;
        void main() {
          float r=length(gl_PointCoord-.5); if(r>.5) discard;
          gl_FragColor=vec4(1.,.78,.4,exp(-r*r*16.)*vFade*uAmount*.6);
        }
      `} />
  </points>;
}

/** Scene-color fades instead of covering the rendered picture with a black full-screen curtain. */
export function LoginAtmosphere({ motion }: { readonly motion: LoginMotion }) {
  const { scene } = useThree();
  const black = useMemo(() => new Color('#000000'), []);
  const night = useMemo(() => new Color('#16181b'), []);
  useFrame(({ camera }) => {
    if (scene.background instanceof Color) scene.background.copy(black).lerp(night, motion.current.brightness);
    // Reveal the vast surface throughout the long dive, then hide recycling at ground level.
    if (scene.fog) scene.fog.color.copy(black).lerp(night, motion.current.brightness);
    if (scene.fog instanceof Fog) {
      const altitude = Math.max(0, camera.position.y - 2.7);
      scene.fog.near = 55 + altitude * .32;
      scene.fog.far = 195 + altitude * 1.8;
    }
  });
  return <><color attach="background" args={['#000000']} /><fog attach="fog" args={['#16181b', 55, 195]} /></>;
}
