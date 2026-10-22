// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { NearestFilter, Texture, TextureLoader } from 'three';
import manifest from '../../src/data/surfaceTextures.json';
import { bakedSurfaceTexture, cloneSurfaceTexture } from '../../src/rendering/table/bakedSurfaceTexture';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('updates every live UV clone after asynchronous decode, without changing another material UVs', () => {
  const loaded: (() => void)[] = [];
  vi.stubGlobal('ImageData', class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} });
  vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
    const texture = new Texture<HTMLImageElement>();
    loaded.push(() => { texture.image = { width: 512, height: 512 } as HTMLImageElement; texture.needsUpdate = true; onLoad?.(texture); });
    return texture;
  });
  const base = bakedSurfaceTexture(Object.keys(manifest)[0]!)!;
  const a = cloneSurfaceTexture(base), b = cloneSurfaceTexture(base);
  a.repeat.set(4, 4);
  expect(b.repeat.x).toBe(1); expect(base.repeat.x).toBe(1);
  const versionA = a.version, versionB = b.version;
  loaded[0]!();
  expect(a.image).toBe(base.image); expect(b.image).toBe(base.image);
  expect(a.version).toBeGreaterThan(versionA); expect(b.version).toBeGreaterThan(versionB);
  const normal = bakedSurfaceTexture(Object.keys(manifest).find(key => key.startsWith('normal:'))!)!;
  expect(normal.flipY).toBe(false); expect(normal.generateMipmaps).toBe(false);
  expect(normal.minFilter).toBe(NearestFilter); expect(normal.magFilter).toBe(NearestFilter);
  loaded[1]!(); normal.dispose();
  a.dispose(); b.dispose(); base.dispose();
});

it('keeps GPU allocation dimensions and mip levels stable from placeholder to decoded image', () => {
  vi.stubGlobal('ImageData', class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} });
  const complete: (() => void)[] = [];
  let expectedSize = 0;
  vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
    const size = expectedSize, texture = new Texture<HTMLImageElement>();
    complete.push(() => { texture.image = { width: size, height: size } as HTMLImageElement; texture.needsUpdate = true; onLoad?.(texture); });
    return texture;
  });
  for (const prefix of ['wood:', 'rough:', 'normal:']) {
    const key = Object.keys(manifest).find(key => key.startsWith(prefix) && key.split(':')[1] === '768')
      ?? Object.keys(manifest).find(key => key.startsWith(prefix))!;
    expectedSize = Number(key.split(':')[1]);
    const base = bakedSurfaceTexture(key)!, clone = cloneSurfaceTexture(base);
    const placeholder = clone.image as ImageData;
    const allocated = { width: placeholder.width, height: placeholder.height };
    expect(allocated).toEqual({ width: expectedSize, height: expectedSize });
    const firstPixel = Array.from(placeholder.data.slice(0, 4));
    expect(firstPixel).toEqual(prefix === 'normal:' ? [128, 128, 255, 255] : prefix === 'rough:' ? [128, 128, 128, 255] : [255, 255, 255, 255]);
    complete.shift()!();
    const decoded = clone.image as HTMLImageElement;
    expect({ width: decoded.width, height: decoded.height }).toEqual(allocated);
    const lateClone = cloneSurfaceTexture(base);
    expect(lateClone.image).toBe(clone.image);
    clone.dispose(); lateClone.dispose(); base.dispose();
  }
});
