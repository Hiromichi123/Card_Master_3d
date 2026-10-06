import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DataTexture, RGBAFormat, SRGBColorSpace, Vector2, type ShaderMaterial, type Texture } from 'three';
import { assetManager } from '../../services/AssetManager';
import { useSettingsStore } from '../../state/settingsStore';
import { BackdropCrossfade } from './BackdropCrossfade';
import { backdropTextureRepeat } from './revealStyle';
import { useBackgroundMemory } from '../../ui/SceneBackground';

const FRAGMENT = `
  varying vec2 vUv;
  uniform sampler2D mapFrom;
  uniform sampler2D mapTo;
  uniform vec2 repeatFrom;
  uniform vec2 repeatTo;
  uniform float blend;
  uniform vec3 tint;
  void main() {
    vec3 oldImage = texture2D(mapFrom, (vUv - 0.5) * repeatFrom + 0.5).rgb;
    vec3 newImage = texture2D(mapTo, (vUv - 0.5) * repeatTo + 0.5).rgb;
    // One opaque surface, complementary weights: never fade through black or wood.
    gl_FragColor = vec4(mix(oldImage, newImage, blend) * tint, 1.0);
    #include <colorspace_fragment>
  }
`;

function repeatFor(texture: Texture, aspect: number): readonly [number, number] {
  const image = texture.image as { width?: number; height?: number } | undefined;
  return backdropTextureRepeat(aspect, image?.width && image.height ? image.width / image.height : 1.6);
}

/** R3F copies uniform entries: always update the material's live uniforms. */
export function syncBackdropImageMaterial(material: ShaderMaterial, from: Texture, to: Texture, blend: number, aspect: number): void {
  const live = material.uniforms;
  live['mapFrom']!.value = from;
  live['mapTo']!.value = to;
  (live['repeatFrom']!.value as Vector2).set(...repeatFor(from, aspect));
  (live['repeatTo']!.value as Vector2).set(...repeatFor(to, aspect));
  live['blend']!.value = blend;
}

/** Only the illustration blends; the board, menus and entities remain opaque. */
export function GachaBackdropImage({ url, width, height, z }: {
  readonly url: string | null;
  readonly width: number;
  readonly height: number;
  readonly z: number;
}) {
  const still = useSettingsStore((state) => state.reduceMotion);
  const transition = useMemo(() => new BackdropCrossfade(), []);
  const material = useRef<ShaderMaterial>(null);
  const memory = useBackgroundMemory();
  const entryBackground = useRef(memory.current);
  const fallback = useMemo(() => {
    const texture = new DataTexture(new Uint8Array([200, 185, 156, 255]), 1, 1, RGBAFormat);
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, []);
  const uniforms = useMemo(() => ({
    mapFrom: { value: fallback as Texture }, mapTo: { value: fallback as Texture },
    repeatFrom: { value: new Vector2(1, 1) }, repeatTo: { value: new Vector2(1, 1) },
    blend: { value: 1 }, tint: { value: new Color('#eeeeee') },
  }), [fallback]);
  useEffect(() => () => { transition.dispose(); }, [transition]);
  useEffect(() => () => fallback.dispose(), [fallback]);
  useEffect(() => {
    if (!url) {
      transition.offer({ url, texture: fallback, release: () => {} });
      return;
    }
    let cancelled = false;
    const borrowed = new Set<string>();
    const show = async (source: string): Promise<void> => {
      borrowed.add(source);
      const texture = await assetManager.acquire(source);
      if (cancelled) return;
      borrowed.delete(source);
      transition.offer({ url: source, texture, release: () => assetManager.release(source) });
    };
    void (async () => {
      // Bridge the last menu background into the board on a route change.
      if (!transition.to && entryBackground.current && entryBackground.current !== url) await show(entryBackground.current);
      if (cancelled) return;
      await show(url);
      if (!cancelled) memory.current = url;
    })();
    return () => {
      cancelled = true;
      for (const source of borrowed) assetManager.release(source);
      borrowed.clear();
    };
  }, [url, fallback, transition, memory]);
  useFrame((_, delta) => {
    transition.advance(delta, still);
    const from = transition.from?.texture ?? fallback;
    const to = transition.to?.texture ?? fallback;
    if (material.current) syncBackdropImageMaterial(material.current, from, to, transition.mix, width / height);
  });
  return <mesh position={[0, 0, z]}>
    <planeGeometry args={[width, height]} />
    <shaderMaterial ref={material} uniforms={uniforms} toneMapped={false} fog={false}
      vertexShader="varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }"
      fragmentShader={FRAGMENT} />
  </mesh>;
}
