import { assetUrl } from '../assetUrl';
export const LOBBY_MUSIC = assetUrl('/assets/audio/bgm/lobby.mp3');
export const BATTLE_MUSIC = [
  assetUrl('/assets/audio/bgm/battle-1.mp3'),
  assetUrl('/assets/audio/bgm/battle-2.mp3'),
  assetUrl('/assets/audio/bgm/battle-3.mp3'),
] as const;

/** Long music streams through one media element, never through the short-cue cache. */
export class BackgroundMusic {
  private audio: HTMLAudioElement | null = null;
  private active = false;
  private unlocked = false;
  private muted = false;
  private volume = 0.7;
  private bgmVolume = 1;
  private track: string = LOBBY_MUSIC;
  private lastBattle: string | null = null;
  private battle: { owner: object; runId: number } | null = null;
  private generation = 0;
  private pending: number | null = null;
  private lobbyTime = 0;

  constructor(
    private readonly createAudio: () => HTMLAudioElement = () => new Audio(),
    private readonly random: () => number = Math.random,
  ) {}

  start(): void {
    this.active = true;
    this.tryPlay();
  }

  /** Call within the gesture, before awaiting AudioContext.resume(). */
  resume(): void {
    this.unlocked = true;
    this.tryPlay();
  }

  setMasterVolume(value: number): void {
    this.volume = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.7;
    this.applyVolume();
  }

  setBgmVolume(value: number): void {
    this.bgmVolume = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
    this.applyVolume();
  }

  setMuted(value: boolean): void {
    this.muted = value;
    this.applyVolume();
  }

  beginBattle(owner: object, runId: number): void {
    // runId 0 is the battle screen's pre-start menu; keep its track for round 1.
    const musicRunId = Math.max(1, runId);
    if (this.battle?.owner === owner && this.battle.runId === musicRunId) return;
    this.battle = { owner, runId: musicRunId };
    const candidates = BATTLE_MUSIC.filter(track => track !== this.lastBattle);
    const roll = this.random();
    const index = Math.min(candidates.length - 1, Math.max(0, Math.floor((Number.isFinite(roll) ? roll : 0) * candidates.length)));
    this.lastBattle = candidates[index]!;
    this.select(this.lastBattle);
  }

  endBattle(owner: object): void {
    if (this.battle?.owner !== owner) return;
    this.battle = null;
    this.select(LOBBY_MUSIC);
  }

  dispose(): void {
    this.active = false;
    this.unlocked = false;
    this.generation += 1;
    this.pending = null;
    this.battle = null;
    this.track = LOBBY_MUSIC;
    this.lobbyTime = 0;
    this.lastBattle = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio = null;
    }
  }

  private select(track: string): void {
    if (this.track === track) return;
    if (this.audio && this.track === LOBBY_MUSIC) this.lobbyTime = this.audio.currentTime;
    this.track = track;
    this.generation += 1;
    this.pending = null;
    try {
      if (this.audio) {
        this.audio.pause();
        this.audio.src = track;
        this.audio.load();
        this.audio.currentTime = track === LOBBY_MUSIC ? this.lobbyTime : 0;
      }
    } catch { /* Music failures must not interrupt navigation. */ }
    this.tryPlay();
  }

  private applyVolume(): void {
    if (!this.audio) return;
    this.audio.muted = this.muted;
    this.audio.volume = this.volume * this.volume * this.bgmVolume * this.bgmVolume * 0.45;
  }

  private tryPlay(): void {
    if (!this.active || !this.unlocked || this.pending !== null) return;
    try {
      if (!this.audio) {
        this.audio = this.createAudio();
        this.audio.preload = 'metadata';
        this.audio.loop = true;
        this.audio.src = this.track;
        this.applyVolume();
      }
      if (!this.audio.paused) return;
      const generation = this.generation;
      this.pending = generation;
      void this.audio.play().catch(() => {
        // A later user gesture retries; never restore an obsolete track.
      }).finally(() => {
        if (this.generation === generation) this.pending = null;
      });
    } catch {
      this.pending = null;
    }
  }
}

export const backgroundMusic = new BackgroundMusic();
