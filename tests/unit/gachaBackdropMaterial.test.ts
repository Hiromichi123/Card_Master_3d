import { expect, it } from 'vitest';
import { applyProps } from '@react-three/fiber';
import { ShaderMaterial, Texture, Vector2 } from 'three';
import { syncBackdropImageMaterial } from '../../src/rendering/gacha/GachaBackdropImage';

it('binds loaded images and blend weight to the actual R3F material, not copied source uniforms', () => {
  const fallback = new Texture(); const oldImage = new Texture(); const loadedImage = new Texture();
  oldImage.image = { width: 1600, height: 1000 };
  loadedImage.image = { width: 1200, height: 1200 };
  const uniforms = {
    mapFrom: { value: fallback }, mapTo: { value: fallback }, blend: { value: 1 },
    repeatFrom: { value: new Vector2(1, 1) }, repeatTo: { value: new Vector2(1, 1) },
  };
  const material = new ShaderMaterial();
  applyProps(material, { uniforms });
  expect(material.uniforms['mapTo']).not.toBe(uniforms.mapTo);
  syncBackdropImageMaterial(material, oldImage, loadedImage, 0.5, 1.6);
  expect(material.uniforms['mapFrom']!.value).toBe(oldImage);
  expect(material.uniforms['mapTo']!.value).toBe(loadedImage);
  expect(material.uniforms['blend']!.value).toBe(0.5);
  expect(uniforms.mapTo.value).toBe(fallback);
  expect((material.uniforms['repeatTo']!.value as Vector2).y).toBeCloseTo(1 / 1.6);
  material.dispose(); fallback.dispose(); oldImage.dispose(); loadedImage.dispose();
});
