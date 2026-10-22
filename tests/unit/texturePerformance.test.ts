import { afterEach, describe, expect, it, vi } from 'vitest';
import { Texture, TextureLoader } from 'three';
import { AssetManager } from '../../src/services/AssetManager';
import { TextureLoadQueue } from '../../src/services/TextureLoadQueue';

afterEach(() => vi.restoreAllMocks());
const picture = () => { const texture = new Texture<HTMLImageElement>({ width: 16, height: 16 } as HTMLImageElement); texture.generateMipmaps = false; return texture; };

describe('texture load scheduling and memory pressure', () => {
  it('limits concurrency, keeps FIFO order, and recovers from a rejected load', async () => {
    const queue = new TextureLoadQueue(2), starts: number[] = [], finish: (() => void)[] = [];
    const jobs = [0, 1, 2, 3].map(i => queue.run(async () => {
      starts.push(i);
      await new Promise<void>(resolve => finish.push(resolve));
      if (i === 1) throw new Error('missing image');
      return i;
    }));
    const results = Promise.allSettled(jobs);
    await vi.waitFor(() => expect(starts).toEqual([0, 1]));
    expect(queue.queued).toBe(2);
    finish[1]!();
    await vi.waitFor(() => expect(starts).toEqual([0, 1, 2]));
    finish[0]!();
    await vi.waitFor(() => expect(starts).toEqual([0, 1, 2, 3]));
    finish[2]!(); finish[3]!();
    expect((await results).map(result => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
  });

  it('deduplicates requests and evicts by bytes, preserving all live references', async () => {
    const loaded: Texture[] = [];
    const load = vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(async () => {
      const texture = picture(); loaded.push(texture); return texture;
    });
    const manager = new AssetManager({ maxEntries: 100, maxBytes: 1024 });
    const [a, duplicate] = await Promise.all([manager.acquire('a'), manager.acquire('a')]);
    expect(a).toBe(duplicate); expect(load).toHaveBeenCalledTimes(1);
    const dispose = vi.spyOn(a, 'dispose');
    await manager.acquire('b');
    expect(manager.stats().residentBytes).toBe(2048); // Active resources may exceed the soft budget.
    manager.release('a'); expect(dispose).not.toHaveBeenCalled();
    manager.release('a'); expect(dispose).toHaveBeenCalledOnce();
    expect(manager.stats()).toMatchObject({ residentBytes: 1024, evictions: 1 });
    manager.disposeAll(); expect(manager.stats().residentBytes).toBe(0);
  });

  it('does not resurrect textures when a pending load finishes after disposal', async () => {
    let finish!: (texture: Texture<HTMLImageElement>) => void;
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const manager = new AssetManager();
    const pending = manager.acquire('late');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    manager.disposeAll();
    const texture = picture(), dispose = vi.spyOn(texture, 'dispose');
    finish(texture); await pending;
    expect(dispose).toHaveBeenCalledOnce();
    expect(manager.stats()).toMatchObject({ entries: 0, residentBytes: 0 });
    manager.disposeAll();
  });
});
