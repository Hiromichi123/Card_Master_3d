import { admit, createGates, resetGates, type GateState } from './CueGate';
import { CUE_POLICIES, type SoundCue } from './cues';

/**
 * 最小音效引擎。**全工程唯一碰 WebAudio 的文件。**
 *
 * 设计取舍：
 *
 * 1. **零资源文件**——音效全部用振荡器与噪声**现合成**，不引入 mp3/ogg。
 *    理由：这个项目的音频只需要「有反馈」这一层，为一个音节去动几百 MB 的
 *    资源库（`assets-library` 331 MB）不划算；合成音也不受资源加载时序影响，
 *    不会出现「第一次命中没声音」。
 * 2. **惰性创建 `AudioContext`**——构造语句写在 `resume()` 内部。加载期就建
 *    context 会被 Chrome 判为「无手势创建」，停在 `suspended` 并打警告。
 * 3. **`play()` 永不抛异常、永不同步等待**。它可能被战斗 `useFrame` 里的
 *    演出回调调到（`Timeline.update()` 末尾会调 `onDone`），那里抛出异常会顺着
 *    冲到 R3F 的渲染循环。音频坏了只能是「没声音」，不能是「战斗卡死」。
 * 4. **每个声部显式 `disconnect()`**——WebAudio 的节点在有连接时不会被回收，
 *    这正是 P7 清单里「切场景十次资源数不得持续增长」要防的那类泄漏。
 *
 * 合成配方与 `AudioContext` 解耦（模块级的 `scheduleCue` 等），所以要量响度
 * 可以直接在 `OfflineAudioContext` 里渲染同一套图，拿到**实测峰值**而不是靠听
 * ——见 `measurePeak`。
 */

export interface AudioStats {
  readonly requested: number;
  readonly played: number;
  readonly merged: number;
  readonly dropped: number;
  readonly voices: number;
}

export interface PlayOptions {
  /** 增益倍率（在 cue 自身强度之上）。 */
  readonly gain?: number;
  /** 更亮的音色（抽卡命中高稀有度时用）。 */
  readonly bright?: boolean;
}

/** 同时发声的声部上限。策略写错了也不会炸的兜底（限流是第一道防线）。 */
const MAX_VOICES = 24;

/** 声部登记：活引擎用它记账与回收节点，离线渲染给空实现。 */
type VoiceRegister = (source: AudioScheduledSourceNode, nodes: readonly AudioNode[]) => void;

interface ToneOptions {
  readonly freq: number;
  readonly endFreq?: number | undefined;
  readonly type?: OscillatorType | undefined;
  readonly dur: number;
  readonly gain: number;
  readonly detune?: number | undefined;
  readonly delay?: number | undefined;
}

interface NoiseOptions {
  readonly dur: number;
  readonly gain: number;
  readonly freq: number;
  readonly q?: number | undefined;
  readonly type?: BiquadFilterType | undefined;
  readonly delay?: number | undefined;
}

// --- 合成（与具体 AudioContext 无关，便于离线渲染测峰值）-----------------------

function scheduleTone(
  ctx: BaseAudioContext,
  bus: AudioNode,
  t0: number,
  opts: ToneOptions,
  register: VoiceRegister,
): void {
  const osc = ctx.createOscillator();
  osc.type = opts.type ?? 'triangle';
  osc.frequency.setValueAtTime(opts.freq, t0);
  if (opts.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.endFreq), t0 + opts.dur);
  }
  if (opts.detune) {
    osc.detune.value = opts.detune;
  }
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t0 + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  osc.connect(env).connect(bus);
  // 先 start 再 stop：顺序反了在部分实现上会让这个声部永不出声
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.02);
  register(osc, [osc, env]);
}

function scheduleNoise(
  ctx: BaseAudioContext,
  bus: AudioNode,
  buffer: AudioBuffer,
  t0: number,
  opts: NoiseOptions,
  register: VoiceRegister,
): void {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = opts.type ?? 'bandpass';
  filter.frequency.setValueAtTime(opts.freq, t0);
  filter.Q.value = opts.q ?? 0.9;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t0 + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  src.connect(filter).connect(env).connect(bus);
  src.start(t0);
  src.stop(t0 + opts.dur + 0.02);
  register(src, [src, filter, env]);
}

/**
 * 每类音效的**电平系数**——把配方里的相对比例放大到听得见的响度。
 *
 * 这些数字是**实测标定**的，不是调出来的感觉：用 `measurePeak`（内部走
 * `OfflineAudioContext` 渲染同一套图）量过，配方本身只给出音色与相对强弱，
 * 绝对响度全靠这一层。标定前 `hit` / `death` / `deal` 的峰值只有
 * −20 ~ −25 dBFS，乘上 0.7 的主音量后落到 −26 ~ −31 dB，笔记本喇叭上听不见。
 *
 * 目标：单声部峰值落在 0.5 左右（约 −6 dBFS），给「同时几十声」和
 * 压缩器留出余量。改配方里的比例之后**要重新量一次**。
 */
const CUE_LEVEL: Record<SoundCue, number> = {
  deal: 10,
  hit: 6,
  death: 6,
  gacha: 1.9,
  fusion: 1.9,
};

/** 每类音效的合成配方。传入的 `gain` 是倍数（合并 / 调用方覆盖），相对强弱在配方里。 */
function scheduleCue(
  ctx: BaseAudioContext,
  bus: AudioNode,
  buffer: AudioBuffer,
  startAt: number,
  cue: SoundCue,
  gain: number,
  bright: boolean,
  merged: boolean,
  register: VoiceRegister,
): void {
  const at = (delay = 0): number => startAt + delay;
  // 相对比例 × 调用方倍数 × 实测标定的电平
  const level = gain * CUE_LEVEL[cue];
  switch (cue) {
    case 'deal':
      scheduleNoise(ctx, bus, buffer, at(), { dur: 0.05, gain: 0.34 * level, freq: 1500, q: 0.7 }, register);
      scheduleTone(ctx, bus, at(), { freq: 190, endFreq: 95, type: 'triangle', dur: 0.07, gain: 0.22 * level }, register);
      break;
    case 'hit':
      scheduleNoise(ctx, bus, buffer, at(), { dur: 0.09, gain: 0.6 * level, freq: 1100, q: 1.1 }, register);
      scheduleTone(ctx, bus, at(), { freq: 230, type: 'square', dur: 0.05, gain: 0.3 * level }, register);
      break;
    case 'death':
      scheduleTone(ctx, bus, at(), { freq: 240, endFreq: 58, type: 'sawtooth', dur: 0.32, gain: 0.42 * level }, register);
      scheduleNoise(ctx, bus, buffer, at(0.02), { dur: 0.26, gain: 0.24 * level, freq: 420, q: 0.6, type: 'lowpass' }, register);
      break;
    case 'gacha': {
      const notes = bright ? [523.25, 659.25, 987.77] : [392, 523.25, 659.25];
      notes.forEach((freq, i) => {
        scheduleTone(ctx, bus, at(i * 0.07), { freq, type: 'triangle', dur: 0.18, gain: 0.3 * level }, register);
      });
      if (bright) {
        scheduleTone(ctx, bus, at(0.14), { freq: notes[2]!, type: 'sine', dur: 0.34, gain: 0.18 * level, detune: 12 }, register);
      }
      break;
    }
    case 'fusion':
      scheduleTone(ctx, bus, at(), { freq: 180, endFreq: 900, type: 'sine', dur: 0.8, gain: 0.4 * level }, register);
      scheduleTone(ctx, bus, at(), { freq: 185, endFreq: 910, type: 'sine', dur: 0.8, gain: 0.24 * level, detune: 14 }, register);
      scheduleNoise(ctx, bus, buffer, at(0.1), { dur: 0.7, gain: 0.22 * level, freq: 2000, q: 0.4 }, register);
      break;
    default:
      break;
  }
  if (merged) {
    // 合并声加一点失谐，读起来是「很多下叠在一起」
    scheduleTone(
      ctx,
      bus,
      at(),
      { freq: cue === 'death' ? 150 : 300, type: 'sawtooth', dur: 0.14, gain: 0.2 * level, detune: -80 },
      register,
    );
  }
}

function makeNoiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly gates: Map<SoundCue, GateState> = createGates();
  private voices = 0;
  private muted = false;
  private volume = 0.7;
  private counters = { requested: 0, played: 0, merged: 0, dropped: 0 };

  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  /** 诊断用：`suspended` / `running` / `closed`，或还没建 context 时的 null。 */
  get state(): string | null {
    return this.ctx?.state ?? null;
  }

  get stats(): AudioStats {
    return { ...this.counters, voices: this.voices };
  }

  /** 由**首次用户手势**调用。幂等；任何失败都吞掉（没声音不是错误）。 */
  async resume(): Promise<void> {
    try {
      if (!this.ctx) {
        this.build();
      }
      if (this.ctx && this.ctx.state !== 'running') {
        await this.ctx.resume();
      }
    } catch {
      /* 音频不可用：保持静默 */
    }
  }

  /** 0..1。内部走平方曲线（感知更线性），0 即真静音。 */
  setMasterVolume(value: number): void {
    this.volume = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.7;
    this.applyVolume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
  }

  /** 触发一声。**永远不抛**，也永远不阻塞调用方。 */
  play(cue: SoundCue, options: PlayOptions = {}): void {
    try {
      this.counters.requested += 1;
      if (this.muted) {
        return;
      }
      const ctx = this.ctx;
      const bus = this.masterGain;
      const buffer = this.noiseBuffer;
      if (!ctx || !bus || !buffer || ctx.state !== 'running') {
        return;
      }
      const admission = admit(this.gates, cue, ctx.currentTime * 1000);
      if (admission === null) {
        this.counters.dropped += 1;
        return;
      }
      if (this.voices >= MAX_VOICES) {
        this.counters.dropped += 1;
        return;
      }
      const merged = admission.kind === 'merge';
      if (merged) {
        this.counters.merged += 1;
      } else {
        this.counters.played += 1;
      }
      const boost = merged ? CUE_POLICIES[cue].mergeGain : 1;
      scheduleCue(
        ctx,
        bus,
        buffer,
        ctx.currentTime + 0.005,
        cue,
        boost * (options.gain ?? 1),
        options.bright ?? false,
        merged,
        this.registerVoice,
      );
    } catch {
      /* 见文件头第 3 条 */
    }
  }

  /**
   * 在 `OfflineAudioContext` 里渲染一声，返回**实测峰值**（0..1）。
   *
   * 用来量响度：`-20 dBFS` 左右的峰值在笔记本喇叭上基本听不见，
   * 而这件事靠耳朵调不出来。开发期工具，也是 `tests/unit` 之外
   * 唯一能给出数字的地方。
   */
  async measurePeak(cue: SoundCue, gain = 1): Promise<number | null> {
    const Ctor =
      typeof globalThis !== 'undefined'
        ? (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
        : undefined;
    if (!Ctor) {
      return null;
    }
    const ctx = new Ctor(1, Math.floor(44100 * 1.6), 44100);
    const master = ctx.createGain();
    master.gain.value = 1;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.ratio.value = 6;
    master.connect(compressor).connect(ctx.destination);
    const buffer = makeNoiseBuffer(ctx, 0.9);
    scheduleCue(ctx, master, buffer, 0, cue, gain, false, false, () => {});
    const rendered = await ctx.startRendering();
    const data = rendered.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i += 1) {
      const value = Math.abs(data[i]!);
      if (value > peak) {
        peak = value;
      }
    }
    return peak;
  }

  /** 切场景/卸载：停掉正在响的声部并让限流状态归零。 */
  stopAll(): void {
    try {
      this.ctx?.close();
    } catch {
      /* 忽略 */
    }
    this.ctx = null;
    this.masterGain = null;
    this.noiseBuffer = null;
    this.voices = 0;
    resetGates(this.gates);
  }

  dispose(): void {
    this.stopAll();
  }

  // --- 内部 ---------------------------------------------------------------

  /**
   * 声部登记：计数 + 播完自己断开。
   *
   * **必须显式 `disconnect()`**：WebAudio 的节点在有连接时不会被回收，
   * 这正是「切场景十次资源数不得持续增长」要防的那类泄漏。
   */
  private registerVoice: VoiceRegister = (source, nodes) => {
    this.voices += 1;
    source.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          /* 已经断开 */
        }
      }
    };
  };

  private build(): void {
    const Ctor =
      typeof globalThis !== 'undefined'
        ? globalThis.AudioContext ??
          (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctor) {
      return;
    }
    const ctx = new Ctor();
    const master = ctx.createGain();
    // 压缩器是「几十声同时命中」的最后一道防线（限流是第一道）
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.ratio.value = 6;
    master.connect(compressor).connect(ctx.destination);
    this.ctx = ctx;
    this.masterGain = master;
    this.noiseBuffer = makeNoiseBuffer(ctx, 0.9);
    this.applyVolume();
  }

  private applyVolume(): void {
    const gain = this.masterGain;
    const ctx = this.ctx;
    if (!gain || !ctx) {
      return;
    }
    // 0.7 的音量对应 0.49 的增益；配合各 cue 的峰值（见 scheduleCue）落在可听区间
    const target = this.muted ? 0 : this.volume * this.volume;
    // setTargetAtTime 而不是直接赋值：直接改会爆音
    try {
      gain.gain.setTargetAtTime(target, ctx.currentTime, 0.02);
    } catch {
      gain.gain.value = target;
    }
  }
}

/** 模块级单例，与 `effectDirector` 同构。 */
export const audioEngine = new AudioEngine();

/**
 * 首次用户手势解锁音频。返回移除监听的清理函数。
 *
 * **不用 `{ once: true }`**：`resume()` 可能被浏览器拒绝（或页面切后台后再次
 * `suspended`），所以两个监听都留到 `ctx.state === 'running'` 才一起摘掉。
 * `capture: true` 是为了在 React 合成事件与可能的 `stopPropagation` 之前拿到手势。
 */
export function unlockAudioOnFirstGesture(target: Window = window): () => void {
  if (audioQueryFlag() === '0') {
    audioEngine.setMuted(true);
  }
  // 开发期把引擎挂到 window：浏览器用例与手查都能读 stats / context 状态
  if (import.meta.env.DEV) {
    (target as unknown as { __cmAudio?: AudioEngine }).__cmAudio = audioEngine;
  }
  const attempt = (): void => {
    void audioEngine.resume().then(() => {
      if (audioEngine.unlocked) {
        remove();
      }
    });
  };
  const remove = (): void => {
    target.removeEventListener('pointerdown', attempt, true);
    target.removeEventListener('keydown', attempt, true);
  };
  target.addEventListener('pointerdown', attempt, { passive: true, capture: true });
  target.addEventListener('keydown', attempt, { passive: true, capture: true });
  // `?audio=1`：开发期在加载后直接尝试解锁（浏览器仍可能拒绝，属预期）
  if (audioQueryFlag() === '1') {
    attempt();
  }
  return remove;
}

/**
 * 开发期开关：`?audio=0` 强制静音、`?audio=1` 尝试立即解锁。
 * 与 `?day=` / `?failsave=` 同一风格；浏览器用例靠它拿到确定性基线。
 */
function audioQueryFlag(): string | null {
  if (typeof window === 'undefined' || !window.location) {
    return null;
  }
  return new URLSearchParams(window.location.search).get('audio');
}
