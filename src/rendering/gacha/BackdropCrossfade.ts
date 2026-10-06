import type { Texture } from 'three';
import { BACKGROUND_CROSSFADE_SECONDS } from '../../ui/SceneBackground';

export interface BackdropImageLease {
  readonly url: string | null;
  readonly texture: Texture;
  readonly release: () => void;
}

/** Keeps both images alive until the blend finishes; rapid selections queue the latest image. */
export class BackdropCrossfade {
  from: BackdropImageLease | null = null;
  to: BackdropImageLease | null = null;
  mix = 1;
  private queued: BackdropImageLease | null = null;

  offer(image: BackdropImageLease): void {
    if (!this.to) {
      this.from = this.to = image;
      this.mix = 1;
      return;
    }
    this.queued?.release();
    this.queued = null;
    if (image.url === this.to.url) {
      image.release();
    } else if (this.mix < 1) {
      this.queued = image;
    } else {
      this.from = this.to;
      this.to = image;
      this.mix = 0;
    }
  }

  advance(delta: number, instant: boolean): void {
    if (this.mix < 1) {
      this.mix = instant ? 1 : Math.min(1, this.mix + delta / BACKGROUND_CROSSFADE_SECONDS);
      if (this.mix === 1) {
        if (this.from !== this.to) this.from?.release();
        this.from = this.to;
      }
    }
    if (this.mix === 1 && this.queued) {
      const next = this.queued;
      this.queued = null;
      this.offer(next);
      if (instant) this.advance(0, true);
    }
  }

  dispose(): void {
    for (const lease of new Set([this.from, this.to, this.queued])) lease?.release();
    this.from = this.to = this.queued = null;
    this.mix = 1;
  }
}
