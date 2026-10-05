/**
 * 演出导演与会话。
 *
 * 这一组要证的是 PLAN 第 4.1 节与验收里最硬的一条：
 * **普通、快速、跳过三种播法得到的规则状态与表现顺序完全相同。**
 *
 * 之所以能在 node 里证，是因为演出层不依赖 three / React / DOM——
 * 它只吃引擎算完的事件与 patch。
 */

import { describe, expect, it } from 'vitest';

import { createBattle, stateFingerprint } from '../../src/domain/battle/engine';
import type { Resolution } from '../../src/domain/battle/types';
import type { PresentationSpeed } from '../../src/state/settingsStore';
import { PROXY_EXIT_SECONDS } from '../../src/rendering/presentation/constants';
import {
  PresentationDirector,
  buildBeats,
  type DirectorDeps,
} from '../../src/rendering/presentation/director';
import {
  displayFromState,
  projectDisplay,
  type DisplayState,
} from '../../src/rendering/presentation/displayState';
import { DEMO_CONFIG, demoDefinitions } from '../../src/rendering/presentation/demoBattle';
import { BattleSession } from '../../src/rendering/presentation/session';

const definitions = demoDefinitions();

interface Recorder {
  readonly effects: string[];
  readonly session: BattleSession;
}

function makeSession(speed: PresentationSpeed): Recorder {
  const effects: string[] = [];
  const session = new BattleSession(DEMO_CONFIG, definitions, () => speed, {
    play: (request) => {
      effects.push(
        `${request.template}|${request.from.join(',')}|${request.to.join(',')}|${request.intensity}`,
      );
    },
    skipAll: () => {},
  });
  return { effects, session };
}

interface RunResult {
  readonly frames: number;
  readonly effects: readonly string[];
  readonly fingerprint: string;
  readonly finalDisplay: string;
  readonly handoffs: number;
  readonly log: readonly string[];
  readonly outcome: string;
}

/** 自动演示跑完整局。`maxFrames` 是死循环的保险。 */
function runGame(speed: PresentationSpeed): RunResult {
  const recorder = makeSession(speed);
  const { session } = recorder;
  session.setAutoPlayer(true);
  session.start();

  let frames = 0;
  let handoffs = 0;
  let wasPerforming = false;
  const maxFrames = 400_000;

  while (session.getSnapshot().mode !== 'result' && frames < maxFrames) {
    session.tick(1 / 60);
    const snapshot = session.getSnapshot();
    const performing = session.isPerforming;

    /*
      每一场演出播完的那一刻，显示状态都必须已经追平权威状态、离场代理也都收掉了。
      自动演示时玩家不参与，`inputOpen` 全程是 false，所以用「演出刚结束」当检查点。
    */
    if (wasPerforming && !performing) {
      handoffs += 1;
      expect(
        PresentationDirector.isConsistent(snapshot.display, session.authoritative),
        `第 ${snapshot.turnNumber} 回合、演出收尾时显示状态与权威状态不一致`,
      ).toBe(true);
      expect(
        snapshot.display.proxies,
        `第 ${snapshot.turnNumber} 回合、演出收尾时还留着离场代理`,
      ).toHaveLength(0);
    }
    wasPerforming = performing;
    frames += 1;
  }

  expect(frames).toBeLessThan(maxFrames);

  const snapshot = session.getSnapshot();
  return {
    frames,
    effects: recorder.effects,
    fingerprint: stateFingerprint(session.authoritative),
    finalDisplay: projectDisplay(snapshot.display),
    handoffs,
    log: snapshot.log,
    outcome: snapshot.outcome?.kind ?? 'none',
  };
}

describe('普通 / 快速 / 跳过', () => {
  const normal = runGame('normal');
  const fast = runGame('fast');
  const skip = runGame('skip');

  it('三种播法得到同一个最终规则状态', () => {
    expect(fast.fingerprint).toBe(normal.fingerprint);
    expect(skip.fingerprint).toBe(normal.fingerprint);
  });

  it('三种播法得到同一个最终显示状态', () => {
    expect(fast.finalDisplay).toBe(normal.finalDisplay);
    expect(skip.finalDisplay).toBe(normal.finalDisplay);
  });

  it('每一次交还控制权时显示状态都追平了权威状态', () => {
    expect(normal.handoffs).toBeGreaterThan(4);
    expect(fast.handoffs).toBeGreaterThan(0);
    expect(skip.handoffs).toBeGreaterThan(0);
  });

  it('特效请求的顺序与参数三种播法完全一致', () => {
    // 跳过时 `skipToEnd` 会补发每一步的 onStart，所以特效请求照样发出，
    // 顺序与参数必须一模一样——这正是「跳过不等于不再演算」的证据
    expect(fast.effects).toEqual(normal.effects);
    expect(skip.effects).toEqual(normal.effects);
    expect(normal.effects.length).toBeGreaterThan(10);
  });

  it('快速与跳过确实比普通快', () => {
    expect(fast.frames).toBeLessThan(normal.frames);
    expect(skip.frames).toBeLessThan(fast.frames);
  });

  it('最终分出胜负，且三种播法结论一致', () => {
    expect(normal.outcome).not.toBe('none');
    expect(skip.outcome).toBe(normal.outcome);
    expect(fast.outcome).toBe(normal.outcome);
  });
});

describe('取消演出', () => {
  it('中途取消后显示状态直接对齐权威状态，且清掉离场代理', () => {
    const { session } = makeSession('normal');
    session.setAutoPlayer(true);
    session.start();

    // 先跑一小段，确保正处在演出中间
    for (let i = 0; i < 90; i += 1) {
      session.tick(1 / 60);
    }
    expect(session.getSnapshot().inputOpen).toBe(false);

    session.dispose();

    const snapshot = session.getSnapshot();
    expect(projectDisplay(snapshot.display)).toBe(
      projectDisplay(displayFromState(session.authoritative)),
    );
    expect(snapshot.display.proxies).toHaveLength(0);
  });
});

/** 造一个只有单个 CardDied 的结算，直接对着 `buildBeats` 断言结构。 */
function diedResolution(): Resolution {
  const state = createBattle(
    { seed: 7, playerDeck: ['A_011'], enemyDeck: ['S_001'] },
    definitions,
  );
  return {
    events: [
      {
        type: 'CardDied',
        seq: 1,
        turn: 1,
        side: 'player',
        instanceId: 'p1',
        groupId: 'gp1',
        collapsedInstanceIds: ['p1'],
      },
    ],
    patches: [],
    finalState: state,
    accepted: true,
  };
}

function stubDeps(display: DisplayState): DirectorDeps {
  return {
    display,
    publish: () => {},
    play: () => {},
    skipEffects: () => {},
    log: () => {},
    worldPointOf: () => [0, 0, 0],
    slotPointOf: () => [0, 0, 0],
    playerAnchor: () => [0, 0, 0],
    nameOf: (id) => id,
    speed: () => 'normal',
    onFinished: () => {},
  };
}

describe('离场代理', () => {
  it('一次 CardDied 之后紧跟一个「等代理退场」的步骤', () => {
    const resolution = diedResolution();
    const display = displayFromState(resolution.finalState);
    const beats = buildBeats(resolution, stubDeps(display));

    // 事件本身 → 代理退场 → 收尾停顿 → 终局（时长 0）
    expect(beats).toHaveLength(4);
    expect(beats[1]?.duration).toBe(PROXY_EXIT_SECONDS);
    expect(beats[3]?.duration).toBe(0);
  });

  it('代理的回收走的是普通步骤，跳过时也会被补发', () => {
    const resolution = diedResolution();
    const display = displayFromState(resolution.finalState);
    const deps = stubDeps(display);

    // 手工造一个代理，模拟 CardDied 那一步刚推完
    display.proxies.push({
      instanceId: 'p1',
      definitionId: 'A_011',
      side: 'player',
      slotIndex: 0,
      stats: { atk: 1, hp: 0, cd: 3 },
    });

    const beats = buildBeats(resolution, deps);
    // 只跑第二个（等代理退场）那一步
    beats[1]?.onComplete?.();

    expect(display.proxies).toHaveLength(0);
  });
});
