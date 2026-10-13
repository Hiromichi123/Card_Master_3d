import type { SoundCue } from './cues';

/** All samples are local CC0 PCM WAV; provenance and processing live beside them. */
export const SAMPLE_CUES = ['deal', 'play', 'uiClick', 'hit', 'attack', 'slash', 'fire', 'ice', 'lightning', 'heal', 'shield', 'teleport'] as const;
export type SampleCue = typeof SAMPLE_CUES[number];
export const SAMPLE_URLS: Partial<Record<SoundCue, string>> = Object.fromEntries(
  SAMPLE_CUES.map(cue => [cue, `${import.meta.env.BASE_URL}assets/audio/${cue}.wav`]),
);

/** One load per key; clearing invalidates late completions after context shutdown. */
export class SampleCache<T> {
  private readonly ready = new Map<string, T>();
  private readonly pending = new Map<string, Promise<void>>();
  private epoch = 0;

  get(key: string): T | undefined { return this.ready.get(key); }

  load(key: string, loader: () => Promise<T>): Promise<void> {
    if (this.ready.has(key)) return Promise.resolve();
    const existing = this.pending.get(key);
    if (existing) return existing;
    const epoch = this.epoch;
    const task = Promise.resolve().then(loader).then(value => {
      if (this.epoch === epoch) this.ready.set(key, value);
    }).catch(() => {
      // Failed samples stay silent; playback uses the synchronous synth fallback.
    }).finally(() => {
      if (this.epoch === epoch) this.pending.delete(key);
    });
    this.pending.set(key, task);
    return task;
  }

  clear(): void {
    this.epoch += 1;
    this.ready.clear();
    this.pending.clear();
  }
}
