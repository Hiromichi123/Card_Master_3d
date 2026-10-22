/** Limit simultaneous image decode/completion bursts without blocking the event loop. */
export class TextureLoadQueue {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly concurrency = 4) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be a positive integer');
  }
  run<T>(load: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active++;
        void Promise.resolve().then(load).then(resolve, reject).finally(() => {
          this.active--;
          this.waiting.shift()?.();
        });
      };
      if (this.active < this.concurrency) start(); else this.waiting.push(start);
    });
  }
  get queued(): number { return this.waiting.length; }
}
