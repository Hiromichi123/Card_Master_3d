import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SampleCache, SAMPLE_CUES, SAMPLE_URLS } from '../../src/services/audio/samples';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('本地音效样本', () => {
  it('纸牌滑动与出牌翻页独立，点击声本地化', () => {
    expect(SAMPLE_URLS.deal).not.toBe(SAMPLE_URLS.play);
    expect(SAMPLE_CUES).toContain('uiClick');
    const manifest = JSON.parse(readFileSync('public/assets/audio/sources.json', 'utf8')) as { cue: string; original: string }[];
    expect(manifest.find(item => item.cue === 'deal')?.original).toBe('Audio/card-slide-1.ogg');
    expect(manifest.find(item => item.cue === 'play')?.original).toBe('Audio/bookFlip1.ogg');
  });
  it('并发加载合并，缓存命中不重复下载', async () => {
    const cache = new SampleCache<number>();
    const pending = deferred<number>();
    let calls = 0;
    const loader = () => { calls += 1; return pending.promise; };
    const first = cache.load('fire', loader);
    expect(cache.load('fire', loader)).toBe(first);
    expect(cache.get('fire')).toBeUndefined();
    pending.resolve(7);
    await first;
    await cache.load('fire', loader);
    expect(cache.get('fire')).toBe(7);
    expect(calls).toBe(1);
  });

  it('失败不抛异常，不填缓存，后续可以重试', async () => {
    const cache = new SampleCache<number>();
    await cache.load('ice', () => Promise.reject(new Error('decode failed')));
    expect(cache.get('ice')).toBeUndefined();
    await cache.load('ice', () => Promise.resolve(3));
    expect(cache.get('ice')).toBe(3);
  });

  it('关闭上下文后迟到的加载不污染新缓存', async () => {
    const cache = new SampleCache<number>();
    const old = deferred<number>();
    const first = cache.load('hit', () => old.promise);
    cache.clear();
    await cache.load('hit', () => Promise.resolve(9));
    old.resolve(1);
    await first;
    expect(cache.get('hit')).toBe(9);
  });

  it('所有映射都是本地 PCM WAV，与来源清单一一对应', () => {
    const manifest = JSON.parse(readFileSync('public/assets/audio/sources.json', 'utf8')) as { cue: string; bytes: number; durationSeconds: number; license: string }[];
    expect(manifest.map(item => item.cue)).toEqual([...SAMPLE_CUES]);
    for (const cue of SAMPLE_CUES) {
      expect(SAMPLE_URLS[cue]).not.toMatch(/^https?:/);
      const file = readFileSync(`public/assets/audio/${cue}.wav`);
      const entry = manifest.find(item => item.cue === cue)!;
      expect(file.subarray(0, 4).toString()).toBe('RIFF');
      expect(file.subarray(8, 12).toString()).toBe('WAVE');
      expect(file.byteLength).toBe(entry.bytes);
      expect(entry.license).toBe('CC0-1.0');
      expect(entry.durationSeconds).toBeLessThanOrEqual(1.2);
    }
  });
});
