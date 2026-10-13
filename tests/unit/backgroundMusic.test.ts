import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { BackgroundMusic, BATTLE_MUSIC, LOBBY_MUSIC } from '../../src/services/audio/BackgroundMusic';

function fixture(random = () => 0) {
  const audio = {
    src: '', paused: true, loop: false, preload: '', currentTime: 0, volume: 1, muted: false,
    play: vi.fn(() => { audio.paused = false; return Promise.resolve(); }),
    pause: vi.fn(() => { audio.paused = true; }),
    load: vi.fn(),
    removeAttribute: vi.fn(() => { audio.src = ''; }),
  };
  const create = vi.fn(() => audio as unknown as HTMLAudioElement);
  return { audio, create, music: new BackgroundMusic(create, random) };
}

async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

describe('背景音乐', () => {
  it('首次手势前不加载或播放，登录和大厅连续循环', async () => {
    const { audio, create, music } = fixture();
    music.start();
    expect(create).not.toHaveBeenCalled();
    music.resume();
    await flush();
    expect(audio.src).toBe(LOBBY_MUSIC);
    expect(audio.loop).toBe(true);
    audio.currentTime = 25;
    music.start();
    music.resume();
    expect(audio.currentTime).toBe(25);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('每局抽曲，同一局/结算不重启，重赛不连续同曲，退出恢复大厅进度', async () => {
    const { audio, music } = fixture();
    const owner = {};
    music.start(); music.resume(); await flush();
    audio.currentTime = 42;
    music.beginBattle(owner, 1); await flush();
    expect(audio.src).toBe(BATTLE_MUSIC[0]);
    audio.currentTime = 30;
    music.beginBattle(owner, 1);
    expect(audio.currentTime).toBe(30);
    music.beginBattle(owner, 2); await flush();
    expect(audio.src).toBe(BATTLE_MUSIC[1]);
    music.endBattle({});
    expect(audio.src).toBe(BATTLE_MUSIC[1]);
    music.endBattle(owner); await flush();
    expect(audio.src).toBe(LOBBY_MUSIC);
    expect(audio.currentTime).toBe(42);
  });

  it('进入战斗界面尚未开局时切曲，首局开始不重复抽取', async () => {
    const { audio, music } = fixture();
    const owner = {};
    music.start(); music.resume(); await flush();
    music.beginBattle(owner, 0); await flush();
    expect(audio.src).toBe(BATTLE_MUSIC[0]);
    audio.currentTime = 12;
    const plays = audio.play.mock.calls.length;
    music.beginBattle(owner, 1);
    expect(audio.src).toBe(BATTLE_MUSIC[0]);
    expect(audio.currentTime).toBe(12);
    expect(audio.play).toHaveBeenCalledTimes(plays);
    music.beginBattle(owner, 2); await flush();
    expect(audio.src).toBe(BATTLE_MUSIC[1]);
  });

  it('主音量平方曲线与独立静音，零音量真静音', () => {
    const { audio, music } = fixture();
    music.setMasterVolume(0.5); music.setMuted(true);
    music.start(); music.resume();
    expect(audio.volume).toBeCloseTo(0.25 * 0.45);
    expect(audio.muted).toBe(true);
    music.setMasterVolume(0);
    music.setMuted(false);
    expect(audio.volume).toBe(0);
    expect(audio.muted).toBe(false);
  });

  it('快速切换时旧播放 promise 不恢复旧曲或解锁新请求', async () => {
    const { audio, music } = fixture();
    let resolve!: () => void;
    audio.play.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
    music.start(); music.resume();
    music.beginBattle({}, 1);
    resolve(); await flush();
    expect(audio.src).toBe(BATTLE_MUSIC[0]);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it('浏览器拒绝时不抛，后续手势重试', async () => {
    const { audio, music } = fixture();
    audio.play.mockImplementationOnce(() => Promise.reject(new Error('NotAllowedError')));
    music.start(); music.resume(); await flush();
    music.resume(); await flush();
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it('卸载释放资源，StrictMode 再次挂载仍可开战', async () => {
    const { audio, music, create } = fixture();
    const owner = {};
    music.start(); music.resume(); await flush();
    music.beginBattle(owner, 1); await flush();
    music.endBattle(owner);
    music.dispose();
    expect(audio.paused).toBe(true);
    expect(audio.src).toBe('');
    music.start(); music.beginBattle(owner, 1); music.resume(); await flush();
    expect(audio.src).toBe(BATTLE_MUSIC[0]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('曲目为本地文件，来源和实际字节数对应，版权不冒充CC0', () => {
    const manifest = JSON.parse(readFileSync('public/assets/audio/bgm/sources.json', 'utf8')) as {
      tracks: { file: string; bytes: number; license: string; processing: { audioDurationSeconds?: number } }[];
    };
    expect(manifest.tracks).toHaveLength(4);
    expect(manifest.tracks[0]!.processing.audioDurationSeconds).toBe(91);
    for (const [index, url] of [LOBBY_MUSIC, ...BATTLE_MUSIC].entries()) {
      const track = manifest.tracks[index]!;
      expect(url).toBe(`/assets/audio/bgm/${track.file}`);
      expect(readFileSync(`public${url}`).byteLength).toBe(track.bytes);
      expect(track.license).toContain('未核实');
    }
  });
});
