import { describe, expect, it, vi } from 'vitest';
import { Texture } from 'three';
import { BackdropCrossfade, type BackdropImageLease } from '../../src/rendering/gacha/BackdropCrossfade';

function image(url: string): BackdropImageLease {
  return { url, texture: new Texture(), release: vi.fn() };
}

describe('gacha illustration crossfade', () => {
  it('shows the first loaded image immediately and blends old/new without a dark gap', () => {
    const blend = new BackdropCrossfade();
    const oldImage = image('old'); const newImage = image('new');
    blend.offer(oldImage);
    expect(blend.mix).toBe(1);
    expect(blend.to).toBe(oldImage);
    blend.offer(newImage);
    blend.advance(0.16, false);
    expect(blend.from).toBe(oldImage); expect(blend.to).toBe(newImage);
    expect(blend.mix).toBeCloseTo(0.5);
    // A pale image remains equally pale while blended with another pale image.
    const oldWeight = 1 - blend.mix;
    expect(0.9 * oldWeight + 0.9 * blend.mix).toBeCloseTo(0.9);
    expect(oldImage.release).not.toHaveBeenCalled();
    blend.advance(0.16, false);
    expect(oldImage.release).toHaveBeenCalledOnce();
    expect(blend.from).toBe(newImage);
    blend.dispose();
    expect(newImage.release).toHaveBeenCalledOnce();
  });

  it('finishes the visible mix before starting the latest rapid selection and releases superseded images', () => {
    const blend = new BackdropCrossfade();
    const a = image('a'); const b = image('b'); const c = image('c'); const d = image('d');
    blend.offer(a); blend.offer(b); blend.advance(0.08, false);
    blend.offer(c); blend.offer(d);
    expect(c.release).toHaveBeenCalledOnce();
    expect(blend.from).toBe(a); expect(blend.to).toBe(b);
    expect(blend.mix).toBeCloseTo(0.25);
    blend.advance(0.24, false);
    expect(a.release).toHaveBeenCalledOnce();
    expect(blend.from).toBe(b); expect(blend.to).toBe(d); expect(blend.mix).toBe(0);
    blend.advance(0.32, false);
    expect(b.release).toHaveBeenCalledOnce();
    blend.dispose();
    expect(d.release).toHaveBeenCalledOnce();
  });

  it('supports instant motion settings and releases every outstanding lease on unmount', () => {
    const blend = new BackdropCrossfade();
    const a = image('a'); const b = image('b'); const c = image('c');
    blend.offer(a); blend.offer(b); blend.offer(c);
    blend.advance(0, true);
    expect(blend.to).toBe(c); expect(blend.from).toBe(c); expect(blend.mix).toBe(1);
    expect(a.release).toHaveBeenCalledOnce(); expect(b.release).toHaveBeenCalledOnce();
    blend.dispose(); blend.dispose();
    expect(c.release).toHaveBeenCalledOnce();
  });
});
