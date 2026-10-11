import { describe, expect, it, vi } from 'vitest';
import { cardById } from '../../src/data';
import { assetManifest, cardFaceUrl, cardFaceUrlForDefinition } from '../../src/data/assets';
import { createBattle } from '../../src/domain/battle/engine';
import { COOLDOWN_CARD } from '../../src/domain/battle/turnActions';
import type { CardDefinition } from '../../src/domain/cards/types';
import { buildBoard } from '../../src/rendering/battle/placements';
import { resolveBattleDefinition } from '../../src/rendering/presentation/definitions';
import { displayFromState } from '../../src/rendering/presentation/displayState';
import { BattleSession } from '../../src/rendering/presentation/session';

const template = cardById.get('A_011')!;
function temporary(id: string, atk = 12): CardDefinition {
  return { ...template, cardId: id, name: `本轮-${id}`, atk, hp: 20, cd: 0, rawTraits: [], skills: [], status: 'complete' };
}

describe('独立战斗卡定义与图源', () => {
  it('唯一运行期ID通过artId引用原图，各画质不拼运行期资源路径', () => {
    const [baseId, asset] = Object.entries(assetManifest.cards)[0]!;
    const card = { ...temporary('abyss/run/player/1'), art: { artId: asset.artId, sourcePresent: true } };
    expect(cardFaceUrl(card.cardId)).toBeNull();
    for (const tier of ['thumbnail', 'battle', 'detail'] as const) {
      expect(cardFaceUrlForDefinition(card, tier)).toBe(cardFaceUrl(baseId, tier));
    }
    expect(cardFaceUrlForDefinition({ ...card, art: { artId: 'missing-art', sourcePresent: false } })).toBeNull();
    expect(cardFaceUrlForDefinition({ ...template, art: { artId: 'missing-art', sourcePresent: false } }))
      .toBe(cardFaceUrl(template.cardId));
  });

  it('局部表优先、原模式回退不变、冷却牌不依赖局部表', () => {
    const override = temporary(template.cardId, 33);
    expect(resolveBattleDefinition(template.cardId, { [template.cardId]: override })).toBe(override);
    expect(resolveBattleDefinition(template.cardId)).toBe(template);
    expect(resolveBattleDefinition(COOLDOWN_CARD.cardId, {})).toBe(COOLDOWN_CARD);
    expect(resolveBattleDefinition('abyss/missing', {})).toBeUndefined();
    expect(cardById.get(template.cardId)).toBe(template);
  });

  it('同模板不同培养的牌、双方手牌与弃牌顶图使用各自局部定义和动态数值', () => {
    const first = temporary('abyss/run/player/1', 9);
    const second = temporary('abyss/run/player/2', 17);
    const enemy = temporary('abyss/run/enemy/1', 22);
    const definitions = { [first.cardId]: first, [second.cardId]: second, [enemy.cardId]: enemy };
    const state = createBattle({ seed: 31, playerDeck: [first.cardId, second.cardId], enemyDeck: [enemy.cardId] }, definitions);
    const display = displayFromState(state);
    const firstId = display.zones.player.hand.find(id => display.instances[id]!.definitionId === first.cardId)!;
    const secondId = display.zones.player.hand.find(id => display.instances[id]!.definitionId === second.cardId)!;
    const enemyId = display.zones.enemy.hand.find(id => display.instances[id]!.definitionId === enemy.cardId)!;
    display.zones.player.hand = display.zones.player.hand.filter(id => id !== firstId && id !== secondId);
    display.zones.player.battle[0] = firstId;
    display.zones.player.prep[0] = secondId;
    const view = buildBoard(display, { definitions });
    expect(view.entries.find(entry => entry.instanceId === firstId)).toMatchObject({ card: first, stats: { atk: 9, hp: 20 } });
    expect(view.entries.find(entry => entry.instanceId === secondId)).toMatchObject({ card: second, stats: { atk: 17, hp: 20 } });
    expect(view.entries.find(entry => entry.instanceId === enemyId)?.card).toEqual(enemy);
    display.zones.player.battle[0] = null;
    display.zones.player.discard.push(firstId);
    expect(buildBoard(display, { definitions }).piles.find(pile => pile.side === 'player' && pile.kind === 'discard')?.topCard).toEqual(first);
  });
});

describe('权威终局上报', () => {
  it('规则得出结果即上报一次，不等待终局动画，后续演出不重复上报', () => {
    const first = temporary('abyss/player');
    const enemy = temporary('abyss/enemy');
    const onOutcome = vi.fn();
    const session = new BattleSession({ seed: 11, playerDeck: [first.cardId], enemyDeck: [enemy.cardId], rules: { turnLimit: 1 } },
      { [first.cardId]: first, [enemy.cardId]: enemy }, () => 'normal', { play: () => {}, skipAll: () => {} }, { onOutcome });
    session.setAutoPlayer(true);
    session.start();
    for (let frame = 0; frame < 20000 && !session.authoritative.outcome; frame += 1) session.tick(0.05);
    expect(session.authoritative.outcome).not.toBeNull();
    expect(onOutcome).toHaveBeenCalledExactlyOnceWith(session.authoritative.outcome);
    expect(session.getSnapshot().mode).toBe('battle');
    for (let frame = 0; frame < 20000 && session.getSnapshot().mode !== 'result'; frame += 1) session.tick(0.05);
    expect(session.getSnapshot().mode).toBe('result');
    expect(onOutcome).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it('临时定义用于演出名字，不把运行期ID当作卡名', () => {
    const first = temporary('abyss/player-name');
    const enemy = temporary('abyss/enemy-name');
    const session = new BattleSession({ seed: 11, playerDeck: [first.cardId], enemyDeck: [enemy.cardId], rules: { turnLimit: 3 } },
      { [first.cardId]: first, [enemy.cardId]: enemy }, () => 'skip', { play: () => {}, skipAll: () => {} });
    const lines: string[] = [];
    const unsubscribe = session.subscribe(() => lines.push(...session.getSnapshot().log));
    session.setAutoPlayer(true);
    session.start();
    for (let frame = 0; frame < 20000 && session.getSnapshot().mode !== 'result'; frame += 1) session.tick(0.05);
    expect(lines.some(line => line.includes(first.name) || line.includes(enemy.name))).toBe(true);
    unsubscribe();
    session.dispose();
  });
});
