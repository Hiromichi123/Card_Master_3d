/**
 * 「音效绝不影响战斗结果」的**机器可判定形式**。
 *
 * 同一份配置、同一段自动演示，跑两遍：一遍接上会记录每次 cue 的 `sound` 出口，
 * 一遍完全不提供它。两次的权威状态指纹、最终显示状态、帧数与演出交接次数
 * 必须逐字节相同。
 *
 * 只要有人日后在某个 cue 回调里顺手读了 `finalState`、改了 `display`、
 * 或者让 `play()` 抛异常，这条就会红。
 */

import { describe, expect, it } from 'vitest';

import { stateFingerprint } from '../../src/domain/battle/engine';
import type { PresentationSpeed } from '../../src/state/settingsStore';
import { projectDisplay } from '../../src/rendering/presentation/displayState';
import { DEMO_CONFIG, demoDefinitions } from '../../src/rendering/presentation/demoBattle';
import { BattleSession } from '../../src/rendering/presentation/session';
import type { SoundCue } from '../../src/services/audio/cues';

const definitions = demoDefinitions();

interface RunResult {
  readonly frames: number;
  readonly cueCount: number;
  readonly fingerprint: string;
  readonly finalDisplay: string;
  readonly handoffs: number;
}

function runGame(speed: PresentationSpeed, withSound: boolean): RunResult {
  let cueCount = 0;
  const effects: string[] = [];
  const session = new BattleSession(DEMO_CONFIG, definitions, () => speed, {
    play: (request) => {
      effects.push(request.template);
    },
    skipAll: () => {},
    ...(withSound
      ? {
          sound: (cue: SoundCue) => {
            cueCount += 1;
            void cue;
          },
        }
      : {}),
  });
  session.setAutoPlayer(true);
  session.start();

  let frames = 0;
  let handoffs = 0;
  let wasPerforming = false;
  const maxFrames = 400_000;
  while (session.getSnapshot().mode !== 'result' && frames < maxFrames) {
    session.tick(1 / 60);
    const performing = session.isPerforming;
    if (wasPerforming && !performing) {
      handoffs += 1;
    }
    wasPerforming = performing;
    frames += 1;
  }
  expect(frames).toBeLessThan(maxFrames);

  return {
    frames,
    cueCount,
    fingerprint: stateFingerprint(session.authoritative),
    finalDisplay: projectDisplay(session.getSnapshot().display),
    handoffs,
  };
}

describe('音效与战斗结果的隔离', () => {
  for (const speed of ['normal', 'fast', 'skip'] as const) {
    it(`${speed}：接上 sound 出口不改变任何结果`, () => {
      const silent = runGame(speed, false);
      const sounded = runGame(speed, true);

      expect(sounded.fingerprint).toBe(silent.fingerprint);
      expect(sounded.finalDisplay).toBe(silent.finalDisplay);
      expect(sounded.frames).toBe(silent.frames);
      expect(sounded.handoffs).toBe(silent.handoffs);
      // 顺带证明「确实响过」——否则这条可能因为回调根本没被调到而空过
      expect(sounded.cueCount).toBeGreaterThan(0);
      expect(silent.cueCount).toBe(0);
    });
  }
});
