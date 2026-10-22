import { ActivityCanvas as Canvas } from '../ActivityCanvas';
import { RenderActivity } from '../RenderActivity';
import { Component, useCallback, useEffect, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { ShaderMaterial, SRGBColorSpace, TextureLoader, Vector2, type InstancedBufferGeometry, type Texture } from 'three';
import { useSettingsStore } from '../../state/settingsStore';
import { ABYSS_LOAD_TIMEOUT_MS } from '../../scenes/abyssPresentation';
import { useForegroundTimeout } from '../../ui/useForegroundTimeout';
import { ABYSS_VORTEX, coverUvScale, makeSmokeGeometry, vortexBudget } from './vortexParameters';
import { VORTEX_FRAGMENT, VORTEX_VERTEX } from './vortexShaders';
import { ABYSS_SPARKS } from './abyssSparks';
import '../../ui/abyssVortex.css';

export interface AbyssVortexProps {
  readonly backgroundUrl: string;
  readonly still: boolean;
  readonly active: boolean;
  readonly flash: MutableRefObject<number>;
}

type VortexStatus = 'loading' | 'ready' | 'fallback';
const CLOUD_BLEND_MS = 650;

class VortexBoundary extends Component<{ children: ReactNode; onUnavailable: () => void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch() { this.props.onUnavailable(); }
  override render() { return this.state.failed ? null : this.props.children; }
}

function supportsWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}

function smokeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VORTEX_VERTEX,
    fragmentShader: VORTEX_FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 }, uFlash: { value: 0 }, uBackground: { value: null },
      uCover: { value: new Vector2(1, 1) },
      uCenter: { value: new Vector2(...ABYSS_VORTEX.center) },
      uEllipse: { value: new Vector2(...ABYSS_VORTEX.ellipse) },
      uInner: { value: ABYSS_VORTEX.innerRadius }, uOuter: { value: ABYSS_VORTEX.outerRadius },
    },
  });
}

function Smoke({ backgroundUrl, still, active, flash, count, onUnavailable, onReady }: AbyssVortexProps & {
  readonly count: number;
  readonly onUnavailable: () => void;
  readonly onReady: () => void;
}) {
  const { gl, size, invalidate } = useThree();
  const [texture, setTexture] = useState<Texture | null>(null);
  const [resources, setResources] = useState<{ geometry: InstancedBufferGeometry; material: ShaderMaterial } | null>(null);
  const elapsed = useRef(0);
  const readySent = useRef(false);
  const renderFailed = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    // StrictMode重放effect时创建新资源，不能复用cleanup已经dispose的memo对象。
    const geometry = makeSmokeGeometry(count);
    const material = smokeMaterial();
    setResources({ geometry, material });
    invalidate();
    return () => { geometry.dispose(); material.dispose(); };
  }, [count, invalidate]);

  useEffect(() => {
    let cancelled = false;
    let disposed = false;
    const loader = new TextureLoader();
    const loaded = loader.load(backgroundUrl, next => {
      if (cancelled) return;
      next.colorSpace = SRGBColorSpace;
      setTexture(next);
      invalidate();
    }, undefined, () => { if (!cancelled) onUnavailable(); });
    return () => { cancelled = true; if (!disposed) { disposed = true; loaded.dispose(); } };
  }, [backgroundUrl, invalidate, onUnavailable]);

  useEffect(() => {
    if (!texture || !resources) return;
    const image = texture.image as { width: number; height: number };
    resources.material.uniforms.uBackground!.value = texture;
    const [x, y] = coverUvScale(size.width, size.height, image.width, image.height);
    (resources.material.uniforms.uCover!.value as Vector2).set(x, y);
    invalidate();
  }, [texture, size.width, size.height, resources, invalidate]);

  useEffect(() => {
    if (resources && (still || !active)) resources.material.uniforms.uFlash!.value = 0;
    invalidate();
  }, [still, active, resources, invalidate]);

  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => { event.preventDefault(); renderFailed.current = true; onUnavailable(); };
    const previous = gl.debug.onShaderError;
    let listening = true;
    renderFailed.current = false;
    gl.debug.onShaderError = () => {
      renderFailed.current = true;
      queueMicrotask(() => { if (listening) onUnavailable(); });
    };
    canvas.addEventListener('webglcontextlost', lost);
    return () => {
      listening = false;
      gl.debug.onShaderError = previous;
      canvas.removeEventListener('webglcontextlost', lost);
    };
  }, [gl, onUnavailable]);

  useFrame((_state, delta) => {
    if (!resources) return;
    if (!still && active) elapsed.current += Math.min(delta, 0.05);
    resources.material.uniforms.uTime!.value = elapsed.current;
    resources.material.uniforms.uFlash!.value = still || !active ? 0 : Math.max(0, Math.min(1, flash.current));
  });

  if (!texture || !resources) return null;
  return <mesh name="abyss-volumetric-wisps" geometry={resources.geometry} material={resources.material} frustumCulled={false} dispose={null}
    onAfterRender={() => {
      if (readySent.current || renderFailed.current || resources.material.uniforms.uBackground!.value !== texture) return;
      readySent.current = true;
      // 编译失败也可能走onAfterRender；等错误回调后再确认真正就绪。
      queueMicrotask(() => { if (mounted.current && !renderFailed.current) onReady(); });
    }} />;
}

function BaseClouds({ backgroundUrl, softened }: { readonly backgroundUrl: string; readonly softened: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [cover, setCover] = useState<readonly [number, number]>([1, 1]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    // 指定深渊图的元数据兜底；能load时采用真实尺寸，不读取或旋转图像像素。
    let imageWidth = 768;
    let imageHeight = 457;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const rect = element.getBoundingClientRect();
      setCover(coverUvScale(rect.width, rect.height, imageWidth, imageHeight));
    };
    const image = new Image();
    image.onload = () => {
      if (!alive) return;
      imageWidth = image.naturalWidth || imageWidth;
      imageHeight = image.naturalHeight || imageHeight;
      measure();
    };
    image.src = backgroundUrl;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      alive = false;
      image.onload = null;
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [backgroundUrl]);
  return <div ref={host} className="abyss-vortex__base" data-softened={softened}>
    <div className="abyss-vortex__image-plane" style={{ width: `${100 / cover[0]}%`, height: `${100 / cover[1]}%` }}>
      <div className="abyss-vortex__fallback-ring">
        {[0, 1, 2, 3].map(layer => <div key={layer} className={`abyss-vortex__cloud abyss-vortex__cloud--${layer}`} />)}
        <svg className="abyss-vortex__sparks" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
          <g className="abyss-vortex__spark-orbit">
            {ABYSS_SPARKS.map(spark => <g key={spark.id} className="abyss-vortex__spark"
              style={{ '--spark-period': `${spark.periodMs}ms`, '--spark-delay': `${spark.delayMs}ms` } as CSSProperties}>
              <path className="abyss-vortex__spark-glow" d={spark.path} />
              <path className="abyss-vortex__spark-core" d={spark.path} />
            </g>)}
          </g>
        </svg>
      </div>
    </div>
  </div>;
}

function VortexLayers(props: AbyssVortexProps) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [status, setStatus] = useState<VortexStatus>('loading');
  const [hidden, setHidden] = useState(() => document.hidden);
  const particleBudget = useSettingsStore(state => state.particleBudget);
  const dprCap = useSettingsStore(state => state.dprCap);
  const budget = vortexBudget(particleBudget, dprCap);
  const unavailable = useCallback(() => setStatus('fallback'), []);
  const active = props.active && !hidden;
  const ready = useCallback(() => setStatus(current => current === 'fallback' ? current : 'ready'), []);
  useEffect(() => {
    const canRender = supportsWebGL2();
    setSupported(canRender);
    if (!canRender) unavailable();
  }, [unavailable]);
  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  // 页面隐藏由前台时钟保留剩余时长；显式停用时不把未绘制判成失败。
  useForegroundTimeout(status === 'loading' && (props.active || hidden), ABYSS_LOAD_TIMEOUT_MS, unavailable);
  const style = {
    '--abyss-cloud-blend': `${CLOUD_BLEND_MS}ms`,
    '--abyss-center-x': `${ABYSS_VORTEX.center[0] * 100}%`,
    '--abyss-center-y': `${ABYSS_VORTEX.center[1] * 100}%`,
    '--abyss-ring-width': `${ABYSS_VORTEX.outerRadius * ABYSS_VORTEX.ellipse[0] * 200}%`,
    '--abyss-ring-height': `${ABYSS_VORTEX.outerRadius * ABYSS_VORTEX.ellipse[1] * 200}%`,
    '--abyss-core-mask': `${ABYSS_VORTEX.innerRadius / ABYSS_VORTEX.outerRadius * 100}%`,
    '--abyss-core-edge': `${(ABYSS_VORTEX.innerRadius + 0.055) / ABYSS_VORTEX.outerRadius * 100}%`,
  } as CSSProperties;
  return <div className="abyss-vortex" aria-hidden="true" data-smoke-count={budget.count} data-vortex-status={status}
    data-still={props.still} data-active={active} data-motion={!active ? 'hidden' : props.still ? 'still' : 'running'} style={style}>
    <BaseClouds backgroundUrl={props.backgroundUrl} softened={status === 'ready'} />
    {supported && status !== 'fallback' && <VortexBoundary onUnavailable={unavailable}>
      <Canvas activityFps={30} dpr={[1, budget.dpr]} frameloop={props.still || !active ? 'demand' : 'always'}
        camera={{ position: [0, 0, 5], fov: 45 }} gl={{ alpha: true, antialias: false, powerPreference: 'low-power' }}
        onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); }} fallback={null}>
        <RenderActivity mode={props.still || !active ? 'demand' : 'always'} fps={30} />
        <Smoke {...props} active={active} count={budget.count} onUnavailable={unavailable} onReady={ready} />
      </Canvas>
    </VortexBoundary>}
  </div>;
}

/** 原图静止；大尺度基础云层始终运动，GPU就绪只添烟丝与立体细节，不撤空基础层。 */
export function AbyssVortex(props: AbyssVortexProps) {
  return <VortexLayers key={props.backgroundUrl} {...props} />;
}
